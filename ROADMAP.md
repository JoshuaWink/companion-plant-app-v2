# Companion Garden — Roadmap

> A project of passion. This really matters.

## Completed

- **M0: Spatial Companion Tool** — Rust/WASM graph engine, plant picker, companion/conflict detection
- **M1: Data Enrichment** — 30 plants with timing + family data, 16 USDA zones, 245 Python tests
- **M2: Planting Window Calculator** — Rust engine, 20 tests, WASM binding
- **M3: Timeline UI** — Zone selector, Gantt chart, today marker, frost line, responsive legend
- **M4: Temporal Edges** — Succession planting (Precedes edge type), 10 succession pairs, Succession Plan UI
- **Garden Theme** — Warm parchment/sage/honey palette, Nunito font, plant emoji chips
- **Night Mode** — Deep forest palette, 18 fireflies, 25 stars, 6 crickets, moon, localStorage toggle

## Completed (continued)

### 📊 M5: Garden Stats & Theorycrafting ✅

The feature that transforms the app from reference tool → planning engine → learning tool.

**Concept**: Every plant gets a stat sheet — quantitative attributes that explain *why* companion relationships work. The garden aggregates these into real-time metrics. Add a plant, watch the stats shift. Min-max your polyculture.

**Per-Plant Attributes** (extend `plants.json`):

| Attribute | Values | Purpose |
|-----------|--------|---------|
| `nitrogen_role` | fixer / heavy-feeder / light-feeder / neutral | Nutrient budget |
| `root_depth` | shallow / medium / deep | Subterranean diversity |
| `growth_habit` | ground-cover / low / medium / tall / climbing | Vertical space stacking |
| `water_need` | low / medium / high | Water budget |
| `sun_need` | full / partial / shade | Light layer optimization |
| `pest_deterrence` | list of pests repelled | IPM coverage |
| `pollinator_score` | 0–3 | Beneficial insect habitat |
| `yield_density` | low / medium / high | Space efficiency |

**Garden-Level Aggregation**:
- **Nitrogen Balance** — fixers vs feeders. Positive = self-sustaining.
- **Root Diversity** — how many depth layers are utilized. Higher = less competition.
- **Vertical Coverage** — ground-to-canopy ratio. Full stack = efficient light use.
- **Pest Coverage Map** — which common pests are naturally managed.
- **Pollinator Rating** — is the garden attracting beneficial insects?
- **Family Diversity** — monoculture risk index.
- **Water Profile** — total demand and consistency.

**UX Vision**: A panel with bar gauges or radar chart. Color-coded: green = strong, yellow = could improve, red = gap. Gentle suggestions like *"No nitrogen fixers — consider peas or beans."* Stats shift in real-time as plants are added/removed.

**Why it matters**: The stats teach the *why*. A user who starts by following companion suggestions eventually learns "I'm adding beans because my nitrogen balance is negative" — and now they understand polyculture at a deeper level. The theorycrafting IS the education. Serves hobbyists (traffic-light simplicity), farmers (nutrient budgets), and ag scientists (composable attribute analysis).

**Implementation phases**:
1. Populate attributes for 30 plants in `plants.json`
2. Garden-level aggregation in Rust/WASM
3. Stats panel UI with gauges and suggestions
4. Radar chart visualization (SVG or canvas)

---

### 🗺️ M6: Interactive Garden Bed Planner

The feature that transforms the app from *planning engine* → **spatial design tool** → **garden studio**.

**North Star**: A two-layer experience. Layer 1 is a warm, expressive canvas where you design your garden visually — place plants, see companions glow, feel the space. Layer 2 is a research desk where you see the math: water budgets in liters, nitrogen balance in kg/m², root competition in centimeters, yield projections in kg/m². Same garden, two lenses. One for dreaming, one for doing.

**Three Audiences, One Tool**:
- **Hobbyist** — 4×8 raised bed on the patio. Drag, drop, done. Green = good, red = bad.
- **Farmer** — Multiple beds, rows, blocks. Real dimensions. Water and nutrient budgets. Rotation planning.
- **Researcher** — Precise spacing in metric, labeled plots, exportable data, controlled experiments.

**Philosophy**: The real world isn't gridded. We want something that captures freedom and creativity but also offers grid tools and precise placement when you want them. Grid is a tool, not a cage — you can toggle it on/off like guidelines in a drawing app. Behind the scenes, everything is metric. On screen, the user chooses their unit preference.

**Architecture**: Canvas-based rendering with logical grid model. Metric internally (all dimensions in cm, areas in m², volumes in L, weights in kg). Display conversion to user's preferred unit system. Top-down primary view, side cross-section for depth/height. Beds are shape objects (rect, circle, polygon) with cell grids overlaid.

**Completed — P1** ✅:
- Canvas renderer with grid cells, plant emojis, snap-to-grid
- Plant placement via click (select plant → click cell)
- Real-time companion/conflict highlighting per cell (19 companion pairs + 6 conflicts detected in test bed)
- Side-view toggle showing root depth + vertical soil profile
- Multiple beds with tabs (tested: rectangle + circle shapes)
- Bed stats: variety count, fill ratio, companion/conflict pair counts
- LocalStorage persistence for bed layouts
- Night mode support
- Touch support for mobile

**Three Evolution Arcs**:

#### Arc A — Make the Grid Real (metric foundation)

The grid currently has no physical dimensions. "8×4" doesn't mean anything in the real world. Arc A gives every cell a real-world size and every plant a real-world footprint.

| Phase | Feature | Status |
|-------|---------|--------|
| A1 | Bed physical dimensions (width × depth in cm, height in cm) | ✅ Done |
| A2 | Per-plant spacing data in plants.json (spacing_cm, root_depth_cm, height_cm, spread_cm) | ✅ Done |
| A3 | Spacing radius overlay on grid (circles showing each plant's footprint) | ✅ Done |
| A4 | Unit preference toggle (metric/imperial) — pure display conversion | ✅ Done |
| A5 | Water budget calculator (mL/plant/day → L/bed/week) | ✅ Done |
| A6 | Nitrogen balance (kg N/m²/season — fixers vs feeders) | ✅ Done |
| A7 | Soil volume calculator (bed dimensions × depth = L of growing medium) | ✅ Done |
| A8 | Yield estimates (kg/m² expected harvest by plant) | ✅ Done |

#### Arc B — Make It Expressive (creative freedom)

The planner should feel like a garden, not a spreadsheet with emojis. Arc B adds tactile, visual richness and creative tools.

| Phase | Feature | Status |
|-------|---------|--------|
| B1 | Grid toggle — optional guidelines, freeform placement alongside snap-to-grid | Planned |
| B2 | Plant footprint circles proportional to real spread (not uniform cells) | Planned |
| B3 | Drag-and-drop plant placement + rearrangement | ✅ Done |
| B4 | Undo/redo stack | ✅ Done |
| B5 | Season scrubber — slide through months to see garden change | ✅ Done |
| B6 | Growth visualization — soft spread circles that expand through season | Planned |
| B7 | Export bed as image (PNG download) | ✅ Done |
| B8 | Soil texture and visual richness on top-down canvas | ✅ Done |

#### Arc C — Make It Scale (farmer tools)

Same engine, bigger scope. The difference between a hobbyist and a farmer is the number of beds and the depth of data.

| Phase | Feature | Status |
|-------|---------|--------|
| C1 | Farm overview — multiple beds on a property canvas with zoom/pan | Planned |
| C2 | Row/block abstractions for field-scale layouts | Planned |
| C3 | Crop rotation planner — same bed across seasons/years | ✅ Done |
| C4 | Drill-down navigation: farm → block → bed → cell | Planned |
| C5 | Custom polygon shapes for irregular beds | Planned |
| C6 | Print-friendly / PDF export of full farm plan | Planned |
| C7 | Import/export bed layouts for sharing between gardeners | ✅ Done |

**Metric Data Model** (behind the scenes):

```
bed.dimensions_cm = { width: 240, depth: 120, soil_depth: 30 }
cell_resolution_cm = 15          // 6 in — the universal grid unit
plant.spacing_cm = 60            // minimum distance between same plants
plant.root_depth_cm = 45         // actual depth, not categorical
plant.mature_height_cm = 150     // mature canopy height
plant.spread_cm = 60             // mature canopy/ground spread
plant.water_ml_per_day = 500     // per-plant water need
plant.nitrogen_kg_per_m2 = 0.02  // nitrogen contribution (+) or demand (-)
plant.yield_kg_per_m2 = 3.5      // expected harvest density
```

All calculations in metric. `displayLength(cm, pref)` → `"24 in"` or `"60 cm"`. The conversion is a display concern, never a data concern.

---

### 🌿 M7: Growth Simulation Engine

The feature that transforms the planner from *static layout* → **living, breathing physiological model**. Plants grow, respond to weather, compete for resources, and produce yield over time — all simulated day-by-day in Rust/WASM.

**Philosophy**: A garden planner that doesn't model growth is a coloring book. Real planning requires understanding *what happens after you plant*. How tall does the corn get before the beans need to climb it? When does the tomato start fruiting? What happens if there's a late frost? The growth engine answers these questions with real physiology, not lookup tables.

**Architecture**: Stateless per-day simulation via `simulate_plant(genetics, day, env, gdd)` → `Snapshot`. Season simulation carries soil moisture, structural peaks, and cumulative yield between days. All computed in Rust, compiled to WASM, called from JS.

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Core growth model — 6 growth stages, GDD accumulation, sigmoid height/spread/root curves | ✅ Done |
| 2 | Atmospheric physics — VPD, stomatal conductance, transpiration, DLI, photoperiod | ✅ Done |
| 3 | Soil physics — moisture tracking, mulch effects, soil temperature, waterlogging | ✅ Done |
| 4 | Carbon physiology — CO2 assimilation, respiration, carbon partitioning (veg vs fruit) | ✅ Done |
| 5 | Stress model — wind, nutrient limitation, water stress, lodging resistance | ✅ Done |
| 6 | Yield model — GrowthHabit (determinate/indeterminate/cut-and-come), HarvestType (fruit/leaf/root/grain/pod/whole), daily yield rate, cumulative yield, harvest flush tracking | ✅ Done |
| 7 | Environment termination — frost kill (kill_temp_c), heat ceiling, env_terminated flag | ✅ Done |
| 8 | Node architecture — branching model, productive vs spent nodes, maintenance biomass tax, productive_fraction decline over season | ✅ Done |
| 9 | Weather integration — real NOAA/Open-Meteo weather data driving day-by-day simulation | ✅ Done |
| 10 | Growth chart UI — interactive multi-metric chart with weather overlay | ✅ Done |

**Current stats**: 110 tests, ~2900 lines Rust, 10 physiology functions, 6 growth stages, 3 growth habits, 6 harvest types.

**Remaining physiology gaps** (each is a future phase):
- Canopy energy balance (radiation interception, leaf energy budget)
- Root water uptake model (depth-dependent extraction)
- Mycorrhizal network effects (see symbiotic-network.md)
- Pest/disease pressure model
- Vernalization requirements (cold hours for perennials)
- Allelopathy (chemical plant-plant interactions)
- Rubisco kinetics (C3 vs C4 vs CAM photosynthesis detail)

---

### 🌍 M8: Ecology & Wildlife Simulation

The feature that transforms the tool from *garden planner* → **ecological research instrument**. Model plants in wild/natural environments without human intervention. Predict food availability for wildlife. Assess climate change impact on plant communities.

**The Vision**: A muscadine vine grows wild in Zone 7b. No irrigation, no fertilizer, no pruning. How many kg of fruit does it produce? When does the fruit ripen? How long is it available? Now multiply by the vine density in a forest edge habitat — that's the food budget for the birds, deer, and raccoons that depend on it. Shift the temperature +2°C and re-run. Does the vine still fruit? Does it fruit earlier? Does the heat ceiling kill the flowers? This is the question conservation biologists need answered, and it's the same engine we already built for garden planning.

**Natural/Wild Simulation Mode**:
- Water = precipitation only (no irrigation supplement)
- Nutrients = ambient soil baseline (no fertilizer input)
- No pruning — maintenance biomass accumulates unchecked, productive_fraction declines naturally
- No pest management — full pest/disease pressure applied
- The yield curve under these constraints = **what wildlife actually gets to eat**

**Ecological Questions This Enables**:

| Question | How the Engine Answers It |
|----------|--------------------------|
| When does wild fruit become available? | Simulate season under local weather → first `is_producing = true` day |
| How much food does a habitat patch produce? | `cumulative_yield_kg × plant_density × patch_area` |
| What happens under climate change? | Re-run with +2°C offset → compare yield, timing, frost/heat kill |
| Which keystone species are most vulnerable? | Simulate multiple species → find those where small temp shifts cause `env_terminated` |
| Does a late frost destroy the berry crop? | Simulate with actual weather data including frost events → check `env_terminated` flag |
| How does food web timing shift? | Compare `is_producing` windows across species under different climate scenarios |

**Implementation Phases**:

| Phase | Feature | Status |
|-------|---------|--------|
| E1 | Natural mode flag — disables irrigation/fertilizer/pruning assumptions | Planned |
| E2 | Precipitation-only water model — rain from weather data, no supplement | Planned |
| E3 | Ambient soil nutrient baseline — region-specific defaults, no fertilizer | Planned |
| E4 | Multi-species habitat simulation — run N species on same weather/soil | Planned |
| E5 | Food availability timeline — when and how much food is available per species | Planned |
| E6 | Climate scenario modeling — temperature/precipitation offsets | Planned |
| E7 | Carrying capacity estimation — food production vs wildlife population needs | Planned |
| E8 | Perennial/tree growth — multi-year simulation for orchard and forest species | Planned |

**Data Needs**:
- Wild plant genetics (native species, not just cultivars)
- Regional soil baselines (ambient NPK by soil type)
- Wildlife food consumption rates (kg/day per species)
- Historical weather data for climate comparison

---

### 🚜 M9: Sustainable Agriculture & Input Modeling

The feature that transforms the tool from *garden/ecology simulator* → **agricultural decision-support system**. Model the full input stack — fertilizer, lime, herbicide, cover crops, mycorrhizal inoculants — and compare conventional vs regenerative approaches on real economics.

**The Core Question**: "I'm farming 50 acres of corn. I'm spending money on lime, nitrogen side-dressing, and glyphosate. What if instead I intercropped with squash for ground cover, inoculated with mycorrhizae, and rotated with nitrogen fixers? Would I spend less? Would I yield the same? Would my soil improve over time?"

This isn't theoretical — it's the question every farmer transitioning to sustainable practices needs answered. The growth engine already models plant physiology. Now we model the *inputs* and their *costs*.

**Input Tracking Model**:

| Input Category | What We Track | Unit |
|----------------|---------------|------|
| **Lime** | Application rate, soil pH response, frequency | kg/acre, pH delta |
| **Nitrogen** | Source (urea, ammonium nitrate, manure, legume fixation), timing (pre-plant, side-dress), amount | kg N/acre |
| **Phosphorus** | Source, timing, amount | kg P/acre |
| **Potassium** | Source, timing, amount | kg K/acre |
| **Herbicide** | Product (glyphosate, atrazine, etc.), application count, timing | L/acre, applications/season |
| **Fungicide** | Product, application count, timing | L/acre, applications/season |
| **Seed** | Variety, seeding rate, inoculant treatment | kg/acre |
| **Mycorrhizal inoculant** | Species, application rate, colonization timeline | spores/g, establishment_days |
| **Cover crop** | Species, seeding rate, termination method | kg/acre |
| **Water/Irrigation** | Source, volume, energy cost | L/acre/season |
| **Fuel/Passes** | Number of field operations (tillage, spraying, harvesting) | passes/season |

**Comparison Framework** — The farmer needs to see two columns side by side:

```
                        CONVENTIONAL          REGENERATIVE
Lime                    700 lb/acre           300 lb/acre (soil recovering)
Nitrogen (purchased)    150 lb N/acre         40 lb N/acre
Nitrogen (from fixers)  0                     80 lb N/acre (clover rotation)
Herbicide passes        3×/season             0 (cover crop suppression)
Cover crop seed         0                     15 lb/acre
Mycorrhizal inoculant   0                     2 lb/acre
Field passes            8/season              4/season
Projected yield         180 bu/acre           165 bu/acre (year 1-2)
                                              185 bu/acre (year 3+)
Soil organic matter     2.1% (declining)      3.4% (building)
```

**Key Modeling Challenges**:

1. **Mycorrhizal Establishment Time**: Fungal networks take 2-4 weeks to colonize roots. If you inoculate at planting, the benefit doesn't appear until mid-season. The model needs a colonization curve, not an instant buff. And the fungi need living roots to persist — fallow periods kill them.

2. **Cover Crop Competition vs Benefit**: Squash between corn rows provides ground cover (moisture retention, weed suppression) but also competes for light and nutrients. The model must balance: `ground_cover_benefit - light_competition_cost - nutrient_competition_cost`. The Three Sisters teach us this balance works — corn provides structure, beans fix nitrogen, squash covers ground.

3. **Sabbatical Year (Fallow)**: "Every 7th year, let the field rest." This isn't just spiritual wisdom — it's soil science. Fallow years allow:
   - Organic matter decomposition and nutrient cycling
   - Mycorrhizal network recovery
   - Weed seed bank depletion (no crop = no host for some weeds)
   - Soil structure recovery from compaction
   - The model should show: soil_health_index improving during fallow, then sustaining higher yields in subsequent years

4. **Multi-Year Soil Health Trajectory**: Conventional farming depletes soil organic matter. Regenerative practices build it. The difference shows up in years 3-5, not year 1. The model needs multi-year simulation with soil state carrying between seasons: organic_matter_pct, microbial_biomass, aggregate_stability, water_holding_capacity.

5. **Input → Yield Response Curves**: Adding nitrogen doesn't linearly increase yield. There's a diminishing returns curve (Mitscherlich response). At some point, more N costs money but doesn't grow more corn. The model needs to capture these plateaus.

**Implementation Phases**:

| Phase | Feature | Status |
|-------|---------|--------|
| A1 | Input tracking data model — what was applied, when, how much | Planned |
| A2 | Fertilizer response curves — N/P/K application → yield impact (Mitscherlich) | Planned |
| A3 | Lime/pH model — application rate → soil pH response over time | Planned |
| A4 | Herbicide model — weed pressure without chemical control, cover crop alternative | Planned |
| A5 | Cover crop simulation — ground cover effect on moisture, weed suppression, N fixation | Planned |
| A6 | Mycorrhizal colonization model — establishment curve, root colonization %, nutrient transfer | Planned |
| A7 | Multi-year soil health — organic matter, microbial biomass, aggregate stability tracking | Planned |
| A8 | Sabbatical/fallow year model — soil recovery during rest periods | Planned |
| A9 | Input cost calculator — quantities × unit prices = total input cost per acre | Planned |
| A10 | Side-by-side comparison UI — conventional vs regenerative scenarios | Planned |
| A11 | Break-even analysis — at what year does regenerative become more profitable? | Planned |
| A12 | Multi-field farm planning — different rotations for different fields | Planned |

**The Three Sisters as Proof of Concept**: Corn + beans + squash is the canonical example. The engine should be able to simulate:
- Corn alone + full conventional inputs → yield X, cost Y
- Three Sisters polyculture + minimal inputs → yield X', cost Y'
- And show that X' ≈ X (total food value) while Y' << Y (total cost)

This validates the model against 10,000 years of indigenous agricultural knowledge.

**Data Needs**:
- Fertilizer response curves by crop (university extension data)
- Regional soil type baselines (USDA Web Soil Survey integration)
- Input cost databases (USDA ERS, extension budgets)
- Cover crop performance data (SARE cover crop database)
- Mycorrhizal colonization rates by species (research literature)

---

### 🌾 M10: Planting Plans & Simulation Configs

The feature that separates **what to simulate** from **how to simulate it**. A planting plan is a saved configuration — which plants, when they go in, what treatments are applied, what management strategy is used. The engine loads the plan and runs the physics. Plans are portable, shareable, and versionable.

**Core Principle**: The engine is generic. It knows physics and biology. It does NOT know strategy. Strategy lives in config files authored by humans or LLMs. New techniques, new treatments, new timing strategies = new config entries, never new code.

**Planting Plan Schema** (YAML — human-authored config):

```yaml
plan_name: "Three Sisters - Block A"
sowing_date: 2026-04-15
zone: "6b"
field_acres: 50
management_mode: regenerative  # conventional | regenerative | natural

plantings:
  - plant_id: corn
    role: primary              # primary | companion | cover
    position: row
    planting_day_offset: 0     # days after sowing_date
    seed_treatments: []
    
  - plant_id: peas
    role: companion
    position: intercrop
    planting_day_offset: 0     # sown same day as corn
    seed_treatments:
      - treatment_id: germination-delay-light
    notes: "Delayed ~7 days so corn scaffolds first"
    
  - plant_id: squash
    role: cover
    position: intercrop
    planting_day_offset: 0
    seed_treatments:
      - treatment_id: germination-delay-heavy
    notes: "Delayed ~14 days, emerges after corn establishes"
```

**Seed Treatment Catalog** (YAML — extensible config, not code):

```yaml
# treatments/seed-treatments.yaml
treatments:
  - id: germination-delay-light
    name: "Light germination delay (~7 days)"
    description: "Any technique that delays germination by ~7 days"
    modifiers:
      germination_delay_days: 7
      germination_variability_days: 2

  - id: germination-delay-heavy
    name: "Heavy germination delay (~14 days)"
    modifiers:
      germination_delay_days: 14
      germination_variability_days: 3

  - id: germination-accelerate
    name: "Seed scarification / priming"
    modifiers:
      germination_delay_days: -3

  - id: mycorrhizal-inoculant
    name: "Endo mycorrhizal spore inoculant"
    modifiers:
      germination_delay_days: 0
      colonization_start_day: 14
      colonization_full_day: 35
      nutrient_uptake_boost: 0.15

  - id: rhizobium-inoculant
    name: "Rhizobium nitrogen-fixing inoculant"
    modifiers:
      nitrogen_fixation_boost: 0.25
      colonization_start_day: 7
```

**Design Rules**:
- Treatments are **generic modifiers**, not named techniques. "germination-delay-heavy" not "clay-powder-coating" — the engine doesn't care HOW, only the effect
- New techniques = new YAML entries, zero code changes
- Plans reference treatments by ID from the catalog
- Plans are saved/loaded as files — import/export for sharing between users
- YAML for configs and schemas (human-readable, comments allowed)
- JSON for data interchange (API responses, WASM calls, localStorage)
- The engine computes: `effective_germination = base_days + planting_day_offset + Σ treatment.germination_delay_days`

**Staggered Simulation**:
- Each planting in a plan has its own timeline offset
- `simulate_season` runs all plantings against the same weather data
- On calendar day N, corn is at day N, peas are at day N-7 (effective), squash at day N-14 (effective)
- Competition model (future): co-located plants interact — shading, moisture sharing, nutrient competition

**Implementation Phases**:

| Phase | Feature | Status |
|-------|---------|--------|
| P1 | Planting plan YAML schema + loader | Planned |
| P2 | Seed treatment catalog + modifier application to genetics | Planned |
| P3 | Multi-plant staggered simulation (same weather, offset timelines) | Planned |
| P4 | Plan save/load in PWA (localStorage + JSON export/import) | Planned |
| P5 | Plan comparison — run two plans against same conditions, compare yields | Planned |
| P6 | LLM plan advisor — describe goals, get a suggested plan to review | Planned |
| P7 | Competition model — co-located plants affect each other's light/water/nutrients | Planned |

**Config Directory Structure**:
```
configs/
  treatments/
    seed-treatments.yaml      # germination modifiers
    inoculants.yaml           # biological amendments
    soil-amendments.yaml      # lime, gypsum, comite
  plans/
    three-sisters-50ac.yaml   # saved farm plans
    home-garden-4x8.yaml
  soil-baselines/
    clay-loam-6b.yaml         # regional soil defaults
    sandy-7a.yaml
```

---

## Future Ideas

### 🐝 Bumblebee Cursor
Custom cursor that looks like a little bumblebee flying around the garden. CSS `cursor: url(...)` with a hand-drawn or pixel-art bee sprite. Could animate wing-beat frames on hover vs idle. Different cursor states: bee resting on a plant chip (pointer), bee carrying pollen (dragging), bee buzzing between flowers (default). Pure whimsy — this is a garden, not a spreadsheet.

### 🌱 Plant Life Cycle SVGs
Show each plant's growth stages as clean SVG illustrations — seed, sprout, seedling, vegetative, flowering, fruiting, harvest. Could appear:
- As a mini timeline below each plant chip when selected
- In the planting window Gantt bars (seed icon at start, harvest icon at end)
- As hover tooltips showing "where you are" relative to the season
- Animated transitions between stages based on current date vs planting window

Art style: simple line drawings with the garden palette colors. Could be a single SVG sprite sheet per plant or a shared set of generic stage icons with plant-specific color accents.

### 🦋 More Garden Creatures
Expand the night mode creature system to day mode too:
- Butterflies drifting between companion plants (only appear when companions are selected)
- Ladybugs on plants that have pest-deterrent companions
- Worms near soil-enriching plants
- Bees visiting flowering plants in the timeline during bloom windows

### 🗺️ Garden Bed Layout
Spatial planner — drag plants into a grid representing a physical raised bed (4×8, 4×4, etc.). The graph engine already knows what goes together; this would visualize optimal placement with spacing rules.

### 🔄 Crop Rotation
Temporal planning across seasons. Same bed, different years. Which plant families shouldn't follow each other? Build rotation schedules that maintain soil health.

### 🌍 Soil Integration
Layer soil data (pH, nutrients, drainage) on top of companion relationships. Plant-to-plant interactions (companions) + plant-to-environment interactions (soil) = complete planning.
