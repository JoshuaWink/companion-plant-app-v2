"""Tests for the plant data migration script.

Converts the legacy docs.js format into:
  - plants.json: plant nodes with measurable properties
  - relationships.json: declared relationship edges with per-edge reasons
  - contradictions.json: flagged issues for human review
"""
import json
import pytest
from pathlib import Path

# Import the module under test
from data.migrate import (
    slugify,
    parse_lifecycle,
    parse_companions_string,
    extract_per_edge_reasons,
    build_plant_node,
    build_relationship_edges,
    detect_contradictions,
    migrate_all,
)


# --- slugify ---

def test_slugify_simple():
    assert slugify("Basil") == "basil"


def test_slugify_spaces():
    assert slugify("Bell Peppers") == "bell-peppers"


def test_slugify_special_chars():
    assert slugify("Brussels Sprouts") == "brussels-sprouts"


def test_slugify_preserves_hyphens():
    assert slugify("Swiss Chard") == "swiss-chard"


# --- parse_lifecycle ---

def test_lifecycle_annual():
    assert parse_lifecycle("Annual") == "annual"


def test_lifecycle_perennial():
    assert parse_lifecycle("Perennial") == "perennial"


def test_lifecycle_biennial():
    assert parse_lifecycle("Biennial") == "biennial"


def test_lifecycle_complex_string():
    # "Perennial in tropical areas, annuals in colder climates"
    result = parse_lifecycle("Perennial in tropical areas, annuals in colder climates")
    assert result == "perennial"  # primary classification


def test_lifecycle_with_zones():
    result = parse_lifecycle("Perennial in hardiness zones 9 through 11")
    assert result == "perennial"


# --- parse_companions_string ---

def test_parse_simple_list():
    result = parse_companions_string("Tomatoes, Basil, Carrots")
    assert result == ["tomatoes", "basil", "carrots"]


def test_parse_single_item():
    result = parse_companions_string("Tomatoes")
    assert result == ["tomatoes"]


def test_parse_grouped_references():
    # "Brassicas(Kale, Cabbage, Broccoli, etc.)" should expand
    result = parse_companions_string("Beans, Brassicas(Kale, Cabbage, Broccoli, etc.), Mint")
    assert "beans" in result
    assert "kale" in result
    assert "cabbage" in result
    assert "broccoli" in result
    assert "mint" in result
    # The group name itself should NOT be a node
    assert "brassicas" not in result
    assert "etc." not in result


def test_parse_alliums_group():
    result = parse_companions_string("Alliums(Garlic, Leek, Scallion, Onions)")
    assert "garlic" in result
    assert "leek" in result
    assert "scallion" in result
    assert "onions" in result
    assert "alliums" not in result


def test_parse_no_data_available():
    result = parse_companions_string("No data available")
    assert result == []


def test_parse_other_peppers_becomes_empty():
    # "Other peppers" is too vague to be a node
    result = parse_companions_string("Other peppers, Basil")
    assert "basil" in result
    assert "other peppers" not in result


# --- extract_per_edge_reasons ---

def test_extract_reasons_simple():
    """Each sentence in 'Why Is It Bad?' maps to a KAF plant."""
    kaf_plants = ["thyme", "sage", "cucumbers"]
    paragraph = (
        "Thyme has different growing conditions for soil nutrients and water needs. "
        "Sage thrives on dry soil while basil requires constant watering. "
        "Cucumbers compete for resources, such as water and nutrients."
    )
    reasons = extract_per_edge_reasons(kaf_plants, paragraph)
    assert "thyme" in reasons
    assert "sage" in reasons
    assert "cucumbers" in reasons
    assert "growing conditions" in reasons["thyme"].lower()
    assert "dry soil" in reasons["sage"].lower()
    assert "compete" in reasons["cucumbers"].lower()


def test_extract_reasons_partial_match():
    """Even if a sentence mentions multiple plants, assign to best match."""
    kaf_plants = ["tomatoes", "potatoes"]
    paragraph = (
        "Tomatoes feed on similar nutrients. "
        "Potatoes attract pests."
    )
    reasons = extract_per_edge_reasons(kaf_plants, paragraph)
    assert "tomatoes" in reasons
    assert "potatoes" in reasons


def test_extract_benefits_simple():
    cp_plants = ["beans", "dill"]
    paragraph = (
        "Beans fixes the nitrogen in the soil. "
        "Dill attracts bees for pollination."
    )
    reasons = extract_per_edge_reasons(cp_plants, paragraph)
    assert "beans" in reasons
    assert "nitrogen" in reasons["beans"].lower()
    assert "dill" in reasons
    assert "bees" in reasons["dill"].lower()


# --- build_plant_node ---

def test_build_plant_node_basic():
    raw = {
        "Plant Name": "Basil",
        "Annual or Perennial": "Annual",
        "Companions": "Tomatoes",
        "Companion Benefits": "...",
        "Keep Away From": "Thyme, Sage",
        "Why Is It Bad?": "..."
    }
    node = build_plant_node(raw)
    assert node["id"] == "basil"
    assert node["name"] == "Basil"
    assert node["lifecycle"] == "annual"
    assert "properties" in node


def test_build_plant_node_has_empty_properties():
    """Properties start sparse — the data doesn't have numeric values yet."""
    raw = {
        "Plant Name": "Corn",
        "Annual or Perennial": "Annual",
        "Companions": "Beans, Squash",
        "Companion Benefits": "...",
        "Keep Away From": "Tomatoes",
        "Why Is It Bad?": "..."
    }
    node = build_plant_node(raw)
    props = node["properties"]
    # Properties exist but are null/empty — to be enriched later
    assert "water_needs" in props
    assert "sun_hours" in props
    assert "soil_ph" in props


# --- build_relationship_edges ---

def test_build_companion_edges():
    raw = {
        "Plant Name": "Basil",
        "Companions": "Tomatoes",
        "Companion Benefits": "Basil repels insects, specifically flies & hornworms; also improves yield",
        "Keep Away From": "Thyme",
        "Why Is It Bad?": "Thyme has different growing conditions."
    }
    edges = build_relationship_edges(raw)
    companion_edges = [e for e in edges if e["type"] == "companion"]
    antagonist_edges = [e for e in edges if e["type"] == "antagonist"]

    assert len(companion_edges) == 1
    assert companion_edges[0]["source"] == "basil"
    assert companion_edges[0]["target"] == "tomatoes"
    assert "repels" in companion_edges[0]["reason"].lower()

    assert len(antagonist_edges) == 1
    assert antagonist_edges[0]["source"] == "basil"
    assert antagonist_edges[0]["target"] == "thyme"


def test_edges_have_required_fields():
    raw = {
        "Plant Name": "Corn",
        "Companions": "Beans, Squash",
        "Companion Benefits": "Beans provide nitrogen. Squash provides ground cover.",
        "Keep Away From": "Tomatoes",
        "Why Is It Bad?": "They share pests."
    }
    edges = build_relationship_edges(raw)
    for edge in edges:
        assert "source" in edge
        assert "target" in edge
        assert "type" in edge
        assert edge["type"] in ("companion", "antagonist")
        assert "reason" in edge


# --- detect_contradictions ---

def test_detect_cross_contradictions():
    edges = [
        {"source": "corn", "target": "cucumbers", "type": "companion", "reason": "..."},
        {"source": "cucumbers", "target": "corn", "type": "antagonist", "reason": "..."},
    ]
    contradictions = detect_contradictions(edges)
    assert len(contradictions) >= 1
    assert contradictions[0]["plants"] == {"corn", "cucumbers"} or \
           set(contradictions[0]["plants"]) == {"corn", "cucumbers"}


def test_no_contradictions_when_consistent():
    edges = [
        {"source": "basil", "target": "tomatoes", "type": "companion", "reason": "..."},
        {"source": "tomatoes", "target": "basil", "type": "companion", "reason": "..."},
    ]
    contradictions = detect_contradictions(edges)
    assert len(contradictions) == 0


# --- migrate_all (integration) ---

def test_migrate_all_produces_three_outputs(tmp_path):
    """Full pipeline: source data in → three JSON files out."""
    source_data = [
        {
            "Plant Name": "Basil",
            "Annual or Perennial": "Annual",
            "Companions": "Tomatoes",
            "Companion Benefits": "Repels hornworms.",
            "Keep Away From": "Sage",
            "Why Is It Bad?": "Sage needs dry soil."
        },
        {
            "Plant Name": "Tomatoes",
            "Annual or Perennial": "Annual",
            "Companions": "Basil",
            "Companion Benefits": "Basil repels pests.",
            "Keep Away From": "Corn",
            "Why Is It Bad?": "Corn shades tomatoes."
        },
    ]

    result = migrate_all(source_data, output_dir=tmp_path)

    # Check files created
    assert (tmp_path / "plants.json").exists()
    assert (tmp_path / "relationships.json").exists()
    assert (tmp_path / "contradictions.json").exists()

    # Validate plants.json
    plants = json.loads((tmp_path / "plants.json").read_text())
    assert len(plants) >= 2
    ids = [p["id"] for p in plants]
    assert "basil" in ids
    assert "tomatoes" in ids

    # Validate relationships.json
    rels = json.loads((tmp_path / "relationships.json").read_text())
    assert len(rels) >= 3  # basil->tomatoes, tomatoes->basil, basil-x->sage, tomatoes-x->corn

    # Stubs should be created for referenced plants without entries
    stub_ids = [p["id"] for p in plants if p.get("stub")]
    assert "sage" in stub_ids
    assert "corn" in stub_ids


def test_migrate_all_deduplicates_stubs(tmp_path):
    """Same plant referenced by multiple entries = one stub, not many."""
    source_data = [
        {
            "Plant Name": "A",
            "Annual or Perennial": "Annual",
            "Companions": "Fennel",
            "Companion Benefits": "Good.",
            "Keep Away From": "",
            "Why Is It Bad?": ""
        },
        {
            "Plant Name": "B",
            "Annual or Perennial": "Annual",
            "Companions": "Fennel",
            "Companion Benefits": "Also good.",
            "Keep Away From": "",
            "Why Is It Bad?": ""
        },
    ]
    result = migrate_all(source_data, output_dir=tmp_path)
    plants = json.loads((tmp_path / "plants.json").read_text())
    fennel_entries = [p for p in plants if p["id"] == "fennel"]
    assert len(fennel_entries) == 1
