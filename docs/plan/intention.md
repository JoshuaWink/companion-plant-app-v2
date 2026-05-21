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

# M6 Intention — Interactive Garden Bed Planner

> Let people see their garden before they build it.

## North Star

A spatial design tool where you drag plants onto physical bed layouts. The companion graph engine validates every placement in real-time — companions glow green, conflicts flash red. You can peek underground to see root interleaving. Look sideways to see the vertical canopy. Plan before you plant.

## Why This Matters

The companion planting data is powerful but abstract. "Tomatoes and basil are companions" is information. Seeing them placed 12 inches apart in a 4×8 bed, with basil's shallow roots drawn above tomato's deep taproots — that's understanding. The spatial planner closes the gap between knowing and doing.

This serves three audiences with the same tool:
- **Hobbyist**: "Where do I put things in my raised bed?"
- **Farmer**: "How do I lay out multiple beds and rotate across seasons?"
- **Researcher**: "How do I design controlled planting experiments with precise spacing?"

## What Success Feels Like

"I dragged 8 plants onto my bed and the tool showed me exactly why that layout works — the roots don't compete, the tall plants shade the lettuce, and the marigolds protect the perimeter. I printed the layout and took it to the garden."

## Open Questions

1. Cell size — 6" or 12" squares? Configurable per bed?
2. Multi-cell plants — squash, watermelon span multiple cells
3. Side view — separate panel or canvas toggle?
4. Persistence — LocalStorage MVP, export/import for sharing
5. Spacing data — do we need per-plant spacing in plants.json?

## Constraints

- Zero dependencies — Canvas API only
- Mobile-friendly (touch drag)
- Night mode compatible
- WASM engine validates companion/conflict
- Offline-first

## Phases

| Phase | Status |
|-------|--------|
| Explore | ✅ Done |
| Prototype | 🔨 Building |
| Crystallize | 🔨 Building |
| Roadmap | ✅ Done |
| Build | 🔨 P1 In Progress |
| Reflect | Not started |
