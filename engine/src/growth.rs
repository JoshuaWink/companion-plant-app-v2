use serde::{Deserialize, Serialize};

// ── Growth stages ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrowthStage {
    Seed,
    Germinating,
    Seedling,
    Vegetative,
    Flowering,
    Fruiting,
    Senescence,
}

impl GrowthStage {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Seed => "seed",
            Self::Germinating => "germinating",
            Self::Seedling => "seedling",
            Self::Vegetative => "vegetative",
            Self::Flowering => "flowering",
            Self::Fruiting => "fruiting",
            Self::Senescence => "senescence",
        }
    }
}

// ── Sun requirement ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SunNeed {
    Full,
    Partial,
    Shade,
}

impl SunNeed {
    /// Optimal DLI (Daily Light Integral, mol/m²/day) for this category.
    pub fn optimal_dli(&self) -> f32 {
        match self {
            Self::Full => 25.0,
            Self::Partial => 15.0,
            Self::Shade => 8.0,
        }
    }
}

// ── Plant genetics (static per species) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlantGenetics {
    pub id: String,
    pub name: String,
    pub max_height_cm: f32,
    pub max_spread_cm: f32,
    pub max_root_depth_cm: f32,
    pub root_spread_cm: f32,
    pub days_to_germination: (u16, u16),
    pub days_to_maturity: (u16, u16),
    pub water_need_ml: f32,
    pub nitrogen_g_m2: f32,
    pub yield_kg_m2: f32,
    pub sun_need: SunNeed,
    pub frost_tolerance: f32, // min temp °C before damage
    pub optimal_temp: (f32, f32), // min/max °C for ideal growth
    pub family: String,
    pub growth_habit: String,
}

// ── Environment state (per-day inputs) ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub day_of_year: u16,
    pub latitude: f32,
    pub altitude_m: f32,
    pub temp_high_c: f32,
    pub temp_low_c: f32,
    pub water_ml: f32,       // water supplied this day
    pub npk_available: (f32, f32, f32), // g/m² available
    pub soil_water_factor: f32,
    pub soil_root_factor: f32,
    pub soil_n2_factor: f32,
}

// ── Stress events ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressEvent {
    pub kind: String,
    pub severity: f32, // 0.0–1.0
    pub detail: String,
}

// ── Output snapshot ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub day: u16,
    pub stage: GrowthStage,
    pub height_cm: f32,
    pub spread_cm: f32,
    pub root_depth_cm: f32,
    pub leaf_count: u16,
    pub leaf_span_cm: f32,
    pub growth_rate: f32,
    pub yield_projected_kg: f32,
    pub water_consumed_ml: f32,
    pub npk_consumed: (f32, f32, f32),
    pub stress_events: Vec<StressEvent>,
    pub dli: f32,
    pub gdd_accumulated: f32,
}

// ── Solar calculator ──

/// Day length in hours from latitude and day-of-year.
pub fn day_length_hours(latitude: f32, day_of_year: u16) -> f32 {
    let lat_rad = latitude.to_radians();
    // Solar declination (Spencer formula simplified)
    let b = (2.0 * std::f32::consts::PI * (day_of_year as f32 - 81.0)) / 365.0;
    let declination = 23.45_f32.to_radians() * b.sin();

    let cos_hour_angle = -lat_rad.tan() * declination.tan();

    if cos_hour_angle <= -1.0 {
        return 24.0; // midnight sun
    }
    if cos_hour_angle >= 1.0 {
        return 0.0; // polar night
    }

    2.0 * cos_hour_angle.acos().to_degrees() / 15.0
}

/// Daily Light Integral (DLI) estimate in mol/m²/day.
/// Simplified: proportional to day length, reduced by altitude cloud factor.
pub fn estimate_dli(latitude: f32, day_of_year: u16, altitude_m: f32) -> f32 {
    let hours = day_length_hours(latitude, day_of_year);
    // Clear-sky PPFD ≈ 2000 µmol/m²/s at peak, avg about 40% of peak
    // 1 mol = 1_000_000 µmol
    // DLI = hours × 3600 × avg_ppfd / 1_000_000
    let avg_ppfd = 800.0; // µmol/m²/s (realistic average)
    let base_dli = hours * 3600.0 * avg_ppfd / 1_000_000.0;

    // Altitude: slightly more DLI at altitude (thinner atmosphere)
    let altitude_factor = 1.0 + (altitude_m / 10000.0).min(0.15);

    base_dli * altitude_factor
}

// ── Sigmoid growth curve ──

/// Logistic (sigmoid) curve for a trait.
/// Returns value between 0 and max_val at time t.
/// k = steepness, t_mid = inflection point.
fn sigmoid(t: f32, max_val: f32, k: f32, t_mid: f32) -> f32 {
    max_val / (1.0 + (-k * (t - t_mid)).exp())
}

/// Derive sigmoid parameters from germination and maturity ranges.
fn sigmoid_params(germ: (u16, u16), mat: (u16, u16)) -> (f32, f32) {
    let germ_mid = (germ.0 as f32 + germ.1 as f32) / 2.0;
    let mat_mid = (mat.0 as f32 + mat.1 as f32) / 2.0;
    let t_mid = (germ_mid + mat_mid) / 2.0;
    // k chosen so that at germ_mid we're ~5% and at mat_mid we're ~95%
    let span = mat_mid - germ_mid;
    let k = if span > 0.0 { 6.0 / span } else { 0.1 };
    (k, t_mid)
}

// ── Growth stage classification ──

fn classify_stage(day: u16, germ: (u16, u16), mat: (u16, u16)) -> GrowthStage {
    let germ_start = germ.0;
    let germ_end = germ.1;
    let mat_start = mat.0;
    let mat_end = mat.1;

    if day < germ_start {
        GrowthStage::Seed
    } else if day <= germ_end {
        GrowthStage::Germinating
    } else if day <= germ_end + 14 {
        GrowthStage::Seedling
    } else if day <= (mat_start * 7 / 10) {
        GrowthStage::Vegetative
    } else if day <= mat_start {
        GrowthStage::Flowering
    } else if day <= mat_end + 14 {
        GrowthStage::Fruiting
    } else {
        GrowthStage::Senescence
    }
}

// ── Environment multipliers ──

/// Light multiplier: ratio of actual DLI to plant's optimal.
fn light_multiplier(dli: f32, sun_need: SunNeed) -> f32 {
    let optimal = sun_need.optimal_dli();
    let ratio = dli / optimal;
    // Below optimal: proportional reduction. Above: diminishing returns, cap at 1.1
    if ratio <= 1.0 {
        ratio.max(0.0)
    } else {
        (1.0 + 0.1 * (ratio - 1.0)).min(1.1)
    }
}

/// Temperature multiplier using Growing Degree Days concept.
/// Returns 0.0–1.0 based on how close daily avg is to optimal range.
fn temp_multiplier(temp_high: f32, temp_low: f32, optimal: (f32, f32)) -> f32 {
    let avg = (temp_high + temp_low) / 2.0;
    let (opt_min, opt_max) = optimal;
    let _opt_mid = (opt_min + opt_max) / 2.0;

    if avg >= opt_min && avg <= opt_max {
        1.0
    } else if avg < opt_min {
        let deficit = opt_min - avg;
        (1.0 - deficit / 15.0).max(0.0) // zero growth at 15°C below optimum
    } else {
        let excess = avg - opt_max;
        (1.0 - excess / 10.0).max(0.0) // heat stress steeper
    }
}

/// Water multiplier: ratio of supplied to needed, adjusted by soil factor.
fn water_multiplier(supplied: f32, needed: f32, soil_factor: f32) -> f32 {
    if needed <= 0.0 {
        return 1.0;
    }
    let effective = supplied * soil_factor;
    let ratio = effective / needed;

    if ratio < 0.3 {
        ratio / 0.3 * 0.3 // severe drought: 0–30% growth
    } else if ratio < 1.0 {
        0.3 + 0.7 * (ratio - 0.3) / 0.7 // linear ramp 30%–100%
    } else if ratio < 1.5 {
        1.0 // healthy surplus
    } else {
        // Overwatering: starts hurting
        (1.0 - (ratio - 1.5) * 0.4).max(0.2)
    }
}

/// Nitrogen multiplier: ratio of available to needed.
fn nitrogen_multiplier(available: f32, needed: f32, soil_n2_factor: f32) -> f32 {
    if needed >= 0.0 {
        // Plant is a fixer or neutral — N surplus is fine
        return 1.0;
    }
    let need_abs = needed.abs();
    let effective = available * soil_n2_factor;
    let ratio = effective / need_abs;

    if ratio < 0.5 {
        0.5 + ratio // 50%–100% growth
    } else if ratio < 1.5 {
        1.0
    } else {
        // Excess N: leggy growth, reduced fruiting
        (1.0 - (ratio - 1.5) * 0.2).max(0.6)
    }
}

// ── Stress detection ──

fn check_stress(
    env: &Environment,
    genetics: &PlantGenetics,
    water_ratio: f32,
    n_ratio: f32,
) -> Vec<StressEvent> {
    let mut events = Vec::new();
    let avg_temp = (env.temp_high_c + env.temp_low_c) / 2.0;

    // Frost damage
    if env.temp_low_c < genetics.frost_tolerance {
        let severity = ((genetics.frost_tolerance - env.temp_low_c) / 10.0).min(1.0);
        events.push(StressEvent {
            kind: "frost_damage".to_string(),
            severity,
            detail: format!("Low of {:.1}°C below tolerance {:.1}°C", env.temp_low_c, genetics.frost_tolerance),
        });
    }

    // Heat stress
    if avg_temp > genetics.optimal_temp.1 + 8.0 {
        let severity = ((avg_temp - genetics.optimal_temp.1 - 8.0) / 10.0).min(1.0);
        events.push(StressEvent {
            kind: "heat_stress".to_string(),
            severity,
            detail: format!("Avg {:.1}°C well above optimal max {:.1}°C", avg_temp, genetics.optimal_temp.1),
        });
    }

    // Drought stress
    if water_ratio < 0.3 {
        events.push(StressEvent {
            kind: "drought_stress".to_string(),
            severity: 1.0 - water_ratio / 0.3,
            detail: format!("Water at {:.0}% of need", water_ratio * 100.0),
        });
    }

    // Overwatering / root rot risk
    if water_ratio > 2.0 {
        events.push(StressEvent {
            kind: "root_rot_risk".to_string(),
            severity: ((water_ratio - 2.0) / 2.0).min(1.0),
            detail: format!("Water at {:.0}% of need", water_ratio * 100.0),
        });
    }

    // Nutrient burn (excessive N)
    if genetics.nitrogen_g_m2 < 0.0 && n_ratio > 2.0 {
        events.push(StressEvent {
            kind: "nutrient_burn".to_string(),
            severity: ((n_ratio - 2.0) / 2.0).min(1.0),
            detail: format!("N at {:.0}% of need — excess", n_ratio * 100.0),
        });
    }

    // N deficiency
    if genetics.nitrogen_g_m2 < 0.0 && n_ratio < 0.3 {
        events.push(StressEvent {
            kind: "nitrogen_deficiency".to_string(),
            severity: 1.0 - n_ratio / 0.3,
            detail: format!("N at {:.0}% of need", n_ratio * 100.0),
        });
    }

    events
}

// ── Leaf count estimation ──

/// Estimate leaf count from growth stage and spread.
fn estimate_leaf_count(spread_cm: f32, max_spread: f32, habit: &str) -> u16 {
    let ratio = (spread_cm / max_spread).min(1.0);
    let base = match habit {
        "tall" => 20.0,
        "medium" => 30.0,
        "low" => 40.0,
        "climbing" => 25.0,
        "ground-cover" => 60.0,
        _ => 25.0,
    };
    (ratio * base).round() as u16
}

// ── Growing Degree Days ──

fn gdd_for_day(temp_high: f32, temp_low: f32, base_temp: f32) -> f32 {
    let avg = (temp_high + temp_low) / 2.0;
    (avg - base_temp).max(0.0)
}

// ── Main simulation function ──

/// Simulate a single plant at a given day since planting.
/// Returns a Snapshot with all calculated metrics.
pub fn simulate_plant(
    genetics: &PlantGenetics,
    day: u16,
    env: &Environment,
    gdd_so_far: f32,
) -> Snapshot {
    // Solar
    let dli = estimate_dli(env.latitude, env.day_of_year, env.altitude_m);

    // GDD
    let base_temp = genetics.optimal_temp.0 - 5.0; // base ≈ 5°C below optimal min
    let gdd_today = gdd_for_day(env.temp_high_c, env.temp_low_c, base_temp);
    let gdd_accumulated = gdd_so_far + gdd_today;

    // Growth stage
    let stage = classify_stage(day, genetics.days_to_germination, genetics.days_to_maturity);

    // Sigmoid parameters
    let (k, t_mid) = sigmoid_params(genetics.days_to_germination, genetics.days_to_maturity);

    // Ideal trait values at this day
    let ideal_height = sigmoid(day as f32, genetics.max_height_cm, k, t_mid);
    let ideal_spread = sigmoid(day as f32, genetics.max_spread_cm, k, t_mid);
    let ideal_root = sigmoid(day as f32, genetics.max_root_depth_cm * env.soil_root_factor, k, t_mid);

    // Environment multipliers
    let light_mult = light_multiplier(dli, genetics.sun_need);
    let temp_mult = temp_multiplier(env.temp_high_c, env.temp_low_c, genetics.optimal_temp);

    // Scale water need by growth progress
    let growth_progress = (day as f32 / ((genetics.days_to_maturity.0 + genetics.days_to_maturity.1) as f32 / 2.0)).min(1.0);
    let water_need_today = genetics.water_need_ml * growth_progress;
    let water_ratio = if water_need_today > 0.0 {
        env.water_ml / water_need_today
    } else {
        1.0
    };
    let water_mult = water_multiplier(env.water_ml, water_need_today, env.soil_water_factor);

    // N multiplier
    let n_ratio = if genetics.nitrogen_g_m2 < 0.0 {
        env.npk_available.0 / genetics.nitrogen_g_m2.abs()
    } else {
        1.0
    };
    let n_mult = nitrogen_multiplier(env.npk_available.0, genetics.nitrogen_g_m2, env.soil_n2_factor);

    // Combined growth rate
    let growth_rate = (light_mult * temp_mult * water_mult * n_mult).min(1.5).max(0.0);

    // Apply growth rate to ideal values
    let height_cm = ideal_height * growth_rate;
    let spread_cm = ideal_spread * growth_rate;
    let root_depth_cm = ideal_root * growth_rate;

    // Leaf metrics
    let leaf_count = estimate_leaf_count(spread_cm, genetics.max_spread_cm, &genetics.growth_habit);
    let leaf_span_cm = spread_cm * 0.8; // leaf span ≈ 80% of canopy spread

    // Yield projection
    let yield_factor = match stage {
        GrowthStage::Fruiting | GrowthStage::Senescence => growth_rate,
        GrowthStage::Flowering => growth_rate * 0.5,
        _ => 0.0,
    };
    let yield_projected_kg = genetics.yield_kg_m2 * yield_factor;

    // Water/NPK consumed
    let water_consumed = water_need_today.min(env.water_ml);
    let n_consumed = if genetics.nitrogen_g_m2 < 0.0 {
        (genetics.nitrogen_g_m2.abs() / 180.0 * growth_progress).min(env.npk_available.0) // spread over ~180 days
    } else {
        0.0
    };

    // Stress
    let stress_events = check_stress(env, genetics, water_ratio, n_ratio);

    Snapshot {
        day,
        stage,
        height_cm,
        spread_cm,
        root_depth_cm,
        leaf_count,
        leaf_span_cm,
        growth_rate,
        yield_projected_kg,
        water_consumed_ml: water_consumed,
        npk_consumed: (n_consumed, 0.0, 0.0), // P and K placeholders
        stress_events,
        dli,
        gdd_accumulated,
    }
}

// ── Convert from plants.json metric data to PlantGenetics ──

/// Build PlantGenetics from the JSON structure in plants.json.
/// Fills defaults from family/habit when specific data is missing.
pub fn genetics_from_json(plant: &serde_json::Value) -> Option<PlantGenetics> {
    let id = plant.get("id")?.as_str()?.to_string();
    let name = plant.get("name")?.as_str()?.to_string();
    let props = plant.get("properties")?;
    let metric = props.get("metric")?;
    let timing = plant.get("timing")?;

    let sun = match props.get("sun_need").and_then(|s| s.as_str()).unwrap_or("full") {
        "partial" => SunNeed::Partial,
        "shade" => SunNeed::Shade,
        _ => SunNeed::Full,
    };

    let frost_tol = match timing.get("frost_tolerance").and_then(|s| s.as_str()).unwrap_or("none") {
        "hard" => -10.0,
        "light" => -2.0,
        _ => 0.0, // "none"
    };

    let growth_habit = props.get("growth_habit")
        .and_then(|s| s.as_str())
        .unwrap_or("medium")
        .to_string();

    // Optimal temp defaults by frost tolerance
    let optimal_temp = if frost_tol < -5.0 {
        (5.0, 25.0)  // cold-hardy
    } else if frost_tol < 0.0 {
        (10.0, 28.0) // light frost ok
    } else {
        (15.0, 32.0) // tender
    };

    let germ = timing.get("days_to_germination")
        .and_then(|a| a.as_array())
        .map(|a| {
            let lo = a.first().and_then(|v| v.as_u64()).unwrap_or(5) as u16;
            let hi = a.get(1).and_then(|v| v.as_u64()).unwrap_or(10) as u16;
            (lo, hi)
        })
        .unwrap_or((5, 10));

    let mat = timing.get("days_to_maturity")
        .and_then(|a| a.as_array())
        .map(|a| {
            let lo = a.first().and_then(|v| v.as_u64()).unwrap_or(60) as u16;
            let hi = a.get(1).and_then(|v| v.as_u64()).unwrap_or(90) as u16;
            (lo, hi)
        })
        .unwrap_or((60, 90));

    Some(PlantGenetics {
        id,
        name,
        max_height_cm: metric.get("mature_height_cm").and_then(|v| v.as_f64()).unwrap_or(60.0) as f32,
        max_spread_cm: metric.get("spread_cm").and_then(|v| v.as_f64()).unwrap_or(30.0) as f32,
        max_root_depth_cm: metric.get("root_depth_cm").and_then(|v| v.as_f64()).unwrap_or(30.0) as f32,
        root_spread_cm: metric.get("root_spread_cm").and_then(|v| v.as_f64()).unwrap_or(20.0) as f32,
        days_to_germination: germ,
        days_to_maturity: mat,
        water_need_ml: metric.get("water_ml_per_day").and_then(|v| v.as_f64()).unwrap_or(400.0) as f32,
        nitrogen_g_m2: metric.get("nitrogen_g_per_m2").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
        yield_kg_m2: metric.get("yield_kg_per_m2").and_then(|v| v.as_f64()).unwrap_or(2.0) as f32,
        sun_need: sun,
        frost_tolerance: frost_tol,
        optimal_temp,
        family: plant.get("family").and_then(|s| s.as_str()).unwrap_or("unknown").to_string(),
        growth_habit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tomato_genetics() -> PlantGenetics {
        PlantGenetics {
            id: "tomatoes".to_string(),
            name: "Tomatoes".to_string(),
            max_height_cm: 150.0,
            max_spread_cm: 60.0,
            max_root_depth_cm: 60.0,
            root_spread_cm: 80.0,
            days_to_germination: (5, 10),
            days_to_maturity: (60, 90),
            water_need_ml: 800.0,
            nitrogen_g_m2: -12.0,
            yield_kg_m2: 5.0,
            sun_need: SunNeed::Full,
            frost_tolerance: 0.0,
            optimal_temp: (15.0, 32.0),
            family: "solanaceae".to_string(),
            growth_habit: "tall".to_string(),
        }
    }

    fn summer_env() -> Environment {
        Environment {
            day_of_year: 172, // June 21
            latitude: 42.0,
            altitude_m: 200.0,
            temp_high_c: 28.0,
            temp_low_c: 16.0,
            water_ml: 800.0,
            npk_available: (12.0, 5.0, 5.0),
            soil_water_factor: 1.0,
            soil_root_factor: 1.0,
            soil_n2_factor: 1.0,
        }
    }

    #[test]
    fn test_day_length_summer_solstice() {
        let hours = day_length_hours(42.0, 172);
        assert!(hours > 14.0 && hours < 16.0, "Expected ~15h, got {}", hours);
    }

    #[test]
    fn test_day_length_winter_solstice() {
        let hours = day_length_hours(42.0, 355);
        assert!(hours > 8.0 && hours < 10.0, "Expected ~9h, got {}", hours);
    }

    #[test]
    fn test_day_length_equator() {
        let hours = day_length_hours(0.0, 80);
        assert!((hours - 12.0).abs() < 1.0, "Expected ~12h at equator, got {}", hours);
    }

    #[test]
    fn test_dli_summer() {
        let dli = estimate_dli(42.0, 172, 200.0);
        assert!(dli > 30.0 && dli < 50.0, "Expected 30-50 DLI in summer, got {}", dli);
    }

    #[test]
    fn test_sigmoid_zero() {
        let val = sigmoid(0.0, 150.0, 0.1, 40.0);
        assert!(val < 10.0, "Expected near-zero at day 0, got {}", val);
    }

    #[test]
    fn test_sigmoid_maturity() {
        let val = sigmoid(90.0, 150.0, 0.1, 40.0);
        assert!(val > 140.0, "Expected near-max at maturity, got {}", val);
    }

    #[test]
    fn test_simulate_seed_stage() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 0, &env, 0.0);
        assert_eq!(snap.stage, GrowthStage::Seed);
        assert!(snap.height_cm < 5.0, "Seed should have near-zero height");
    }

    #[test]
    fn test_simulate_mid_growth() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.height_cm > 20.0, "Mid-growth should have decent height: {}", snap.height_cm);
        assert!(snap.height_cm < 150.0, "Should not exceed max height");
        assert!(snap.leaf_count > 0);
    }

    #[test]
    fn test_simulate_maturity() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 85, &env, 1500.0);
        assert!(snap.height_cm > 100.0, "Near maturity should be tall: {}", snap.height_cm);
        assert!(snap.yield_projected_kg > 0.0, "Should project yield at fruiting");
    }

    #[test]
    fn test_frost_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.temp_low_c = -3.0;
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "frost_damage"),
                "Should detect frost stress");
    }

    #[test]
    fn test_drought_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.water_ml = 50.0; // severely under-watered
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "drought_stress"),
                "Should detect drought stress");
    }

    #[test]
    fn test_light_multiplier_full_sun() {
        let mult = light_multiplier(25.0, SunNeed::Full);
        assert!((mult - 1.0).abs() < 0.01, "Optimal DLI should give ~1.0, got {}", mult);
    }

    #[test]
    fn test_light_multiplier_shade() {
        let mult = light_multiplier(8.0, SunNeed::Full);
        assert!(mult < 0.5, "Low DLI for full-sun plant should reduce growth, got {}", mult);
    }

    #[test]
    fn test_water_overwatering() {
        let mult = water_multiplier(2500.0, 800.0, 1.0);
        assert!(mult < 1.0, "Severe overwatering should reduce growth, got {}", mult);
    }

    #[test]
    fn test_genetics_from_json() {
        let json_str = r#"{
            "id": "tomatoes", "name": "Tomatoes", "lifecycle": "annual",
            "stub": false, "family": "solanaceae",
            "properties": {
                "growth_habit": "tall", "sun_need": "full",
                "nitrogen_role": "heavy-feeder",
                "metric": {
                    "mature_height_cm": 150, "spread_cm": 60,
                    "root_depth_cm": 60, "root_spread_cm": 80,
                    "water_ml_per_day": 800, "nitrogen_g_per_m2": -12,
                    "yield_kg_per_m2": 5.0, "spacing_cm": 60
                }
            },
            "timing": {
                "days_to_maturity": [60, 90],
                "days_to_germination": [5, 10],
                "frost_tolerance": "none"
            }
        }"#;
        let val: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let g = genetics_from_json(&val).expect("Should parse genetics");
        assert_eq!(g.id, "tomatoes");
        assert_eq!(g.max_height_cm, 150.0);
        assert_eq!(g.sun_need, SunNeed::Full);
        assert_eq!(g.frost_tolerance, 0.0);
    }
}
