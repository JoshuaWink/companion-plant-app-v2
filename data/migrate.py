"""
Migrate legacy docs.js plant data into graph-ready JSON.

Produces:
  - plants.json: plant nodes with IDs and property stubs
    - relationships.json: per-edge declared relationships with reasons + confidence
  - contradictions.json: cross-document conflicts for human review
"""
import json
import re
from pathlib import Path


# --- Vague references that can't become graph nodes ---
VAGUE_TERMS = {
    "other peppers", "other vining plants", "some varieties of basil",
    "etc.", "fruit trees", "berries",
}


def slugify(name: str) -> str:
    """Convert plant name to a URL-safe slug ID."""
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def parse_lifecycle(raw: str) -> str:
    """Extract primary lifecycle classification from free-text."""
    lower = raw.lower()
    if "biennial" in lower:
        return "biennial"
    if "perennial" in lower:
        return "perennial"
    return "annual"


def parse_companions_string(raw: str) -> list:
    """
    Parse a comma-separated companions/KAF string into a list of plant slugs.

    Handles:
      - Simple: "Tomatoes, Basil, Carrots"
      - Grouped: "Brassicas(Kale, Cabbage, Broccoli, etc.)"
      - Alliums: "Alliums(Garlic, Leek, Scallion, Onions)"
      - Vague: "Other peppers" → excluded
      - Empty: "No data available" → []
    """
    if not raw or raw.strip() == "No data available":
        return []

    results = []

    # Find grouped references like "GroupName(item1, item2, etc.)"
    # Replace them with just the items inside parentheses
    expanded = raw

    # Pattern: Word(s) followed by parenthetical list
    group_pattern = re.compile(r'([A-Za-z\s]+?)\(([^)]+)\)')

    for match in group_pattern.finditer(raw):
        group_items = match.group(2)
        # Replace the entire match with just the inner items
        expanded = expanded.replace(match.group(0), group_items)

    # Also handle the Three Sisters pattern: (Corn, Beans, Squash "The Three Sisters")
    expanded = re.sub(r'\([^)]*"[^"]*"[^)]*\)', '', expanded)
    # Remove any remaining quoted content
    expanded = re.sub(r'"[^"]*"', '', expanded)

    # Split on comma
    parts = [p.strip() for p in expanded.split(",")]

    for part in parts:
        # Clean up
        part = part.strip()
        if not part:
            continue

        # Remove "etc." entries
        if part.lower() in ("etc.", "etc"):
            continue

        # Skip vague references
        if part.lower() in VAGUE_TERMS:
            continue

        # Skip if it's just whitespace or empty after cleaning
        slug = slugify(part)
        if slug and len(slug) > 1:
            results.append(slug)

    return results


def extract_per_edge_reasons(plant_names: list, paragraph: str) -> dict:
    """
    Extract per-plant reasons from a paragraph blob.

    Strategy: split paragraph into sentences, assign each sentence to
    the plant name it mentions. If a sentence mentions no known plant,
    assign it to the most recently mentioned plant.
    """
    if not paragraph or not paragraph.strip():
        return {name: "" for name in plant_names}

    # Split into sentences
    sentences = re.split(r'(?<=[.!?])\s+', paragraph.strip())

    reasons = {}
    last_matched = None

    for sentence in sentences:
        sentence_lower = sentence.lower()
        matched_plant = None

        # Find which plant this sentence is about
        for plant in plant_names:
            # Try matching the plant name in the sentence
            # Handle multi-word names and partial matches
            plant_words = plant.replace("-", " ")
            if plant_words in sentence_lower:
                matched_plant = plant
                break
            # Try singular/plural variants
            if plant_words.rstrip("s") in sentence_lower:
                matched_plant = plant
                break
            if plant_words + "s" in sentence_lower:
                matched_plant = plant
                break

        if matched_plant:
            if matched_plant in reasons:
                reasons[matched_plant] += " " + sentence
            else:
                reasons[matched_plant] = sentence
            last_matched = matched_plant
        elif last_matched:
            # Append to the last matched plant's reason
            reasons[last_matched] += " " + sentence

    # Ensure all plants have an entry (even if empty)
    for plant in plant_names:
        if plant not in reasons:
            reasons[plant] = paragraph.strip()  # fallback: full paragraph

    return reasons


def infer_relationship_confidence(rel_type: str, reason: str) -> tuple[str, str]:
    """Deterministically classify relationship confidence from the reason text."""
    text = (reason or "").strip().lower()
    if not text:
        return ("speculative", "missing-reason")

    disease_terms = (
        "verticillium", "fusarium", "blight", "wilt", "club root",
        "clubroot", "nematode", "nematodes", "susceptible", "share pests",
        "same family",
    )
    if any(term in text for term in disease_terms):
        return ("consensus", "disease-avoidance")

    if rel_type == "precedes" and any(
        term in text for term in ("gap", "soil", "nitrogen", "weed", "suppression", "establishment")
    ):
        return ("consensus", "succession-practice")

    mechanistic_terms = (
        "repel", "deter", "aphid", "beetle", "insect", "trap crop",
        "pollinator", "shade", "support", "trellis", "water", "soil",
        "nutrient", "nitrogen", "sun", "ground cover", "growing conditions",
        "resources", "lime",
    )
    hedged_terms = (" may ", " might ", " can ", "sometimes", "thought to", "often")

    if any(term in text for term in mechanistic_terms):
        if any(term in text for term in hedged_terms):
            return ("traditional", "garden-tradition")
        return ("empirical", "observed-garden-practice")

    if any(term in text for term in hedged_terms):
        return ("traditional", "garden-tradition")

    return ("speculative", "inferred-from-text")


def build_plant_node(raw: dict) -> dict:
    """Build a plant node from a raw docs.js entry."""
    name = raw["Plant Name"].strip()
    return {
        "id": slugify(name),
        "name": name,
        "lifecycle": parse_lifecycle(raw.get("Annual or Perennial", "Annual")),
        "stub": False,
        "properties": {
            "water_needs": None,
            "sun_hours": None,
            "soil_ph": None,
            "root_depth": None,
            "height_cm": None,
            "nutrient_needs": None,
            "nutrient_gives": None,
            "pest_deters": [],
            "pest_attracts": [],
            "allelopathic_emits": [],
        }
    }


def build_stub_node(slug: str) -> dict:
    """Build a minimal stub node for a referenced but undocumented plant."""
    # Convert slug back to a display name
    name = slug.replace("-", " ").title()
    return {
        "id": slug,
        "name": name,
        "lifecycle": None,
        "stub": True,
        "properties": {
            "water_needs": None,
            "sun_hours": None,
            "soil_ph": None,
            "root_depth": None,
            "height_cm": None,
            "nutrient_needs": None,
            "nutrient_gives": None,
            "pest_deters": [],
            "pest_attracts": [],
            "allelopathic_emits": [],
        }
    }


def build_relationship_edges(raw: dict) -> list:
    """Build all relationship edges from a single plant's raw entry."""
    source = slugify(raw["Plant Name"])
    edges = []

    # Companion edges
    cp_slugs = parse_companions_string(raw.get("Companions", ""))
    cp_reasons = extract_per_edge_reasons(
        cp_slugs, raw.get("Companion Benefits", "")
    )

    for target in cp_slugs:
        confidence, evidence = infer_relationship_confidence(
            "companion", cp_reasons.get(target, "").strip()
        )
        edges.append({
            "source": source,
            "target": target,
            "type": "companion",
            "reason": cp_reasons.get(target, "").strip(),
            "confidence": confidence,
            "evidence": evidence,
        })

    # Antagonist edges
    kaf_slugs = parse_companions_string(raw.get("Keep Away From", ""))
    kaf_reasons = extract_per_edge_reasons(
        kaf_slugs, raw.get("Why Is It Bad?", "")
    )

    for target in kaf_slugs:
        confidence, evidence = infer_relationship_confidence(
            "antagonist", kaf_reasons.get(target, "").strip()
        )
        edges.append({
            "source": source,
            "target": target,
            "type": "antagonist",
            "reason": kaf_reasons.get(target, "").strip(),
            "confidence": confidence,
            "evidence": evidence,
        })

    return edges


def detect_contradictions(edges: list) -> list:
    """
    Find pairs where A→B is companion but B→A is antagonist (or vice versa).
    """
    # Build lookup: (source, target) → type
    edge_map = {}
    for e in edges:
        key = (e["source"], e["target"])
        edge_map[key] = e["type"]

    contradictions = []
    seen = set()

    for e in edges:
        reverse_key = (e["target"], e["source"])
        if reverse_key in edge_map:
            reverse_type = edge_map[reverse_key]
            if e["type"] != reverse_type:
                pair = frozenset([e["source"], e["target"]])
                if pair not in seen:
                    seen.add(pair)
                    contradictions.append({
                        "plants": list(pair),
                        "detail": (
                            f"{e['source']} says {e['target']} is {e['type']}, "
                            f"but {e['target']} says {e['source']} is {reverse_type}"
                        ),
                        "edge_a": e,
                        "edge_b": next(
                            x for x in edges
                            if x["source"] == e["target"] and x["target"] == e["source"]
                        ),
                    })

    return contradictions


def migrate_all(source_data: list, output_dir: Path = None) -> dict:
    """
    Full migration pipeline.

    Args:
        source_data: list of raw plant dicts from docs.js
        output_dir: directory to write output files (optional)

    Returns:
        dict with keys: plants, relationships, contradictions
    """
    if output_dir:
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

    # Build plant nodes from entries
    plants = []
    entry_ids = set()

    for raw in source_data:
        node = build_plant_node(raw)
        plants.append(node)
        entry_ids.add(node["id"])

    # Build all edges
    all_edges = []
    for raw in source_data:
        all_edges.extend(build_relationship_edges(raw))

    # Find referenced plants without entries → create stubs
    referenced_ids = set()
    for edge in all_edges:
        referenced_ids.add(edge["target"])
        referenced_ids.add(edge["source"])

    stub_ids = referenced_ids - entry_ids
    for stub_id in sorted(stub_ids):
        plants.append(build_stub_node(stub_id))

    # Detect contradictions
    contradictions = detect_contradictions(all_edges)

    # Write output
    if output_dir:
        (output_dir / "plants.json").write_text(
            json.dumps(plants, indent=2, ensure_ascii=False)
        )
        (output_dir / "relationships.json").write_text(
            json.dumps(all_edges, indent=2, ensure_ascii=False)
        )
        (output_dir / "contradictions.json").write_text(
            json.dumps(contradictions, indent=2, ensure_ascii=False)
        )

    return {
        "plants": plants,
        "relationships": all_edges,
        "contradictions": contradictions,
    }


if __name__ == "__main__":
    """Run migration on the source_docs.js data."""
    import sys

    # Load the source data (it's JS, so we parse it manually)
    source_path = Path(__file__).parent / "source_docs.js"
    text = source_path.read_text()

    # Extract the JSON array from the JS module
    # Find the array between [ and the last ]
    start = text.index("[")
    # Find matching closing bracket
    bracket_count = 0
    end = start
    for i, ch in enumerate(text[start:], start):
        if ch == "[":
            bracket_count += 1
        elif ch == "]":
            bracket_count -= 1
            if bracket_count == 0:
                end = i + 1
                break

    json_text = text[start:end]
    source_data = json.loads(json_text)

    output_dir = Path(__file__).parent
    result = migrate_all(source_data, output_dir=output_dir)

    print(f"Plants: {len(result['plants'])} ({len([p for p in result['plants'] if not p.get('stub')])} full, {len([p for p in result['plants'] if p.get('stub')])} stubs)")
    print(f"Relationships: {len(result['relationships'])}")
    print(f"Contradictions: {len(result['contradictions'])}")
