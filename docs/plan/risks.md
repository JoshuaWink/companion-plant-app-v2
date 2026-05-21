# Risk Register

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Temporal stagger data doesn't exist in hard science form | Medium | High | Use tier system — show seed-packet data (verified) separately from empirical timing suggestions. Don't pretend certainty. |
| Variety-level differences make plant-level DTM misleading | Low | Medium | Show ranges (70-90 days), not point estimates. Let users adjust manually later. |
| Timeline UI gets complex fast on mobile | Medium | Medium | Start with simple stacked list view, not full Gantt. Progressive disclosure. |
| Zone averages don't match microclimates | Low | High | Let users manually adjust frost dates. Zone is the default, not the law. |
| Adding timing{} to 30 plants is tedious data entry | Low | High | Use university extension guides (Iowa State, etc.) as primary source. Batch research. |
| Temporal features confuse casual users | Medium | Medium | Strict isolation under "Advanced/Experimental" tab. Spatial tool stays the default. |
| `precedes` edges create complex scheduling conflicts | Medium | Low | Start with simple cases (cover crop → cash crop). Don't model complex multi-hop succession yet. |
| Farmer's Almanac data perceived as authoritative | Low | Medium | Always badge it as "Traditional Wisdom" not "Recommended". Never use it in calculations. |
| Scope creep into full farm management tool | High | Medium | Enforce milestone boundaries. Each milestone is shippable independently. The tool serves home gardeners first. |
| Reason string mining produces false positives | Low | Medium | Human review gate — no mined edge goes into production without manual validation. |
