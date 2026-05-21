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
| A1 | Bed physical dimensions (width × depth in cm, height in cm) | Planned |
| A2 | Per-plant spacing data in plants.json (spacing_cm, root_depth_cm, height_cm, spread_cm) | Planned |
| A3 | Spacing radius overlay on grid (circles showing each plant's footprint) | Planned |
| A4 | Unit preference toggle (metric/imperial) — pure display conversion | Planned |
| A5 | Water budget calculator (mL/plant/day → L/bed/week) | Planned |
| A6 | Nitrogen balance (kg N/m²/season — fixers vs feeders) | Planned |
| A7 | Soil volume calculator (bed dimensions × depth = L of growing medium) | Planned |
| A8 | Yield estimates (kg/m² expected harvest by plant) | Planned |

#### Arc B — Make It Expressive (creative freedom)

The planner should feel like a garden, not a spreadsheet with emojis. Arc B adds tactile, visual richness and creative tools.

| Phase | Feature | Status |
|-------|---------|--------|
| B1 | Grid toggle — optional guidelines, freeform placement alongside snap-to-grid | Planned |
| B2 | Plant footprint circles proportional to real spread (not uniform cells) | Planned |
| B3 | Drag-and-drop plant placement + rearrangement | Planned |
| B4 | Undo/redo stack | Planned |
| B5 | Season scrubber — slide through months to see garden change | Planned |
| B6 | Growth visualization — soft spread circles that expand through season | Planned |
| B7 | Export bed as image (PNG download) | Planned |
| B8 | Soil texture and visual richness on top-down canvas | Planned |

#### Arc C — Make It Scale (farmer tools)

Same engine, bigger scope. The difference between a hobbyist and a farmer is the number of beds and the depth of data.

| Phase | Feature | Status |
|-------|---------|--------|
| C1 | Farm overview — multiple beds on a property canvas with zoom/pan | Planned |
| C2 | Row/block abstractions for field-scale layouts | Planned |
| C3 | Crop rotation planner — same bed across seasons/years | Planned |
| C4 | Drill-down navigation: farm → block → bed → cell | Planned |
| C5 | Custom polygon shapes for irregular beds | Planned |
| C6 | Print-friendly / PDF export of full farm plan | Planned |
| C7 | Import/export bed layouts for sharing between gardeners | Planned |

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
