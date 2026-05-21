# Milestones

## M0: Spatial Companion Tool (DONE ✓)

- [x] Data migration from legacy JS → typed JSON (132 plants, 584 edges)
- [x] Rust/petgraph graph engine with WASM bindings
- [x] PWA with plant picker, garden bed, conflict/companion results
- [x] 26 migration tests, 10 engine tests
- [x] UX polish: cards, stubs hidden, badges, all-clear feedback
- [x] Pushed to private repo (JoshuaWink/companion-plant-app-v2)

---

## M1: Data Enrichment — Timing Properties (DONE ✓)

- [x] Research DTM, frost tolerance, indoor start weeks for all 30 plants
- [x] Define `timing` schema in a JSON Schema file
- [x] Add `timing{}` block to all 30 full plants in `plants.json`
- [x] Add `family` field (botanical family) to all 30 full plants
- [x] Create `zones.json` with USDA zones 3a–10b frost date averages
- [x] Write validation test: every non-stub plant has complete timing data
- [x] Write validation test: every plant has a family assignment
- [x] Document data sources used for each plant's timing values

---

## M2: Planting Window Calculator (DONE ✓)

- [x] Define `PlantingWindow` struct: indoor_start, outdoor_earliest, harvest_start, harvest_end
- [x] Implement calculator in Rust (zone-agnostic: takes frost_date as input)
- [x] TDD: 10 test cases covering different frost tolerances and start methods
- [x] WASM binding: `planting_windows(timing_json, last_frost_doy)` → JSON
- [x] JS zone engine: resolve zone → frost dates, call WASM, get calendar dates

---

## M3: Timeline UI (DONE ✓)

- [x] Add "Planting Timeline" section to the PWA
- [x] Zone selector UI (dropdown of 16 USDA zones 3a–10b)
- [x] Gantt-style timeline: horizontal bars per plant on a month axis (Jan–Dec)
- [x] Color coding: 🟣 Indoor start | 🟢 Outdoor | 🟡 Harvest
- [x] Last frost line (red) per row
- [x] Current date marker ("you are here" — cyan today line)
- [x] Responsive: mobile layout (<600px) with stacked rows and full-width bars
- [x] Integration: selecting plants in the spatial picker updates the timeline
- [x] Legend with all 5 visual elements
- [x] Deployed to GitHub Pages: joshuawink.github.io/companion-plant-app-v2

---

## M4: Temporal Edges — Succession Dependencies (DONE ✓)

> Model "Plant A prepares for Plant B" as a graph edge.

- [x] Add `precedes` edge type to the Rust graph model
- [x] Add `gap_days` and `mechanism` fields to precedes edges
- [x] Research and add 10 well-documented succession pairs (cover crop → cash crop)
- [x] WASM binding: `temporal_deps(plant_ids)` → sequence constraints
- [x] Succession Plan UI in PWA
- [x] TDD: test succession chain resolution

---

## M5: Garden Stats & Theorycrafting (DONE ✓)

> Per-plant quantitative attributes + garden-level aggregation metrics.

- [x] Enrich plants.json: spacing_cm, root_depth_cm, height_cm, spread_cm, water_ml_per_day, nitrogen_kg_per_m2, yield_kg_per_m2
- [x] 38 fully enriched plants with metric data
- [x] Garden-level aggregation: water budget, nitrogen balance, yield estimates
- [x] Stats panel UI with labeled metric values

---

## M6: Interactive Garden Bed Planner (IN PROGRESS)

> Spatial design tool — canvas-based bed planner with metric foundation.

### P1: Core Planner (DONE ✓)

- [x] Canvas renderer with grid cells, plant emojis, snap-to-grid
- [x] Plant placement via click (select plant → click cell)
- [x] Real-time companion/conflict highlighting per cell
- [x] Side-view toggle showing root depth + vertical soil profile
- [x] Multiple beds with tabs (rectangle + circle shapes)
- [x] Bed stats: variety count, fill ratio, companion/conflict pair counts
- [x] LocalStorage persistence for bed layouts
- [x] Night mode + touch support

### Arc A: Metric Foundation (DONE ✓)

- [x] Bed physical dimensions (width × depth × soil_depth in cm)
- [x] Spacing radius overlay on grid (dashed circles per plant)
- [x] Unit preference toggle (metric ↔ imperial, pure display conversion)
- [x] Water budget (L/week), nitrogen balance (g/m²), soil volume (L), yield (kg)
- [x] 301 Python + 20 Rust tests passing

### Arc B: Make It Expressive (DONE ✓)

- [x] Undo/redo stack (Ctrl+Z / Ctrl+Shift+Z, max 50 states)
- [x] Drag-and-drop: rearrange plants on canvas + drag from palette
- [x] Season month scrubber: Jan→Dec slider dims out-of-season plants
- [x] Export bed as PNG image (📸 button)
- [x] Soil texture on empty cells (procedural earth dots)

### Arc C: Make It Scale — partial (IN PROGRESS)

- [x] Import/export bed layouts as JSON for sharing
- [x] Crop rotation: save layout snapshots, switch between seasons
- [x] Event delegation for robust dynamic UI
- [ ] Farm overview — multiple beds on a property canvas with zoom/pan
- [ ] Row/block abstractions for field-scale layouts
- [ ] Drill-down navigation: farm → block → bed → cell
- [ ] Custom polygon shapes for irregular beds
- [ ] Print-friendly / PDF export of full farm plan

### Remaining Arc B items

- [ ] Grid toggle — optional guidelines, freeform placement
- [ ] Plant footprint circles proportional to real spread
- [ ] Growth visualization — soft spread circles that expand through season

---

## Future (Not Scheduled)

- Open-Meteo weather integration ("safe to plant today?")
- Variety-level DTM and timing
- GDD (Growing Degree Day) accumulation model
- Bumblebee cursor + garden creatures
- Plant life cycle SVGs
- Soil integration layer
- Reason string mining (NLP enrichment from 584 relationship reason strings)
