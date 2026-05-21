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

## Next Up

### 📊 M5: Garden Stats & Theorycrafting

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

## In Progress

### 🗺️ M6: Interactive Garden Bed Planner

The feature that transforms the app from *planning engine* → **spatial design tool**.

**North Star**: Drag plants onto a physical bed layout. See companions light up green, conflicts flash red. Peek underground to see how roots interleave. Look sideways to see the vertical canopy stack. Plan before you plant.

**Three Audiences, One Tool**:
- **Hobbyist** — 4×8 raised bed on the patio. Drag, drop, done.
- **Farmer** — Multiple beds, row layouts, farm-level overview. Save/load plans.
- **Researcher** — Precise spacing, labeled plots, custom shapes for breeding experiments.

**Architecture**: Canvas-based rendering with logical grid model. Top-down primary view, side cross-section for depth/height. Beds are shape objects (rect, circle, polygon) with cell grids overlaid.

**Phases**:

| Phase | Feature | Status |
|-------|---------|--------|
| P1 | Single rectangular bed, top-down grid, drag-to-place, companion overlay | 🔨 Building |
| P2 | Side-view cross-section (roots + vertical layers for active bed) | Planned |
| P3 | Multiple beds, farm-level view, save/load layouts | Planned |
| P4 | Circular beds, L-shapes, row layouts, custom polygons | Planned |
| P5 | Crop rotation timeline — same bed across seasons | Planned |
| P6 | Spacing rules, plant-specific radius, interplanting zones | Planned |

**P1 Deliverables** (current milestone):
- Bed creator panel (dimensions: rows × cols, name)
- Canvas renderer with grid cells, plant emojis, snap-to-grid
- Plant placement via click (select plant → click cell)
- Real-time companion/conflict highlighting per cell
- Bed sidebar showing selected bed stats
- Top-down view with color-coded cells
- Side-view toggle showing root depth + vertical profile
- Clear cell / clear bed controls
- LocalStorage persistence for bed layouts

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
