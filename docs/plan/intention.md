# Intention

> Help gardeners plan what to plant, where, and **when** — not just what goes next to what, but what goes in first, what prepares the ground for what comes after, and when everything needs to happen given where they live.

## North Star

A companion planting tool that thinks in seasons, not just squares. You pick your plants, you tell it your zone, and it gives you a timeline — start seeds indoors in March, transplant after frost, direct-sow the cover crop in fall. The spatial companion graph (what we have now) becomes one layer in a richer system that also answers *when* and *in what order*.

## Why This Matters

Companion planting data tells you WHAT goes together. But a gardener standing in their yard in March doesn't need a relationship graph — they need to know what to do *today*. The temporal dimension is the bridge between "these plants are friends" and "here's your planting plan for the season."

Most companion planting apps stop at the spatial question. The temporal question — succession, staggering, preparation — is where the real planning value lives. Cover crops kill weeds before the cash crop. Nitrogen fixers prepare soil before heavy feeders. Tall plants need a head start to provide shade. The *sequence* is the strategy.

## What Success Feels Like

"I opened the app in early March, told it I'm in Zone 6b, selected my plants, and it told me: start tomatoes and peppers indoors NOW. Direct-sow lettuce in 3 weeks. Plant the clover cover crop where the tomatoes will go — you'll till it under in May. Here's your full calendar."

## Open Questions

1. **How much temporal stagger data actually exists in peer-reviewed form?** We know frost dates and DTM are solid. But "plant basil 2 weeks before tomatoes for maximum pest deterrence" — does hard data exist for that?
2. **Should zone data live in the WASM engine or the presentation layer?** Zone doesn't change the graph topology — it shifts the calendar. Leaning toward presentation layer.
3. **How do we handle variety-level differences?** "Tomatoes: 70-90 DTM" is a wide range. Cherry vs beefsteak vs indeterminate heirloom are different timelines.
4. **What's the right UI for a timeline?** Gantt chart? Calendar view? Simple ordered list? What works on a phone screen?
5. **How do `precedes` edges compose with existing companion/antagonist edges?** Can the same pair be both "companion" (spatial) and "precedes" (temporal)?
6. **Where does crop rotation fit?** It's temporal (multi-season) but separate from within-season sequencing. Same data model or separate?

## Constraints

- **Non-negotiable**: Doesn't break the working spatial tool. Lives under experimental/advanced.
- **Non-negotiable**: Zero external runtime dependencies in the WASM engine. Static data only.
- **Non-negotiable**: Offline-first. No API calls required for core functionality.
- **Flexible**: Weather API integration (nice to have, not MVP).
- **Flexible**: Farmer's Almanac data (cultural/fun, not authoritative).
- **Flexible**: Variety-level DTM (plant-level averages fine for MVP).

## Phases of Understanding

| Phase | Description | Status |
|-------|-------------|--------|
| Explore | Research temporal data sources, validate data model | **current** |
| Prototype | Add timing{} to 5 plants, build planting window calculator | not started |
| Crystallize | Validate timeline UI approach, confirm zone architecture | not started |
| Roadmap | Define milestones for experimental timeline feature | not started |
| Build | TDD implementation of timeline engine + UI | not started |
| Reflect | Does temporal data actually help gardeners plan better? | not started |


---

# M6 Intention — Garden Studio

> A two-layer garden studio: dream on the canvas, verify in the numbers.

## North Star

**Layer 1 — The Garden Canvas**: Warm, expressive, creative. Place plants and watch companions glow green, conflicts flash red. Feel the space. Freeform or grid-assisted — your choice. It's a drawing app that happens to know about plants.

**Layer 2 — The Research Desk**: Precise, metric-first, scientific. Water budget in liters per week. Nitrogen balance in kg/m²/season. Root depth in centimeters. Yield projections in kg/m². Soil volume in liters. Same garden, different lens — toggle between dreaming and doing.

The real world isn't gridded. We want something that captures the freedom and creativity of actual gardening — beds aren't always rectangles, plants don't space themselves in perfect rows, a garden evolves through a season. But we also want precision tools available when you need them: grid snapping, spacing guides, measurement overlays.

Behind the scenes, everything is metric. On screen, the user chooses their unit preference.

## Why This Matters

"Tomatoes and basil are companions" is information. Seeing them placed 60cm apart in a 1.2m × 2.4m bed, with basil's 15cm root system drawn above tomato's 60cm taproot — that's understanding. Then clicking "Research" and seeing that this bed needs 12L of water per day, produces a net nitrogen surplus of +0.3 kg/m²/season, and will yield approximately 8kg of tomatoes — that's planning.

This serves three audiences with the same tool:
- **Hobbyist**: Friendly canvas, emoji plants, green/red feedback. "My garden, my way."
- **Farmer**: Real dimensions, water/nutrient budgets, crop rotation, multi-bed management.
- **Researcher**: Metric precision, exportable data, controlled spacing, labeled experiments.

## What Success Feels Like

"I designed my raised bed on the canvas in 5 minutes — just dragging plants around, watching the companion overlay light up. Then I switched to the research view and saw that my nitrogen balance was negative, so I added some peas. The water calculator told me I need 15L/day for the whole bed. I exported the layout as an image and taped it to my shed wall."

## Answered Questions (from P1)

1. **Cell size** — 15cm (6in) base resolution internally. Display adapts to user preference.
2. **Side view** — Canvas toggle (implemented). Button switches between top-down and cross-section.
3. **Persistence** — LocalStorage works (implemented). Export/import is planned.
4. **Companion detection** — WASM graph engine queries work. 19 companion pairs detected in test bed with 17 varieties.

## Open Questions

1. **Freeform vs grid**: How do we blend freeform placement with grid snap? Toggle? Hold Shift to snap?
2. **Multi-cell plants**: Squash and watermelon need 90-120cm spread. How do we show multi-cell footprints?
3. **Season scrubber**: What data drives plant appearance changes through the season? Just planting windows or growth stages?
4. **Farm overview**: At what point does the canvas need pan/zoom? When beds > 3? When total area > 10m²?
5. **Metric data sources**: Where do we get authoritative plant spacing, water need, yield data in metric?
6. **Rotation rules**: Which plant families shouldn't follow each other? Is this graph data or a separate model?

## Constraints

- Zero dependencies — Canvas API only
- Mobile-friendly (touch + responsive)
- Night mode compatible
- WASM engine validates companion/conflict
- Offline-first
- Metric internally, user-preference display
- Two-layer architecture: canvas (visual) + research desk (data)

## The Three Arcs

| Arc | Theme | Core Question |
|-----|-------|---------------|
| **A** | Make the Grid Real | What are the actual physical measurements? |
| **B** | Make It Expressive | How does a garden feel, not just function? |
| **C** | Make It Scale | How does this work for 1 bed and 100 beds? |

## Phases

| Phase | Status |
|-------|--------|
| Explore | ✅ Done |
| Prototype | ✅ P1 Complete |
| Crystallize | 🔨 Vision defined, arcs mapped |
| Roadmap | ✅ Three arcs documented |
| Build | 🔨 Arc A next |
| Reflect | Ongoing — observed in browser, identified gaps |
