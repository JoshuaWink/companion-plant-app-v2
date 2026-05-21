# Companion Garden v2

> Companion planting PWA with temporal planning — know what to plant, where, and when.

## Problem

Existing companion planting tools tell you what grows well together (spatial relationships). But gardening is a temporal activity — most companion plants don't go in at the same time. Cover crops prepare soil before cash crops. Shade providers need a head start. Succession planting extends harvest windows. A gardener in March needs a *calendar*, not just a *map*.

## Solution

A three-layer system built on the existing spatial companion graph:

1. **Layer 1 — Spatial** (done): Who are companions? Who conflicts? Pick plants, see relationships.
2. **Layer 2 — Calendar** (next): Given your zone, when does each plant go in? Start indoors vs direct sow? Transplant windows?
3. **Layer 3 — Sequence** (future): What prepares the ground for what? Cover crop → till under → transplant. Temporal edges in the graph.

## Scope

### In Scope
- Temporal data enrichment of existing 30 full plants (timing properties)
- USDA zone → frost date mapping (static table)
- Planting window calculator (zone + plant timing → calendar dates)
- Timeline UI (experimental section of the PWA)
- `precedes` edge type for succession dependencies
- Plant family data for crop rotation foundations

### Out of Scope (for now)
- Weather API integration
- Variety-level data (e.g., cherry vs beefsteak tomato)
- Multi-season rotation planner
- Spatial bed layout optimizer
- Farm-scale planning

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| petgraph + WASM for graph engine | Zero-dep, offline-first, fast | 2026-05-20 |
| Zone data in presentation layer, not engine | Zone shifts calendar but doesn't change graph topology | 2026-05-21 |
| Temporal features under experimental flag | Don't break working spatial tool | 2026-05-21 |
| Static frost date table (no API) | Offline-first, 13 zones is small | 2026-05-21 |
| Plant-level DTM averages, not variety-level | Good enough for MVP, data is available | 2026-05-21 |
| Mine reason strings for temporal hints | Existing 584 edges encode implicit temporal info | 2026-05-21 |
