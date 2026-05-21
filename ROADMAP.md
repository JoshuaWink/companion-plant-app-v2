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
