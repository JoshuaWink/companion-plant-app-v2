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

## M4: Temporal Edges — Succession Dependencies

> Model "Plant A prepares for Plant B" as a graph edge.

- [ ] Add `precedes` edge type to the Rust graph model
- [ ] Add `gap_days` and `mechanism` fields to precedes edges
- [ ] Research and add 5-10 well-documented succession pairs (cover crop → cash crop)
- [ ] WASM binding: `temporal_deps(plant_ids)` → sequence constraints
- [ ] Timeline UI: show dependency arrows between related timeline bars
- [ ] Warning: "Clover needs to be tilled under 2 weeks before tomatoes go in"
- [ ] TDD: test succession chain resolution

**Done when**: Selecting "crimson clover" + "tomatoes" shows the temporal dependency and timing constraint in the timeline.

---

## M5: Reason String Mining (NLP Enrichment)

> Extract temporal hints from existing 584 relationship reason strings.

- [ ] Categorize reason strings by temporal implication
- [ ] Build extraction pipeline (Python, regex + pattern matching)
- [ ] Generate candidate `precedes` edges from mined patterns
- [ ] Human review: validate or reject each candidate
- [ ] Add validated edges to relationships.json
- [ ] Mark confidence tier on each mined edge

**Done when**: Existing reason text has been mined for temporal relationships, validated candidates added to graph.

---

## M6: Crop Rotation Foundations

> Add family-based rotation rules for multi-season planning.

- [ ] Research rotation rules: nightshade 3-year, brassica 4-year, legume rotation patterns
- [ ] Define rotation constraint model (family + years_before_repeat)
- [ ] Implement rotation conflict detection in the engine
- [ ] UI: "If you grew tomatoes here last year, don't plant peppers (same family) this year"
- [ ] TDD: rotation conflict tests

**Done when**: Engine can flag rotation conflicts given planting history.

---

## Future (Not Scheduled)

- Open-Meteo weather integration ("safe to plant today?")
- Variety-level DTM and timing
- GDD (Growing Degree Day) accumulation model
- Farmer's Almanac overlay (cultural/fun)
- Bed layout spatial optimizer
- Multi-year planning calendar
- Community-contributed timing data
