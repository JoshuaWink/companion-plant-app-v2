use serde::{Deserialize, Serialize};

/// Timing properties for a plant (mirrors the JSON timing block).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlantTiming {
    pub days_to_maturity: [u16; 2],
    pub days_to_germination: [u16; 2],
    pub frost_tolerance: String,
    pub min_soil_temp_f: u16,
    #[serde(default)]
    pub indoor_start_weeks_before_frost: Option<u16>,
    #[serde(default)]
    pub direct_sow: bool,
    #[serde(default)]
    pub transplant: bool,
    #[serde(default)]
    pub succession_sow: bool,
    #[serde(default)]
    pub succession_interval_days: Option<u16>,
}

/// A computed planting window for a specific plant + frost date.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlantingWindow {
    pub plant_id: String,
    /// Day of year to start seeds indoors (None if direct-sow only).
    pub indoor_start_doy: Option<u16>,
    /// Earliest day of year for transplant or direct sow outdoors.
    pub outdoor_earliest_doy: u16,
    /// Day of year harvest begins (earliest).
    pub harvest_start_doy: u16,
    /// Day of year harvest ends (latest).
    pub harvest_end_doy: u16,
    /// Whether this plant can be direct-sown.
    pub direct_sow: bool,
    /// Whether this plant should be started indoors and transplanted.
    pub transplant: bool,
}

/// Frost tolerance → number of days BEFORE last frost that outdoor planting is safe.
/// Positive = can plant before last frost. Negative = must wait after.
fn frost_tolerance_offset_days(tolerance: &str) -> i16 {
    match tolerance {
        "hard" => 28,     // 4 weeks before last frost
        "moderate" => 14, // 2 weeks before
        "light" => 7,     // 1 week before
        "none" => -14,    // 2 weeks AFTER last frost (safe margin)
        _ => 0,
    }
}

/// Compute the planting window for a single plant given a last-frost day-of-year.
pub fn compute_window(plant_id: &str, timing: &PlantTiming, last_frost_doy: u16) -> PlantingWindow {
    let offset = frost_tolerance_offset_days(&timing.frost_tolerance);
    let outdoor_earliest = (last_frost_doy as i16 - offset).clamp(1, 365) as u16;

    let indoor_start_doy = if timing.transplant {
        timing.indoor_start_weeks_before_frost.map(|weeks| {
            let days_before = weeks * 7;
            (last_frost_doy as i16 - days_before as i16).clamp(1, 365) as u16
        })
    } else {
        None
    };

    // Harvest: outdoor_earliest + DTM range
    let harvest_start = (outdoor_earliest + timing.days_to_maturity[0]).min(365);
    let harvest_end = (outdoor_earliest + timing.days_to_maturity[1]).min(365);

    PlantingWindow {
        plant_id: plant_id.to_string(),
        indoor_start_doy,
        outdoor_earliest_doy: outdoor_earliest,
        harvest_start_doy: harvest_start,
        harvest_end_doy: harvest_end,
        direct_sow: timing.direct_sow,
        transplant: timing.transplant,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tomato_timing() -> PlantTiming {
        PlantTiming {
            days_to_maturity: [60, 90],
            days_to_germination: [5, 10],
            frost_tolerance: "none".to_string(),
            min_soil_temp_f: 60,
            indoor_start_weeks_before_frost: Some(6),
            direct_sow: false,
            transplant: true,
            succession_sow: false,
            succession_interval_days: None,
        }
    }

    fn lettuce_timing() -> PlantTiming {
        PlantTiming {
            days_to_maturity: [30, 60],
            days_to_germination: [2, 8],
            frost_tolerance: "moderate".to_string(),
            min_soil_temp_f: 35,
            indoor_start_weeks_before_frost: Some(4),
            direct_sow: true,
            transplant: true,
            succession_sow: true,
            succession_interval_days: Some(14),
        }
    }

    fn spinach_timing() -> PlantTiming {
        PlantTiming {
            days_to_maturity: [35, 50],
            days_to_germination: [5, 9],
            frost_tolerance: "hard".to_string(),
            min_soil_temp_f: 35,
            indoor_start_weeks_before_frost: Some(4),
            direct_sow: true,
            transplant: true,
            succession_sow: true,
            succession_interval_days: Some(14),
        }
    }

    // Zone 6b: last frost = April 15 = day 105
    const ZONE_6B_LAST_FROST: u16 = 105;

    #[test]
    fn tomato_indoor_start_6_weeks_before_frost() {
        let w = compute_window("tomatoes", &tomato_timing(), ZONE_6B_LAST_FROST);
        // 6 weeks = 42 days before day 105 = day 63 (early March)
        assert_eq!(w.indoor_start_doy, Some(63));
    }

    #[test]
    fn tomato_outdoor_after_frost() {
        let w = compute_window("tomatoes", &tomato_timing(), ZONE_6B_LAST_FROST);
        // frost_tolerance "none" → 14 days AFTER last frost = day 119 (late April / early May)
        assert_eq!(w.outdoor_earliest_doy, 119);
    }

    #[test]
    fn tomato_harvest_window() {
        let w = compute_window("tomatoes", &tomato_timing(), ZONE_6B_LAST_FROST);
        // outdoor 119 + 60 = 179, outdoor 119 + 90 = 209
        assert_eq!(w.harvest_start_doy, 179);
        assert_eq!(w.harvest_end_doy, 209);
    }

    #[test]
    fn tomato_not_direct_sow() {
        let w = compute_window("tomatoes", &tomato_timing(), ZONE_6B_LAST_FROST);
        assert!(!w.direct_sow);
        assert!(w.transplant);
    }

    #[test]
    fn lettuce_moderate_frost_tolerance() {
        let w = compute_window("lettuce", &lettuce_timing(), ZONE_6B_LAST_FROST);
        // moderate → 14 days before last frost = day 91 (early April)
        assert_eq!(w.outdoor_earliest_doy, 91);
    }

    #[test]
    fn lettuce_can_direct_sow_and_transplant() {
        let w = compute_window("lettuce", &lettuce_timing(), ZONE_6B_LAST_FROST);
        assert!(w.direct_sow);
        assert!(w.transplant);
    }

    #[test]
    fn spinach_hard_frost_tolerance() {
        let w = compute_window("spinach", &spinach_timing(), ZONE_6B_LAST_FROST);
        // hard → 28 days before last frost = day 77 (mid-March)
        assert_eq!(w.outdoor_earliest_doy, 77);
    }

    #[test]
    fn spinach_harvest_early() {
        let w = compute_window("spinach", &spinach_timing(), ZONE_6B_LAST_FROST);
        // outdoor 77 + 35 = 112, outdoor 77 + 50 = 127
        assert_eq!(w.harvest_start_doy, 112);
        assert_eq!(w.harvest_end_doy, 127);
    }

    #[test]
    fn corn_no_indoor_start() {
        let timing = PlantTiming {
            days_to_maturity: [60, 100],
            days_to_germination: [5, 10],
            frost_tolerance: "none".to_string(),
            min_soil_temp_f: 60,
            indoor_start_weeks_before_frost: Some(3),
            direct_sow: true,
            transplant: false,
            succession_sow: true,
            succession_interval_days: Some(14),
        };
        let w = compute_window("corn", &timing, ZONE_6B_LAST_FROST);
        // transplant=false → no indoor start
        assert_eq!(w.indoor_start_doy, None);
    }

    #[test]
    fn warm_zone_shifts_everything_earlier() {
        // Zone 9a: last frost = Feb 15 = day 46
        let w_warm = compute_window("tomatoes", &tomato_timing(), 46);
        let w_cold = compute_window("tomatoes", &tomato_timing(), ZONE_6B_LAST_FROST);
        assert!(w_warm.outdoor_earliest_doy < w_cold.outdoor_earliest_doy);
        assert!(w_warm.harvest_start_doy < w_cold.harvest_start_doy);
    }
}
