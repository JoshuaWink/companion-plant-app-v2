# Intention — Symbiotic Network Layer

> Model the invisible underground and above-ground biological networks that make companion planting actually work — mycorrhizal fungi, nitrogen-fixing bacteria, beneficial insects, pest-deterrent microbes — and expose their effects in the physiology engine.

## North Star

The companion garden app currently knows *that* basil and tomatoes are companions — but not *why* at the biological level. The reason is a free-text string. The symbiotic network layer makes the *mechanism* computable:

- **Mycorrhizal fungi** connecting root systems, sharing phosphorus and water signals
- **Rhizobacteria** (Rhizobium, Azotobacter) fixing atmospheric nitrogen
- **Beneficial insects** (parasitic wasps, ladybugs, hoverflies) attracted by specific plants
- **Antagonistic biochemicals** (allelopathy — juglone from walnut, thiocyanates from brassicas)
- **Soil microbiome** shifts caused by root exudates and decomposition

Instead of "basil repels hornworms" being a text label, it becomes: basil emits linalool + eugenol → deters Manduca sexta (tomato hornworm) → reduces pest_pressure on tomatoes → higher net_photosynthesis → better yield. Computable. Simulatable. Visible.

## Why This Matters

**The current system has 594 relationships, but they're opaque edges.** The `reason` field is prose — "Marigolds repel nematodes", "Beans fix nitrogen." This is fine for a gardener reading tooltips, but it means the simulation engine can't use these relationships. The physiology engine models VPD, stomatal conductance, transpiration, and nutrient uptake — but it models each plant in isolation. No plant actually grows in isolation. The rhizosphere is a marketplace.

**Companion planting IS symbiotic network effects.** The Three Sisters work because:
1. Corn provides a trellis (structural symbiosis)
2. Beans fix nitrogen via Rhizobium bacteria (microbial symbiosis)  
3. Squash shades soil, reducing evaporation (microclimate modification)
4. All three connect through arbuscular mycorrhizal (AM) fungi, sharing P and signaling stress

Our engine currently can't model ANY of these interactions. Each plant's `simulate_plant()` runs independently with its own Environment. The symbiotic network layer creates the coupling between plants that makes a garden more than the sum of its parts.

## What Success Feels Like

"I placed beans next to corn, and the simulation showed corn's nitrogen_availability increasing over weeks as the Rhizobium colony established. When I added squash as ground cover, soil_moisture stopped dropping so fast. The mycorrhizal network indicator showed all three connected after 30 days — and the phosphorus uptake for all three improved. Then I accidentally placed a walnut tree nearby and saw the allelopathy warning: juglone is suppressing the beans and tomatoes within 3 meters."

## Open Questions

### Data Questions (Critical)
1. **What mycorrhizal associations are well-documented?** Most plants form AM (arbuscular mycorrhizal) associations, but some families (Brassicaceae, Chenopodiaceae/Amaranthaceae) are non-mycorrhizal. This is well-studied — we can build a family-level lookup.
2. **What quantitative data exists on mycorrhizal P transfer rates?** Qualitative: well-documented. Quantitative: sparse. We may need to model relative effects (1.0 = baseline, 1.2 = AM-connected) rather than absolute g/m²/day.
3. **Nitrogen fixation rates by crop?** Well-documented for major legumes. Soybeans: 50-300 kg N/ha/year. Clover: 50-150. Beans: 30-80. Peas: 50-120. This is actionable data.
4. **Beneficial insect host plant data?** Good data exists. Dill/fennel attract parasitic wasps. Yarrow attracts hoverflies. Marigolds attract ladybugs. The question is: can we quantify pest-pressure reduction?
5. **Allelopathic compound diffusion data?** Juglone (walnut) is the best-studied: toxic to solanaceae within ~15m of canopy drip line. Brassica thiocyanates inhibit germination of small seeds. Sunflower allelopathy is documented but weak.

### Architecture Questions
6. **Per-plant simulation or garden-level simulation?** Currently `simulate_plant()` takes one plant + one environment. The symbiotic layer requires multi-plant awareness. Options:
   - (A) Post-process: run each plant independently, then apply symbiotic modifiers
   - (B) Pre-process: compute symbiotic environment adjustments, then feed modified env to each plant
   - (C) Co-simulation: new `simulate_garden()` that runs all plants together with interaction matrix
7. **Where does the symbiotic data live?** Options:
   - Extend `relationships.json` with mechanism fields
   - New `organisms.json` for fungi/bacteria/insects with their own relationship graph
   - Embed in `plants.json` properties (e.g., `mycorrhizal_type: "AM"`, `nitrogen_fixer: true`)
8. **Spatial distance matters.** Mycorrhizal networks have range (typically 1-3m). Allelopathy has range. Beneficial insects have range. The current grid model (15cm cells) gives us spatial proximity — but the engine doesn't use it yet.

### Scope Questions
9. **How deep do we model microbiology?** Three levels of fidelity:
   - **L1 (flags)**: Plant is/isn't mycorrhizal. Plant does/doesn't fix N. Binary modifiers.
   - **L2 (rates)**: Mycorrhizal connection improves P uptake by X%. N fixation adds Y g/m²/day after Z days establishment.
   - **L3 (dynamics)**: Mycorrhizal network grows over time. Colony establishment depends on soil temp, moisture, pH. Competitive exclusion between AM species.
10. **Do we model organism populations?** Beneficial insects: do we track population dynamics (immigration, reproduction, predation) or just presence/absence based on host plants?

## Constraints

- **Non-negotiable**: Zero external runtime dependencies. All data is static JSON.
- **Non-negotiable**: Backward compatible — existing plant data and relationships must still work.
- **Non-negotiable**: Must work offline. No API calls for symbiotic data.
- **Non-negotiable**: Engine remains pure Rust/WASM. Symbiotic computations happen in the engine.
- **Flexible**: Initial fidelity level (L1 flags are fine for MVP, L2 rates for v2).
- **Flexible**: Which organisms to include first (fungi > bacteria > insects is the natural order).
- **Flexible**: Whether to extend existing data files or create new ones.

## Phases of Understanding

| Phase | Description | Status |
|-------|-------------|--------|
| Explore | Research mycorrhizal/bacterial/insect data, quantify what's available | **current** |
| Prototype | Add mycorrhizal flags to 10 plants, test P-uptake modifier in engine | not started |
| Crystallize | Define organism data model, choose simulation architecture (A/B/C) | not started |
| Roadmap | Milestone plan for fungi → bacteria → insects → allelopathy | not started |
| Build | TDD implementation, data population, UI integration | not started |
| Reflect | Does the symbiotic layer produce meaningfully different simulations? | not started |

---

# Overview

> Extend the companion garden engine from single-plant physiology to multi-organism ecology — modeling fungi, bacteria, and insects as first-class participants in the garden simulation.

## Problem

The physiology engine (87 tests, 9 gap closures) models each plant in isolation. But gardens are ecosystems. The *reason* companion planting works is biological interaction — mycorrhizal networks, nitrogen fixation, pest deterrence, allelopathy. These mechanisms are currently text labels on relationship edges, invisible to the simulation.

## Solution

Add four organism classes to the data model and engine:

| Organism | Role | Primary Effect | Data Quality |
|----------|------|----------------|-------------|
| **Mycorrhizal fungi** | Underground nutrient network | P/micronutrient sharing, water transfer, stress signaling | Good (family-level AM/EM/non-myc is well-documented) |
| **Nitrogen-fixing bacteria** | Root nodule symbiosis | Convert N₂ → NH₃, available to host and neighbors | Excellent (kg N/ha/year data exists for all major legumes) |
| **Beneficial insects** | Pest regulation | Reduce pest pressure → less damage → better yield | Moderate (host plant attractors known, quantitative impact harder) |
| **Allelopathic compounds** | Chemical warfare | Inhibit germination, suppress growth of neighbors | Good (juglone, thiocyanates well-quantified) |

### Approach: Pre-process Modifier (Option B)

Rather than a full co-simulation, compute a `SymbioticContext` for each plant based on its neighbors, then inject modifiers into the existing `Environment` before calling `simulate_plant()`. This preserves the current engine architecture while adding multi-plant awareness.

```
Garden layout → for each plant:
  1. Find neighbors within interaction radius
  2. Compute symbiotic modifiers (N bonus, P multiplier, pest factor, allelopathy)
  3. Adjust Environment with modifiers
  4. Call simulate_plant() with modified env
```

## Scope

**In scope (MVP)**:
- Mycorrhizal type flag per plant family (AM / ectomycorrhizal / non-mycorrhizal)
- Nitrogen fixation rates for legumes
- P-uptake modifier when mycorrhizal neighbors are present
- Allelopathy zones (juglone, brassica thiocyanates)
- New `organisms.json` data file

**In scope (v2)**:
- Beneficial insect host plant → pest reduction pipeline
- Mycorrhizal network establishment timeline (days to colonization)
- Soil microbiome diversity index
- Bacterial inoculant effects (Bacillus, Trichoderma)

**Out of scope**:
- Disease-causing organisms (pathogens)
- Full population dynamics for insects
- Soil pH modeling (affects mycorrhizal colonization but adds complexity)
- Mycorrhizal species-level modeling (AM genera: Glomus, Rhizophagus, etc.)

---

# Architecture

## New Data Types

### Organism (new entity)

```jsonc
// organisms.json — fungi, bacteria, insects
{
  "id": "am-fungi",
  "name": "Arbuscular Mycorrhizal Fungi",
  "class": "fungus",              // fungus | bacterium | insect
  "subclass": "am",               // am | ectomycorrhizal | rhizobium | free-living-nfixer | predator | pollinator
  "effects": {
    "phosphorus_uptake_mult": 1.25,   // 25% P improvement for connected plants
    "water_uptake_mult": 1.1,         // 10% water extraction improvement
    "stress_signal": true              // connected plants get early drought warning
  },
  "requirements": {
    "soil_temp_min_c": 10,
    "soil_moisture_min_mm": 15,
    "establishment_days": 21           // days to colonize new root system
  },
  "interaction_radius_cm": 150,       // hyphal network range
  "host_families": ["solanaceae", "fabaceae", "poaceae", "cucurbitaceae", "apiaceae", "asteraceae"],
  "excluded_families": ["brassicaceae", "amaranthaceae"]   // non-mycorrhizal
}
```

### Plant Extensions

```jsonc
// Added to plants.json properties
{
  "properties": {
    "mycorrhizal_type": "am",           // am | ectomycorrhizal | non-mycorrhizal
    "nitrogen_fixer": false,
    "n_fixation_kg_ha_yr": 0,           // 0 for non-fixers
    "allelopathic_compounds": [],        // ["juglone", "thiocyanate"]
    "allelopathy_radius_cm": 0,
    "beneficial_insect_attractors": ["hoverflies", "ladybugs"],  // what it attracts
    "pest_susceptibility": ["aphids", "hornworms"],               // what attacks it
    "root_exudates": ["organic_acids", "sugars"]                  // feeds mycorrhizae
  }
}
```

### Symbiotic Context (Rust engine)

```rust
/// Computed from garden layout before calling simulate_plant()
pub struct SymbioticContext {
    /// Nitrogen bonus from nearby fixers (g/m²)
    pub n_fixation_bonus: f32,
    /// Phosphorus uptake multiplier from mycorrhizal network (1.0 = no network)
    pub p_uptake_mult: f32,
    /// Water uptake multiplier from mycorrhizal network
    pub water_uptake_mult: f32,
    /// Allelopathic growth suppression (0-1, 0 = full suppression)
    pub allelopathy_factor: f32,
    /// Pest pressure reduction from beneficial insects (0-1, 0 = no pests)
    pub pest_reduction: f32,
    /// Whether this plant is connected to mycorrhizal network
    pub mycorrhizal_connected: bool,
    /// Days since mycorrhizal establishment (affects strength)
    pub mycorrhizal_maturity_days: u16,
}
```

## Interaction Pipeline

```
                    Garden Layout (cells × plants)
                              │
                    ┌─────────▼──────────┐
                    │  SpatialNeighbors   │  Find plants within interaction radius
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  MycorrhizalNet    │  Build fungal network graph
                    │  (AM family check) │  Connect compatible plants
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  NitrogenFixation  │  Sum N contributions from legume neighbors
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  AllelopathyCheck  │  Check for inhibitory compounds in range
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  InsectAttraction  │  Map host plants → beneficial insects → pest reduction
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  SymbioticContext  │  Aggregate all effects into modifiers
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  simulate_plant()  │  Run with modified Environment
                    │  (existing engine) │
                    └────────────────────┘
```

## Data Flow

1. **JS layer** reads garden layout (cells with plant IDs)
2. **JS layer** computes spatial neighbors per plant (within N cm)
3. **JS layer** passes neighbor list + organism data to WASM
4. **WASM** computes `SymbioticContext` per plant
5. **WASM** adjusts `Environment` using context modifiers
6. **WASM** runs `simulate_plant()` with modified environment
7. **JS layer** renders symbiotic indicators (network lines, N-fixation halos, pest shields)

Alternative: Steps 2-4 all happen in WASM via a new `simulate_garden()` export that takes the full layout.

---

# Milestones

## M1: Mycorrhizal Foundation (GREEN target)

The minimum viable symbiotic layer: AM fungi connect compatible plants, improve P uptake.

- [ ] Add `mycorrhizal_type` field to all plants in `plants.json` (family-level lookup)
- [ ] Create `organisms.json` with AM fungi entry
- [ ] Add `SymbioticContext` struct to Rust engine
- [ ] Implement `compute_mycorrhizal_network()` — graph of connected plants
- [ ] Apply `p_uptake_mult` modifier to Environment before simulate_plant()
- [ ] Tests: mycorrhizal tomato+basil vs non-mycorrhizal brassica+tomato
- [ ] Tests: non-mycorrhizal plants (cabbage, broccoli) don't get P bonus

## M2: Nitrogen Fixation

Legumes share nitrogen with neighbors through root exudates and mycorrhizal network.

- [ ] Add `n_fixation_kg_ha_yr` to legume plants in data
- [ ] Implement `compute_n_fixation_bonus()` — distance-weighted N from legume neighbors
- [ ] Apply N bonus to Environment.npk_available before simulate_plant()
- [ ] Tests: corn next to beans gets N boost; corn alone does not
- [ ] Tests: N fixation scales with legume maturity (seedling fixes less than flowering)

## M3: Allelopathy

Chemical warfare between plants — juglone, thiocyanates, and other growth inhibitors.

- [ ] Add `allelopathic_compounds` and `allelopathy_radius_cm` to plants
- [ ] Implement `compute_allelopathy_factor()` — suppression within radius
- [ ] Apply allelopathy as growth rate multiplier in simulate_plant()
- [ ] New stress event: `allelopathic_suppression`
- [ ] Tests: tomato near black walnut gets juglone stress
- [ ] Tests: small-seed germination inhibited near brassica residues

## M4: Beneficial Insects

Host plants attract predatory/parasitic insects that reduce pest pressure on neighbors.

- [ ] Add `beneficial_insect_attractors` and `pest_susceptibility` to plants
- [ ] Create insect entries in `organisms.json` (ladybug, parasitic wasp, hoverfly, lacewing)
- [ ] Implement `compute_pest_reduction()` — host plant → insect → pest suppression chain
- [ ] Apply pest_reduction as yield modifier in simulate_plant()
- [ ] New stress event: `pest_pressure` (when no beneficial insects nearby)
- [ ] Tests: tomato near dill (attracts wasps) has less hornworm pressure

## M5: UI Integration

Visualize the invisible networks.

- [ ] Mycorrhizal network lines between connected plants on garden canvas
- [ ] N-fixation halo around legumes showing sharing radius
- [ ] Allelopathy danger zone shading
- [ ] Beneficial insect flight paths (host plant → protected neighbor)
- [ ] Symbiotic health summary in research view (network connectivity, diversity index)

---

# Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Quantitative mycorrhizal data too sparse | Medium | Medium | Use relative multipliers (1.0/1.25) not absolute rates. Calibrate against field trial summaries. |
| Simulation becomes N² with plant interactions | Medium | High | Pre-compute neighbor graph once per layout change, not per simulation tick. Cache SymbioticContext. |
| Data population is enormous (40+ plants × organisms) | Medium | High | Start with 10 key plants, derive rest from family-level defaults. Most fields can auto-populate. |
| Users confused by invisible biology | Low | Medium | Make it opt-in: "Advanced: Symbiotic Network" toggle. Default off for hobby mode, on for research mode. |
| Allelopathy data creates false confidence | Medium | Medium | Add uncertainty indicators. "Juglone toxicity: well-documented" vs "Sunflower allelopathy: mixed evidence." |
| N-fixation bonus makes legumes OP in optimizer | Low | High | Cap N bonus, apply establishment delay (21+ days). Don't let day-1 beans flood the garden with nitrogen. |
| Engine complexity explosion | High | Medium | Option B (pre-process modifier) keeps engine changes minimal. SymbioticContext is just 7 floats injected into Environment. |

---

# Research Log

## Mycorrhizal Network — Known Science

### Family-Level Mycorrhizal Status (High Confidence)

| Family | Mycorrhizal Type | Notes |
|--------|-----------------|-------|
| Solanaceae | AM | Tomatoes, peppers, eggplant — strong AM colonizers |
| Fabaceae | AM | Beans, peas — also host Rhizobium (dual symbiosis) |
| Poaceae | AM | Corn, wheat — extensive hyphal networks in grass roots |
| Cucurbitaceae | AM | Squash, melons — heavy AM dependency |
| Apiaceae | AM | Carrots, dill, fennel — moderate AM |
| Asteraceae | AM | Marigolds, sunflowers, lettuce — variable |
| Lamiaceae | AM | Basil, mint, rosemary — moderate |
| Allium (Amaryllidaceae) | AM | Garlic, onions — moderate |
| **Brassicaceae** | **Non-mycorrhizal** | Cabbage, broccoli, kale, radish — **do not form AM** |
| **Amaranthaceae** | **Non-mycorrhizal** | Spinach, beets, chard — **do not form AM** |
| **Polygonaceae** | **Non-mycorrhizal** | Buckwheat — **non-mycorrhizal** |

**Key insight**: Brassicaceae being non-mycorrhizal is one reason they're bad companions for many plants — they can't participate in the underground network. Planting broccoli in the middle of an AM-connected guild *disrupts* the network. This is computable.

### Nitrogen Fixation Rates (Peer-Reviewed Data)

| Crop | N Fixed (kg/ha/yr) | Certainty | Source |
|------|-------------------|-----------|--------|
| Soybean | 50-300 | High | Herridge et al. 2008 |
| Common bean | 30-80 | High | Peoples et al. 2009 |
| Pea | 50-120 | High | Peoples et al. 2009 |
| Clover (cover crop) | 50-150 | High | Carlsson & Huss-Danell 2003 |
| Alfalfa | 100-300 | High | Peoples et al. 2009 |
| Fava bean | 80-200 | High | Rochester et al. 2001 |
| Cowpea | 40-100 | Medium | Peoples et al. 2009 |

**Key insight**: Conversion from field-scale (kg/ha) to garden-scale (g/m²): divide by 10. So soybeans fix 5-30 g N/m²/year. Over a 120-day season, that's ~0.04-0.25 g/m²/day. This is enough to significantly offset a heavy feeder's nitrogen needs (-12 to -15 g/m²/season for tomatoes/corn).

### Beneficial Insect — Host Plant Matrix (Moderate Confidence)

| Insect | Attracted By | Preys On | Range |
|--------|-------------|----------|-------|
| Ladybug (Coccinellidae) | Dill, fennel, yarrow, marigold | Aphids, mealybugs, scale | ~5m |
| Parasitic wasp (Braconidae) | Dill, fennel, parsley, carrot flowers | Hornworms, cabbage worms | ~3m |
| Hoverfly (Syrphidae) | Alyssum, dill, fennel, yarrow | Aphids | ~5m |
| Lacewing (Chrysopidae) | Dill, fennel, cosmos, yarrow | Aphids, mites, whiteflies | ~5m |
| Ground beetle (Carabidae) | Ground cover, mulch, low plants | Slugs, cutworms | ~1m |

### Allelopathic Compounds (Well-Documented)

| Compound | Source | Affected Plants | Radius | Mechanism |
|----------|--------|-----------------|--------|-----------|
| Juglone | Black walnut (Juglandaceae) | Solanaceae, Ericaceae | 15-20m (drip line) | Inhibits respiration |
| Thiocyanates | Brassicaceae (decomposing roots) | Small-seeded crops | 0.5-1m | Inhibits germination |
| α-terthienyl | Marigold roots (Tagetes) | Nematodes | 0.3m | Nematocidal |
| Sorgoleone | Sorghum | Broadleaf weeds | 0.5m | Inhibits photosystem II |

## What We Can Model Now vs. Later

| Feature | Data Readiness | Implementation Complexity | Priority |
|---------|---------------|--------------------------|----------|
| AM/non-mycorrhizal flag | ✅ Ready (family lookup) | Low | **M1** |
| P-uptake boost from AM | ⚠️ Relative only (1.25×) | Low | **M1** |
| N-fixation by legumes | ✅ Ready (kg/ha/yr data) | Low | **M2** |
| N-sharing via AM network | ⚠️ Qualitative only | Medium | **M2** |
| Juglone allelopathy | ✅ Ready (radius + targets) | Low | **M3** |
| Brassica residue allelopathy | ⚠️ Variable | Medium | **M3** |
| Beneficial insect attraction | ✅ Host plant data ready | Medium | **M4** |
| Pest pressure quantification | ⚠️ Hard to quantify | High | **M4 stretch** |
| Mycorrhizal establishment time | ⚠️ ~21 days general | Medium | **v2** |
| Soil microbiome diversity | ❌ No garden-scale data | High | **future** |
| Bacterial inoculants | ⚠️ Product-specific | High | **future** |
