# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  PWA (Presentation)                                         │
│  ┌───────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Plant Picker   │  │ Timeline View    │  │ Zone Config │  │
│  │ (spatial UI)   │  │ (temporal UI)    │  │ (settings)  │  │
│  └───────────────┘  └──────────────────┘  └─────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Zone Engine (JS — planting window math)             │   │
│  │  zone + frost dates + plant timing → calendar dates  │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  WASM Engine (Rust)                                         │
│  ┌───────────────────┐  ┌────────────────────────────────┐  │
│  │ CompanionGraph    │  │ TimelineGraph (experimental)   │  │
│  │ - companions()    │  │ - temporal_deps(plant_ids)     │  │
│  │ - antagonists()   │  │ - suggested_sequence(ids)      │  │
│  │ - conflicts()     │  │ - precedes_chain(source)       │  │
│  └───────────────────┘  └────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Data Layer (static JSON, bundled in PWA)                   │
│  ┌────────────┐ ┌──────────────────┐ ┌───────────────────┐  │
│  │ plants.json│ │relationships.json│ │ zones.json        │  │
│  │ +timing{}  │ │ +precedes edges  │ │ frost dates/zone  │  │
│  └────────────┘ └──────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### Plant Node (extended)

```jsonc
{
  "id": "tomatoes",
  "name": "Tomatoes",
  "lifecycle": "annual",
  "stub": false,
  "family": "solanaceae",          // NEW — for crop rotation
  "properties": { /* existing spatial properties */ },
  "timing": {                       // NEW — temporal data
    "days_to_maturity": [70, 90],
    "days_to_germination": [5, 10],
    "frost_tolerance": "none",      // none | light | moderate | hard
    "min_soil_temp_f": 60,
    "indoor_start_weeks_before_frost": 6,
    "direct_sow": true,
    "transplant": true,
    "succession_sow": false,
    "succession_interval_days": null
  }
}
```

### Relationship Edge (extended)

```jsonc
// Existing: companion/antagonist (spatial)
{
  "source": "basil",
  "target": "tomatoes",
  "type": "companion",
  "reason": "Repels hornworms, improves yield"
}

// New: precedes (temporal succession)
{
  "source": "crimson-clover",
  "target": "tomatoes",
  "type": "precedes",
  "reason": "Fixes nitrogen, suppresses weeds; till under 2-3 weeks before transplant",
  "gap_days": [14, 21],
  "mechanism": "soil_prep"   // soil_prep | shade_establishment | pest_barrier | weed_suppression
}
```

### Zone Table

```jsonc
// zones.json — static, small (~13 entries)
{
  "4a": { "last_frost_avg": "05-15", "first_frost_avg": "09-25", "growing_season_days": 133 },
  "4b": { "last_frost_avg": "05-10", "first_frost_avg": "09-30", "growing_season_days": 143 },
  "5a": { "last_frost_avg": "05-01", "first_frost_avg": "10-05", "growing_season_days": 157 },
  "5b": { "last_frost_avg": "04-25", "first_frost_avg": "10-10", "growing_season_days": 168 },
  "6a": { "last_frost_avg": "04-20", "first_frost_avg": "10-15", "growing_season_days": 178 },
  "6b": { "last_frost_avg": "04-15", "first_frost_avg": "10-20", "growing_season_days": 188 },
  "7a": { "last_frost_avg": "04-05", "first_frost_avg": "10-30", "growing_season_days": 208 },
  "7b": { "last_frost_avg": "03-25", "first_frost_avg": "11-05", "growing_season_days": 225 },
  "8a": { "last_frost_avg": "03-15", "first_frost_avg": "11-15", "growing_season_days": 245 },
  "8b": { "last_frost_avg": "03-05", "first_frost_avg": "11-25", "growing_season_days": 265 },
  "9a": { "last_frost_avg": "02-15", "first_frost_avg": "12-05", "growing_season_days": 293 },
  "9b": { "last_frost_avg": "02-01", "first_frost_avg": "12-15", "growing_season_days": 317 },
  "10a": { "last_frost_avg": "01-15", "first_frost_avg": "12-25", "growing_season_days": 345 }
}
```

## Data Flow

### Spatial Query (existing)
```
User selects plants → WASM Garden.companions(id) → green chips
                    → WASM Garden.antagonists(id) → red chips
                    → WASM Garden.conflicts(ids) → conflict list
```

### Temporal Query (new)
```
User selects plants + zone
  → JS ZoneEngine computes planting windows per plant:
      last_frost_date - indoor_start_weeks = indoor_start_date
      last_frost_date + (frost_tolerance offset) = transplant_date
      min_soil_temp → earliest direct_sow_date
  → WASM TimelineGraph.temporal_deps(ids) → sequence constraints
  → JS merges windows + constraints → Timeline UI
```

### Key Insight: Separation of Concerns

The **WASM engine** handles graph structure: who depends on whom, what sequence is required.

The **JS zone engine** handles calendar math: given a zone's frost dates, translate relative timing into absolute dates.

This means the WASM engine is zone-agnostic (testable, deterministic) and the zone layer is pure arithmetic (also testable, no graph logic).

## Confidence Tiers

Every piece of temporal data gets a confidence marker:

| Tier | Label | Source | Example |
|------|-------|--------|---------|
| 1 | **verified** | Seed packet, USDA, NOAA | Frost dates, DTM, zone boundaries |
| 2 | **consensus** | Extension services, Master Gardener | Indoor start weeks, frost tolerance |
| 3 | **empirical** | Generations of practice, some studies | Companion timing offsets |
| 4 | **traditional** | Farmer's Almanac, oral tradition | "Plant when oak leaves are mouse-ear sized" |
| 5 | **speculative** | No hard data, reasonable inference | "Basil needs 2-week head start for pest effect" |

The UI should surface this: tier 1-2 data shown confidently, tier 3+ shown with "experimental" or "traditional wisdom" badge.

## External Data Sources

| Source | What | Cost | Use For |
|--------|------|------|---------|
| USDA Zone Map | Zone by zip/lat-long | Free | Zone selection |
| NOAA Climate Normals | Station-level frost dates | Free | More precise than zone averages |
| Open-Meteo | Current + forecast weather | Free (10k/day) | V2: "should I plant today?" |
| Seed catalogs (Johnny's, Burpee) | DTM, spacing, timing | Free (scrape) | Plant timing data |
| University Extension | Regional planting guides | Free | Validation of timing data |
| Farmer's Almanac | Long-range predictions | Paid | Fun/cultural, not authoritative |
