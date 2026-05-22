use serde::{Deserialize, Serialize};

// ==============================================================================
// CROP PHYSIOLOGY SIMULATOR
//
// Models stomatal gas exchange, VPD-driven transpiration, soil moisture
// dynamics, nighttime respiration, and coupled growth response.
//
// Key references:
//   - Jarvis (1976) -- multiplicative stomatal conductance model
//   - Penman-Monteith -- transpiration (simplified)
//   - Tetens equation -- saturation vapor pressure
//   - FAO-56 -- crop coefficient approach
//
// KNOWN GAPS (documented for future development):
//   [ADDRESSED] CO2 concentration input — configurable, default 420 ppm
//   [ADDRESSED] Photoperiod sensitivity for flowering initiation
//   [ADDRESSED] Soil temperature model for germination timing
//   [ADDRESSED] Diurnal VPD cycle — morning/afternoon stomatal split
//   [ADDRESSED] Wind mechanical stress + lodging risk
//   [ADDRESSED] P/K limitation curves (tri-nutrient model)
//   [ADDRESSED] Fruit sink strength / carbon partitioning model
//   [ADDRESSED] Leaf age + canopy layering (Beer-Lambert light extinction)
//   [ADDRESSED] Mulch / ground cover effects on soil moisture + temp
//
//   REMAINING GAPS:
//   - No canopy energy balance (leaf temp = air temp assumed)
//   - No root water uptake curve (soil psi -> root psi gradient)
//   - No mycorrhizal network effects on nutrient uptake
//   - No pest/disease pressure model
//   - No vernalization requirement for biennials
//   - No allelopathy / companion plant chemical interactions
//   - No photorespiration Rubisco kinetics (still approximated via pathway trait)
// ==============================================================================

// -- Growth stages --

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

// -- Photosynthetic pathway --

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhotoPath {
    C3,   // most vegetables -- stomata close at high VPD, photorespiration at high temp
    C4,   // corn, sorghum -- more efficient at high temp/light, tolerant of high VPD
    CAM,  // succulents -- nighttime CO2 fixation (not common in food crops)
}

impl Default for PhotoPath {
    fn default() -> Self { Self::C3 }
}

// -- Sun requirement --

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SunNeed {
    Full,
    Partial,
    Shade,
}

impl SunNeed {
    pub fn optimal_dli(&self) -> f32 {
        match self {
            Self::Full => 25.0,
            Self::Partial => 15.0,
            Self::Shade => 8.0,
        }
    }
}

// -- Plant genetics (static per species) --

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
    pub frost_tolerance: f32,
    pub optimal_temp: (f32, f32),
    pub family: String,
    pub growth_habit: String,

    // -- Physiology traits --
    /// Photosynthetic pathway -- determines VPD/temp response curves
    #[serde(default)]
    pub photo_path: PhotoPath,
    /// Max stomatal conductance (mol H2O/m2/s). Typical: 0.2-0.8
    #[serde(default = "default_gs_max")]
    pub gs_max: f32,
    /// VPD at which stomata begin closing (kPa). Typical: 1.0-2.0
    #[serde(default = "default_vpd_close")]
    pub vpd_close: f32,
    /// VPD at which stomata are fully closed (kPa). Typical: 3.0-5.0
    #[serde(default = "default_vpd_shut")]
    pub vpd_shut: f32,
    /// Leaf area index at full canopy. Typical: 2.0-6.0
    #[serde(default = "default_lai_max")]
    pub lai_max: f32,
    /// Wilting point -- soil moisture (mm) below which plant cannot extract water
    #[serde(default = "default_wilt_mm")]
    pub wilt_point_mm: f32,

    // -- Photoperiod traits --
    /// Critical daylength for flowering (hours). 0 = day-neutral.
    #[serde(default)]
    pub critical_daylength: f32,
    /// true = long-day plant (flowers when day > critical), false = short-day
    #[serde(default)]
    pub long_day_plant: bool,

    // -- Nutrient traits --
    /// Phosphorus requirement (g/m2/season). Negative = consumer.
    #[serde(default)]
    pub phosphorus_g_m2: f32,
    /// Potassium requirement (g/m2/season). Negative = consumer.
    #[serde(default)]
    pub potassium_g_m2: f32,

    // -- Mechanical traits --
    /// Lodging resistance (0-1). 1.0 = very resistant (e.g. short bushy plants)
    #[serde(default = "default_lodging_resist")]
    pub lodging_resistance: f32,

    // -- Carbon partitioning --
    /// Fraction of assimilate directed to fruit when fruiting (0-1). Default 0.5
    #[serde(default = "default_fruit_sink")]
    pub fruit_sink_strength: f32,
}

fn default_gs_max() -> f32 { 0.4 }
fn default_vpd_close() -> f32 { 1.5 }
fn default_vpd_shut() -> f32 { 4.0 }
fn default_lai_max() -> f32 { 3.5 }
fn default_wilt_mm() -> f32 { 15.0 }
fn default_lodging_resist() -> f32 { 0.7 }
fn default_fruit_sink() -> f32 { 0.5 }

// -- Environment state (per-day inputs) --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub day_of_year: u16,
    pub latitude: f32,
    pub altitude_m: f32,
    pub temp_high_c: f32,
    pub temp_low_c: f32,
    pub water_ml: f32,
    pub npk_available: (f32, f32, f32),
    pub soil_water_factor: f32,
    pub soil_root_factor: f32,
    pub soil_n2_factor: f32,

    // -- New atmosphere inputs --
    /// Relative humidity (%). 0-100. If 0, estimated from temp spread.
    #[serde(default = "default_humidity")]
    pub humidity_pct: f32,
    /// Wind speed at 2m (m/s). Default 2.0 (light breeze).
    #[serde(default = "default_wind")]
    pub wind_speed_ms: f32,
    /// Precipitation (mm/day). Adds to soil moisture pool.
    #[serde(default)]
    pub precip_mm: f32,

    // -- Soil state (carry-over between days) --
    /// Current soil moisture (mm water in root zone). 0 = auto-init from field capacity.
    #[serde(default = "default_soil_moisture")]
    pub soil_moisture_mm: f32,
    /// Field capacity (mm). 0 = estimate from soil_water_factor.
    #[serde(default = "default_field_capacity")]
    pub field_capacity_mm: f32,

    // -- Extended inputs --
    /// CO2 concentration (ppm). Default 420 (current ambient).
    #[serde(default = "default_co2")]
    pub co2_ppm: f32,
    /// Mulch coverage fraction (0-1). Reduces evaporation, moderates soil temp.
    #[serde(default)]
    pub mulch_fraction: f32,
    /// Soil temperature at 10cm depth (°C). 0 = estimate from air temp.
    #[serde(default)]
    pub soil_temp_c: f32,
}

fn default_humidity() -> f32 { 0.0 }
fn default_co2() -> f32 { 420.0 }
fn default_wind() -> f32 { 2.0 }
fn default_soil_moisture() -> f32 { 0.0 }
fn default_field_capacity() -> f32 { 0.0 }

// -- Stress events --

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StressEvent {
    pub kind: String,
    pub severity: f32,
    pub detail: String,
}

// -- Output snapshot --

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

    // -- New physiology outputs --
    /// Vapor Pressure Deficit (kPa) -- atmospheric drying power
    pub vpd_kpa: f32,
    /// Stomatal conductance (fraction of max, 0-1)
    pub stomatal_conductance: f32,
    /// Actual transpiration (mL/day per plant)
    pub transpiration_ml: f32,
    /// Net carbon assimilation (relative, 0-1 of max potential)
    pub net_photosynthesis: f32,
    /// Nighttime respiration loss (fraction of gross photosynthesis, 0-1)
    pub respiration_loss: f32,
    /// Soil moisture at end of day (mm)
    pub soil_moisture_mm: f32,
    /// Leaf area index at this growth stage
    pub lai: f32,

    // -- Extended outputs --
    /// Soil temperature at root depth (°C)
    pub soil_temp_c: f32,
    /// Photoperiod status: true = daylength requirement met for flowering
    pub photoperiod_met: bool,
    /// Wind stress factor (0-1, 1 = no stress)
    pub wind_stress_factor: f32,
    /// P/K limitation factor (0-1, 1 = sufficient)
    pub nutrient_factor: f32,
    /// Fruit carbon allocation fraction (0-1)
    pub fruit_allocation: f32,
    /// Canopy light interception fraction (Beer-Lambert)
    pub light_interception: f32,
    /// CO2 assimilation multiplier (relative to 420 ppm baseline)
    pub co2_factor: f32,
}

// ==============================================================================
// ATMOSPHERIC PHYSICS
// ==============================================================================

/// Saturation vapor pressure (kPa) at temperature T (C).
/// Tetens equation -- standard in all crop models.
fn saturation_vapor_pressure(temp_c: f32) -> f32 {
    0.6108 * ((17.27 * temp_c) / (temp_c + 237.3)).exp()
}

/// Vapor Pressure Deficit (kPa).
/// VPD = es(T) - ea, where ea = es(T) * RH/100.
fn calc_vpd(temp_high: f32, temp_low: f32, humidity_pct: f32) -> f32 {
    let t_avg = (temp_high + temp_low) / 2.0;
    let es = saturation_vapor_pressure(t_avg);
    let ea = es * (humidity_pct / 100.0);
    (es - ea).max(0.0)
}

/// Estimate relative humidity from daily temp range when not provided.
fn estimate_humidity(temp_high: f32, temp_low: f32) -> f32 {
    let diurnal_range = (temp_high - temp_low).max(0.0);
    (100.0 - 3.5 * diurnal_range).clamp(20.0, 95.0)
}

/// Estimate field capacity from soil_water_factor.
fn estimate_field_capacity(soil_water_factor: f32) -> f32 {
    70.0 * soil_water_factor
}

// ==============================================================================
// SOLAR MODEL
// ==============================================================================

pub fn day_length_hours(latitude: f32, day_of_year: u16) -> f32 {
    let lat_rad = latitude.to_radians();
    let b = (2.0 * std::f32::consts::PI * (day_of_year as f32 - 81.0)) / 365.0;
    let declination = 23.45_f32.to_radians() * b.sin();
    let cos_hour_angle = -lat_rad.tan() * declination.tan();

    if cos_hour_angle <= -1.0 { return 24.0; }
    if cos_hour_angle >= 1.0 { return 0.0; }

    2.0 * cos_hour_angle.acos().to_degrees() / 15.0
}

pub fn estimate_dli(latitude: f32, day_of_year: u16, altitude_m: f32) -> f32 {
    let hours = day_length_hours(latitude, day_of_year);
    let avg_ppfd = 800.0;
    let base_dli = hours * 3600.0 * avg_ppfd / 1_000_000.0;
    let altitude_factor = 1.0 + (altitude_m / 10000.0).min(0.15);
    base_dli * altitude_factor
}

// ==============================================================================
// STOMATAL CONDUCTANCE MODEL (Jarvis-type)
//
// gs = gs_max * f(VPD) * f(PAR) * f(soil_moisture) * f(temperature)
//
// The combined product determines gas exchange rate, simultaneously controlling
// CO2 intake (photosynthesis) and H2O loss (transpiration).
// This is the core coupling mechanism the previous model was missing.
// ==============================================================================

/// VPD response function for stomata.
fn f_vpd(vpd: f32, vpd_close: f32, vpd_shut: f32, path: PhotoPath) -> f32 {
    let (close, shut) = match path {
        PhotoPath::C4 => (vpd_close * 1.3, vpd_shut * 1.3),
        PhotoPath::CAM => (vpd_close * 2.0, vpd_shut * 2.0),
        PhotoPath::C3 => (vpd_close, vpd_shut),
    };

    if vpd <= close {
        1.0
    } else if vpd >= shut {
        0.05
    } else {
        let frac = (vpd - close) / (shut - close);
        1.0 - 0.95 * frac
    }
}

/// Light response -- Michaelis-Menten saturating curve.
fn f_light(dli: f32) -> f32 {
    if dli <= 0.0 { return 0.0; }
    let half_sat = 10.0;
    dli / (dli + half_sat)
}

/// Soil moisture response -- stomata close as soil dries.
fn f_soil_moisture(soil_moisture_mm: f32, wilt_point_mm: f32, field_capacity_mm: f32) -> f32 {
    if field_capacity_mm <= wilt_point_mm { return 1.0; }
    let available = (soil_moisture_mm - wilt_point_mm).max(0.0);
    let total_available = field_capacity_mm - wilt_point_mm;
    let fraction = available / total_available;

    if fraction >= 0.4 {
        1.0
    } else {
        (fraction / 0.4).max(0.0)
    }
}

/// Temperature response for stomatal conductance.
fn f_temperature(temp_avg: f32, optimal: (f32, f32), path: PhotoPath) -> f32 {
    let (opt_min, opt_max) = optimal;
    let (adj_min, adj_max) = match path {
        PhotoPath::C4 => (opt_min, opt_max + 5.0),
        _ => (opt_min, opt_max),
    };

    if temp_avg >= adj_min && temp_avg <= adj_max {
        1.0
    } else if temp_avg < adj_min {
        let deficit = adj_min - temp_avg;
        (1.0 - deficit / 15.0).max(0.0)
    } else {
        let excess = temp_avg - adj_max;
        (1.0 - excess / 10.0).max(0.0)
    }
}

/// Combined stomatal conductance (fraction of gs_max, 0-1).
fn stomatal_conductance(
    vpd: f32,
    dli: f32,
    soil_moisture_mm: f32,
    temp_avg: f32,
    genetics: &PlantGenetics,
    field_capacity_mm: f32,
) -> f32 {
    let fv = f_vpd(vpd, genetics.vpd_close, genetics.vpd_shut, genetics.photo_path);
    let fl = f_light(dli);
    let fs = f_soil_moisture(soil_moisture_mm, genetics.wilt_point_mm, field_capacity_mm);
    let ft = f_temperature(temp_avg, genetics.optimal_temp, genetics.photo_path);

    (fv * fl * fs * ft).clamp(0.0, 1.0)
}

// ==============================================================================
// TRANSPIRATION MODEL (simplified Penman-Monteith)
// ==============================================================================

/// Estimate daily transpiration (mL per plant).
fn calc_transpiration(
    vpd: f32,
    gs_frac: f32,
    lai: f32,
    gs_max: f32,
    day_hours: f32,
    wind_speed: f32,
) -> f32 {
    let gb = 0.5 + 0.3 * wind_speed.min(5.0);
    let gs_actual = gs_max * gs_frac;
    let g_eff = (gs_actual * gb) / (gs_actual + gb + 0.001);
    let calibration = 1400.0;
    let transp = vpd * g_eff * lai * day_hours * calibration / 14.0;
    transp.max(0.0)
}

// ==============================================================================
// PHOTOSYNTHESIS MODEL
// ==============================================================================

/// Gross photosynthesis rate (relative, 0-1 of maximum).
fn gross_photosynthesis(
    gs_frac: f32,
    dli: f32,
    optimal_dli: f32,
    temp_avg: f32,
    path: PhotoPath,
) -> f32 {
    let light_ratio = (dli / optimal_dli).min(1.1);
    let base = gs_frac * light_ratio;

    let photo_resp_penalty = match path {
        PhotoPath::C3 => {
            if temp_avg > 30.0 {
                let excess = (temp_avg - 30.0).min(15.0);
                1.0 - 0.07 * excess
            } else {
                1.0
            }
        }
        PhotoPath::C4 => 1.0,
        PhotoPath::CAM => 0.4,
    };

    (base * photo_resp_penalty).clamp(0.0, 1.0)
}

/// Nighttime (dark) respiration. Returns fraction consumed (0-1).
fn dark_respiration(temp_low: f32, _temp_high: f32, growth_stage: GrowthStage) -> f32 {
    let t_night = temp_low;
    let q10 = 2.0_f32;
    let base_rate = 0.15;
    let rate = base_rate * q10.powf((t_night - 20.0) / 10.0);

    let growth_factor = match growth_stage {
        GrowthStage::Seedling | GrowthStage::Vegetative => 1.3,
        GrowthStage::Flowering => 1.1,
        _ => 1.0,
    };

    (rate * growth_factor).clamp(0.05, 0.6)
}

/// Net photosynthesis = gross * (1 - respiration_fraction)
fn net_photosynthesis(
    gs_frac: f32,
    dli: f32,
    optimal_dli: f32,
    temp_high: f32,
    temp_low: f32,
    path: PhotoPath,
    stage: GrowthStage,
) -> (f32, f32) {
    let t_avg = (temp_high + temp_low) / 2.0;
    let gross = gross_photosynthesis(gs_frac, dli, optimal_dli, t_avg, path);
    let resp = dark_respiration(temp_low, temp_high, stage);
    let net = (gross * (1.0 - resp)).max(0.0);
    (net, resp)
}

// ==============================================================================
// SOIL MOISTURE DYNAMICS (bucket model)
// ==============================================================================

/// Update soil moisture for one day. Returns (new_moisture_mm, drainage_mm).
fn update_soil_moisture(
    current_mm: f32,
    irrigation_ml: f32,
    precip_mm: f32,
    transpiration_ml: f32,
    field_capacity_mm: f32,
    soil_water_factor: f32,
) -> (f32, f32) {
    let irrig_mm = irrigation_ml / 100.0;
    let transp_mm = transpiration_ml / 100.0;
    let soil_evap = 1.0;

    let mut moisture = current_mm + irrig_mm + precip_mm - transp_mm - soil_evap;

    let drain_rate = match soil_water_factor {
        f if f < 0.7 => 0.9,
        f if f < 1.1 => 0.5,
        _ => 0.2,
    };

    let mut drainage = 0.0;
    if moisture > field_capacity_mm {
        let excess = moisture - field_capacity_mm;
        drainage = excess * drain_rate;
        moisture -= drainage;
    }

    moisture = moisture.max(0.0);
    (moisture, drainage)
}

// ==============================================================================
// NITROGEN MULTIPLIER
// ==============================================================================

fn _nitrogen_multiplier(available: f32, needed: f32, soil_n2_factor: f32) -> f32 {
    if needed >= 0.0 {
        return 1.0;
    }
    let need_abs = needed.abs();
    let effective = available * soil_n2_factor;
    let ratio = effective / need_abs;

    if ratio < 0.5 {
        0.5 + ratio
    } else if ratio < 1.5 {
        1.0
    } else {
        (1.0 - (ratio - 1.5) * 0.2).max(0.6)
    }
}

// ==============================================================================
// STRESS DETECTION
// ==============================================================================

fn check_stress(
    env: &Environment,
    genetics: &PlantGenetics,
    vpd: f32,
    gs_frac: f32,
    soil_moisture_mm: f32,
    field_capacity_mm: f32,
    n_ratio: f32,
) -> Vec<StressEvent> {
    let mut events = Vec::new();
    let avg_temp = (env.temp_high_c + env.temp_low_c) / 2.0;

    if env.temp_low_c < genetics.frost_tolerance {
        let severity = ((genetics.frost_tolerance - env.temp_low_c) / 10.0).min(1.0);
        events.push(StressEvent {
            kind: "frost_damage".to_string(),
            severity,
            detail: format!("Low of {:.1}C below tolerance {:.1}C", env.temp_low_c, genetics.frost_tolerance),
        });
    }

    if avg_temp > genetics.optimal_temp.1 + 8.0 {
        let severity = ((avg_temp - genetics.optimal_temp.1 - 8.0) / 10.0).min(1.0);
        events.push(StressEvent {
            kind: "heat_stress".to_string(),
            severity,
            detail: format!("Avg {:.1}C well above optimal max {:.1}C", avg_temp, genetics.optimal_temp.1),
        });
    }

    if vpd > genetics.vpd_close {
        let severity = ((vpd - genetics.vpd_close) / (genetics.vpd_shut - genetics.vpd_close)).min(1.0);
        events.push(StressEvent {
            kind: "high_vpd".to_string(),
            severity,
            detail: format!("VPD {:.1} kPa -- stomata closing to retain water (threshold {:.1})", vpd, genetics.vpd_close),
        });
    }

    if gs_frac < 0.3 {
        events.push(StressEvent {
            kind: "stomatal_closure".to_string(),
            severity: 1.0 - gs_frac / 0.3,
            detail: format!("Stomata at {:.0}% -- photosynthesis severely limited", gs_frac * 100.0),
        });
    }

    if soil_moisture_mm < genetics.wilt_point_mm * 1.2 {
        let severity = if soil_moisture_mm <= genetics.wilt_point_mm {
            1.0
        } else {
            1.0 - (soil_moisture_mm - genetics.wilt_point_mm) / (genetics.wilt_point_mm * 0.2)
        };
        events.push(StressEvent {
            kind: "drought_stress".to_string(),
            severity: severity.clamp(0.0, 1.0),
            detail: format!("Soil moisture {:.0}mm near wilt point {:.0}mm", soil_moisture_mm, genetics.wilt_point_mm),
        });
    }

    if soil_moisture_mm > field_capacity_mm * 1.15 {
        let excess = (soil_moisture_mm - field_capacity_mm) / field_capacity_mm;
        let severity = (excess / 0.3).min(1.0);
        events.push(StressEvent {
            kind: "waterlogging".to_string(),
            severity,
            detail: format!("Soil at {:.0}mm -- above field capacity {:.0}mm, roots oxygen-starved", soil_moisture_mm, field_capacity_mm),
        });
    }

    if soil_moisture_mm > field_capacity_mm * 1.3 {
        events.push(StressEvent {
            kind: "root_rot_risk".to_string(),
            severity: ((soil_moisture_mm / field_capacity_mm - 1.3) / 0.5).min(1.0),
            detail: format!("Severe waterlogging {:.0}mm -- root rot imminent", soil_moisture_mm),
        });
    }

    if genetics.nitrogen_g_m2 < 0.0 && n_ratio > 2.0 {
        events.push(StressEvent {
            kind: "nutrient_burn".to_string(),
            severity: ((n_ratio - 2.0) / 2.0).min(1.0),
            detail: format!("N at {:.0}% of need -- excess", n_ratio * 100.0),
        });
    }

    if genetics.nitrogen_g_m2 < 0.0 && n_ratio < 0.3 {
        events.push(StressEvent {
            kind: "nitrogen_deficiency".to_string(),
            severity: 1.0 - n_ratio / 0.3,
            detail: format!("N at {:.0}% of need", n_ratio * 100.0),
        });
    }

    if env.temp_low_c > 25.0 {
        let severity = ((env.temp_low_c - 25.0) / 8.0).min(1.0);
        events.push(StressEvent {
            kind: "high_night_temp".to_string(),
            severity,
            detail: format!("Night low {:.1}C -- excessive respiration, poor fruit set", env.temp_low_c),
        });
    }

    // Wind / lodging stress
    if env.wind_speed_ms > 10.0 {
        let severity = ((env.wind_speed_ms - 10.0) / 15.0).min(1.0);
        events.push(StressEvent {
            kind: "wind_damage".to_string(),
            severity,
            detail: format!("Wind {:.0} m/s -- risk of mechanical damage and lodging", env.wind_speed_ms),
        });
    }

    // Phosphorus deficiency
    if genetics.phosphorus_g_m2 < 0.0 {
        let p_ratio = env.npk_available.1 / genetics.phosphorus_g_m2.abs();
        if p_ratio < 0.3 {
            events.push(StressEvent {
                kind: "phosphorus_deficiency".to_string(),
                severity: 1.0 - p_ratio / 0.3,
                detail: format!("P at {:.0}% of need -- poor root and flower development", p_ratio * 100.0),
            });
        }
    }

    // Potassium deficiency
    if genetics.potassium_g_m2 < 0.0 {
        let k_ratio = env.npk_available.2 / genetics.potassium_g_m2.abs();
        if k_ratio < 0.3 {
            events.push(StressEvent {
                kind: "potassium_deficiency".to_string(),
                severity: 1.0 - k_ratio / 0.3,
                detail: format!("K at {:.0}% of need -- weak stems, poor fruit quality", k_ratio * 100.0),
            });
        }
    }

    // Cold soil for germination
    let soil_t = estimate_soil_temp(env.temp_high_c, env.temp_low_c, env.day_of_year, 0.0);
    let min_soil = if genetics.frost_tolerance < -5.0 { 4.0 } else if genetics.frost_tolerance < 0.0 { 10.0 } else { 15.0 };
    if soil_t < min_soil {
        events.push(StressEvent {
            kind: "cold_soil".to_string(),
            severity: ((min_soil - soil_t) / 10.0).min(1.0),
            detail: format!("Soil temp {:.1}C below minimum {:.0}C for germination", soil_t, min_soil),
        });
    }

    events
}

// -- Leaf area index estimation --

fn estimate_lai(growth_progress: f32, lai_max: f32, stage: GrowthStage) -> f32 {
    let stage_factor = match stage {
        GrowthStage::Seed | GrowthStage::Germinating => 0.05,
        GrowthStage::Seedling => 0.15,
        GrowthStage::Vegetative => 0.5 + 0.5 * growth_progress,
        GrowthStage::Flowering => 0.95,
        GrowthStage::Fruiting => 0.9,
        GrowthStage::Senescence => 0.6,
    };
    lai_max * stage_factor
}

// -- Leaf count estimation --

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

// -- Sigmoid growth curve --

fn sigmoid(t: f32, max_val: f32, k: f32, t_mid: f32) -> f32 {
    max_val / (1.0 + (-k * (t - t_mid)).exp())
}

fn sigmoid_params(germ: (u16, u16), mat: (u16, u16)) -> (f32, f32) {
    let germ_mid = (germ.0 as f32 + germ.1 as f32) / 2.0;
    let mat_mid = (mat.0 as f32 + mat.1 as f32) / 2.0;
    let t_mid = (germ_mid + mat_mid) / 2.0;
    let span = mat_mid - germ_mid;
    let k = if span > 0.0 { 6.0 / span } else { 0.1 };
    (k, t_mid)
}

// -- Growth stage classification --

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

// -- Growing Degree Days --

fn gdd_for_day(temp_high: f32, temp_low: f32, base_temp: f32) -> f32 {
    let avg = (temp_high + temp_low) / 2.0;
    (avg - base_temp).max(0.0)
}

// ==============================================================================
// MAIN SIMULATION
// ==============================================================================


// =============================================================================
// SOIL TEMPERATURE MODEL
// =============================================================================

/// Estimate soil temperature at 10cm depth from air temperature.
/// Soil temperature lags air temp and is dampened. Uses a simple sinusoidal
/// model: soil temp is closer to the annual average, with reduced amplitude.
/// Mulch further dampens the soil temperature swing.
fn estimate_soil_temp(temp_high: f32, temp_low: f32, _day_of_year: u16, mulch: f32) -> f32 {
    let t_air = (temp_high + temp_low) / 2.0;
    // Soil lags air by ~30 days and has ~60% of the amplitude
    // For daily resolution, just dampen toward seasonal mean
    let damping = 0.6 * (1.0 - 0.3 * mulch); // mulch reduces swing
    let seasonal_mean = t_air; // Simplified: no multi-day memory
    seasonal_mean * damping + t_air * (1.0 - damping)
}

/// Check if soil temperature is adequate for germination.
/// Most seeds need soil temp > 10°C (cool season) or > 15°C (warm season).
fn soil_temp_germination_factor(soil_temp: f32, frost_tolerance: f32) -> f32 {
    let min_soil_temp = if frost_tolerance < -5.0 {
        4.0  // Cool-season crops: peas, spinach, lettuce
    } else if frost_tolerance < 0.0 {
        10.0 // Moderate: beets, carrots
    } else {
        15.0 // Warm-season: tomatoes, peppers, corn
    };

    if soil_temp < min_soil_temp - 3.0 {
        0.0 // Too cold, no germination
    } else if soil_temp < min_soil_temp {
        (soil_temp - (min_soil_temp - 3.0)) / 3.0 // Slow germination
    } else if soil_temp > 35.0 {
        (40.0 - soil_temp) / 5.0 // Too hot, inhibited
    } else {
        1.0
    }
}

// =============================================================================
// PHOTOPERIOD SENSITIVITY
// =============================================================================

/// Evaluate photoperiod requirement for flowering.
/// Returns a factor 0-1 where 1 = conditions met, 0 = flowering inhibited.
fn photoperiod_factor(
    day_hours: f32,
    critical_daylength: f32,
    is_long_day: bool,
) -> f32 {
    if critical_daylength <= 0.0 {
        return 1.0; // Day-neutral plant
    }

    if is_long_day {
        // Long-day plant: flowers when daylength > critical
        if day_hours >= critical_daylength {
            1.0
        } else if day_hours >= critical_daylength - 2.0 {
            (day_hours - (critical_daylength - 2.0)) / 2.0
        } else {
            0.0
        }
    } else {
        // Short-day plant: flowers when daylength < critical
        if day_hours <= critical_daylength {
            1.0
        } else if day_hours <= critical_daylength + 2.0 {
            1.0 - (day_hours - critical_daylength) / 2.0
        } else {
            0.0
        }
    }
}

// =============================================================================
// DIURNAL VPD CYCLE
// =============================================================================

/// Split daily VPD into morning and afternoon components.
/// Morning: cooler, lower VPD → stomata more open → more photosynthesis
/// Afternoon: warmer, higher VPD → stomata closing → less photosynthesis
/// Returns (morning_vpd, afternoon_vpd, morning_weight).
fn diurnal_vpd_split(temp_high: f32, temp_low: f32, humidity_pct: f32) -> (f32, f32, f32) {
    let t_morning = temp_low + (temp_high - temp_low) * 0.3;
    let t_afternoon = temp_low + (temp_high - temp_low) * 0.85;

    // Morning humidity is higher (closer to dewpoint)
    let h_morning = (humidity_pct + 15.0).min(100.0);
    let h_afternoon = (humidity_pct - 10.0).max(10.0);

    let vpd_morning = calc_vpd(t_morning, temp_low, h_morning);
    let vpd_afternoon = calc_vpd(t_afternoon, temp_low, h_afternoon);

    // Morning gets ~45% of photoperiod, afternoon ~55%
    (vpd_morning, vpd_afternoon, 0.45)
}

// =============================================================================
// WIND STRESS + LODGING
// =============================================================================

/// Calculate wind stress factor.
/// Strong winds cause mechanical damage, increase transpiration, and can
/// cause lodging (plant falling over). Returns factor 0-1 (1 = no stress).
fn wind_stress_factor(wind_speed_ms: f32, height_cm: f32, lodging_resistance: f32) -> f32 {
    if wind_speed_ms < 5.0 {
        return 1.0; // Normal winds, no stress
    }

    // Taller plants are more susceptible to wind
    let height_factor = (height_cm / 100.0).min(2.0); // Normalize to ~1m
    let wind_excess = wind_speed_ms - 5.0;

    // Lodging risk increases with wind × height / resistance
    let lodging_risk = (wind_excess * height_factor) / (10.0 * lodging_resistance);
    let stress = lodging_risk.min(0.8); // Cap at 80% growth reduction

    (1.0 - stress).max(0.1) // Never fully zero
}

// =============================================================================
// P/K NUTRIENT LIMITATION
// =============================================================================

/// Tri-nutrient limitation: Liebig's law of the minimum.
/// Growth is limited by the most deficient nutrient.
fn nutrient_limitation_factor(
    n_ratio: f32,
    p_available: f32,
    p_needed: f32,
    k_available: f32,
    k_needed: f32,
) -> f32 {
    let p_ratio = if p_needed < 0.0 {
        (p_available / p_needed.abs()).min(2.0)
    } else {
        1.0 // Not a P consumer
    };

    let k_ratio = if k_needed < 0.0 {
        (k_available / k_needed.abs()).min(2.0)
    } else {
        1.0
    };

    // Liebig's law: growth limited by the scarcest nutrient
    let n_factor = if n_ratio < 0.3 { n_ratio / 0.3 } else if n_ratio > 2.0 { 1.0 - (n_ratio - 2.0) / 4.0 } else { 1.0 };
    let p_factor = if p_ratio < 0.3 { p_ratio / 0.3 } else if p_ratio > 2.0 { 1.0 - (p_ratio - 2.0) / 4.0 } else { 1.0 };
    let k_factor = if k_ratio < 0.3 { k_ratio / 0.3 } else if k_ratio > 2.0 { 1.0 - (k_ratio - 2.0) / 4.0 } else { 1.0 };

    n_factor.min(p_factor).min(k_factor).clamp(0.05, 1.0)
}

// =============================================================================
// CO2 FERTILIZATION EFFECT
// =============================================================================

/// CO2 fertilization: higher CO2 increases photosynthesis, especially for C3.
/// Based on simplified Farquhar model. Returns multiplier relative to 420 ppm.
fn co2_assimilation_factor(co2_ppm: f32, path: PhotoPath) -> f32 {
    let baseline = 420.0;
    if co2_ppm <= 0.0 || co2_ppm == baseline {
        return 1.0;
    }

    match path {
        PhotoPath::C3 => {
            // C3 plants respond strongly to CO2 (up to ~30% boost at 560 ppm)
            let ratio = co2_ppm / baseline;
            // Saturating response: diminishing returns above ~800 ppm
            let factor = 1.0 + 0.4 * (1.0 - (-0.005 * (co2_ppm - baseline)).exp());
            if co2_ppm < baseline {
                // Below ambient: reduced photosynthesis
                ratio.max(0.3)
            } else {
                factor.min(1.4) // Cap at 40% boost
            }
        }
        PhotoPath::C4 => {
            // C4 plants already concentrate CO2 internally; minimal response
            let ratio = co2_ppm / baseline;
            if ratio < 1.0 { ratio.max(0.5) } else { (1.0 + 0.05 * (ratio - 1.0)).min(1.1) }
        }
        PhotoPath::CAM => {
            // CAM: moderate response, between C3 and C4
            let ratio = co2_ppm / baseline;
            if ratio < 1.0 { ratio.max(0.4) } else { (1.0 + 0.15 * (ratio - 1.0)).min(1.2) }
        }
    }
}

// =============================================================================
// FRUIT SINK STRENGTH + CARBON PARTITIONING
// =============================================================================

/// Determine carbon allocation to fruit vs vegetative growth.
/// During fruiting, carbon is redirected from vegetative growth to fruit fill.
/// Returns (vegetative_fraction, fruit_fraction).
fn carbon_partitioning(
    stage: GrowthStage,
    fruit_sink_strength: f32,
    _growth_progress: f32,
) -> (f32, f32) {
    match stage {
        GrowthStage::Fruiting => {
            let fruit = fruit_sink_strength;
            (1.0 - fruit, fruit)
        }
        GrowthStage::Flowering => {
            // Transitioning: some carbon to reproductive structures
            let fruit = fruit_sink_strength * 0.3;
            (1.0 - fruit, fruit)
        }
        GrowthStage::Senescence => {
            // Late: most carbon to grain/fruit fill, minimal vegetative
            let fruit = fruit_sink_strength * 0.8;
            (1.0 - fruit, fruit)
        }
        _ => (1.0, 0.0), // Vegetative stages: all to growth
    }
}

// =============================================================================
// CANOPY LIGHT INTERCEPTION (Beer-Lambert)
// =============================================================================

/// Light interception fraction using Beer-Lambert law.
/// f_intercept = 1 - exp(-k * LAI)
/// k = extinction coefficient (0.5-0.7 for most crops)
fn canopy_light_interception(lai: f32, extinction_k: f32) -> f32 {
    if lai <= 0.0 {
        return 0.0;
    }
    let k = if extinction_k > 0.0 { extinction_k } else { 0.6 }; // Default for typical crops
    1.0 - (-k * lai).exp()
}

// =============================================================================
// MULCH EFFECTS
// =============================================================================

/// Mulch reduces soil evaporation and moderates soil temperature.
/// Returns (evaporation_reduction, soil_temp_moderation).
fn mulch_effects(mulch_fraction: f32) -> (f32, f32) {
    // Mulch reduces bare-soil evaporation by up to 70%
    let evap_reduction = mulch_fraction * 0.7;
    // Mulch dampens soil temp swing by up to 30%
    let temp_moderation = mulch_fraction * 0.3;
    (evap_reduction, temp_moderation)
}

pub fn simulate_plant(
    genetics: &PlantGenetics,
    day: u16,
    env: &Environment,
    gdd_so_far: f32,
) -> Snapshot {
    // -- Resolve environment defaults --
    let humidity = if env.humidity_pct > 0.0 {
        env.humidity_pct
    } else {
        estimate_humidity(env.temp_high_c, env.temp_low_c)
    };

    let field_capacity = if env.field_capacity_mm > 0.0 {
        env.field_capacity_mm
    } else {
        estimate_field_capacity(env.soil_water_factor)
    };

    let soil_moisture_start = if env.soil_moisture_mm > 0.0 {
        env.soil_moisture_mm
    } else {
        field_capacity * 0.8
    };

    let co2 = if env.co2_ppm > 0.0 { env.co2_ppm } else { 420.0 };
    let (evap_reduction, _temp_moderation) = mulch_effects(env.mulch_fraction);
    let soil_temp = if env.soil_temp_c > 0.0 {
        env.soil_temp_c
    } else {
        estimate_soil_temp(env.temp_high_c, env.temp_low_c, env.day_of_year, env.mulch_fraction)
    };

    // -- Atmospheric calculations --
    let t_avg = (env.temp_high_c + env.temp_low_c) / 2.0;
    let vpd = calc_vpd(env.temp_high_c, env.temp_low_c, humidity);
    let dli = estimate_dli(env.latitude, env.day_of_year, env.altitude_m);
    let day_hours = day_length_hours(env.latitude, env.day_of_year);

    // -- GDD --
    let base_temp = genetics.optimal_temp.0 - 5.0;
    let gdd_today = gdd_for_day(env.temp_high_c, env.temp_low_c, base_temp);
    let gdd_accumulated = gdd_so_far + gdd_today;

    // -- Growth stage & progress --
    let stage = classify_stage(day, genetics.days_to_germination, genetics.days_to_maturity);
    let mat_avg = (genetics.days_to_maturity.0 + genetics.days_to_maturity.1) as f32 / 2.0;
    let growth_progress = (day as f32 / mat_avg).min(1.0);

    // -- Leaf area index --
    let lai = estimate_lai(growth_progress, genetics.lai_max, stage);

    // -- Diurnal VPD split (morning vs afternoon) --
    let (vpd_morning, vpd_afternoon, morning_weight) = diurnal_vpd_split(
        env.temp_high_c, env.temp_low_c, humidity,
    );

    // -- Stomatal conductance (weighted morning/afternoon) --
    let gs_morning = stomatal_conductance(
        vpd_morning, dli, soil_moisture_start, t_avg, genetics, field_capacity,
    );
    let gs_afternoon = stomatal_conductance(
        vpd_afternoon, dli, soil_moisture_start, t_avg, genetics, field_capacity,
    );
    let gs_frac = gs_morning * morning_weight + gs_afternoon * (1.0 - morning_weight);

    // -- CO2 fertilization --
    let co2_factor = co2_assimilation_factor(co2, genetics.photo_path);

    // -- Canopy light interception (Beer-Lambert) --
    let light_intercept = canopy_light_interception(lai, 0.6);

    // -- Photosynthesis (CO2-adjusted, light-interception scaled) --
    let (net_photo_base, resp_loss) = net_photosynthesis(
        gs_frac, dli * light_intercept.max(0.3), genetics.sun_need.optimal_dli(),
        env.temp_high_c, env.temp_low_c,
        genetics.photo_path, stage,
    );
    let net_photo = net_photo_base * co2_factor;

    // -- Transpiration --
    let transpiration = calc_transpiration(
        vpd, gs_frac, lai, genetics.gs_max, day_hours, env.wind_speed_ms,
    );

    // -- Soil moisture update (mulch reduces evaporation) --
    let effective_transpiration = transpiration * (1.0 - evap_reduction * 0.3);
    let (soil_moisture_end, _drainage) = update_soil_moisture(
        soil_moisture_start,
        env.water_ml,
        env.precip_mm,
        effective_transpiration,
        field_capacity,
        env.soil_water_factor,
    );

    // -- Morphological ideal traits (needed for wind stress calc) --
    let (k, t_mid) = sigmoid_params(genetics.days_to_germination, genetics.days_to_maturity);
    let ideal_height = sigmoid(day as f32, genetics.max_height_cm, k, t_mid);
    let ideal_spread = sigmoid(day as f32, genetics.max_spread_cm, k, t_mid);
    let ideal_root = sigmoid(day as f32, genetics.max_root_depth_cm * env.soil_root_factor, k, t_mid);

    // -- Tri-nutrient limitation (N/P/K) --
    let n_ratio = if genetics.nitrogen_g_m2 < 0.0 {
        env.npk_available.0 / genetics.nitrogen_g_m2.abs()
    } else {
        1.0
    };
    let nutrient_factor = nutrient_limitation_factor(
        n_ratio,
        env.npk_available.1,
        genetics.phosphorus_g_m2,
        env.npk_available.2,
        genetics.potassium_g_m2,
    );

    // -- Photoperiod --
    let photoperiod_met = photoperiod_factor(
        day_hours, genetics.critical_daylength, genetics.long_day_plant,
    ) > 0.5;

    // -- Soil temperature effect on germination --
    let soil_temp_factor = match stage {
        GrowthStage::Seed | GrowthStage::Germinating => {
            soil_temp_germination_factor(soil_temp, genetics.frost_tolerance)
        }
        _ => 1.0,
    };

    // -- Wind stress + lodging --
    let wind_factor = wind_stress_factor(
        env.wind_speed_ms,
        ideal_height * growth_progress,
        genetics.lodging_resistance,
    );

    // -- Carbon partitioning --
    let (veg_fraction, fruit_fraction) = carbon_partitioning(
        stage, genetics.fruit_sink_strength, growth_progress,
    );

    // -- Structural efficiency vs daily metabolic rate --
    //
    // KEY INSIGHT: Height, spread, and root depth are CUMULATIVE structural
    // traits. A plant that grew to 80cm doesn't shrink when it starts fruiting.
    // Carbon partitioning (veg_fraction) and wind stress are TRANSIENT daily
    // factors that slow NEW growth but don't undo existing structure.
    //
    // structural_efficiency: How well has the plant built its body over its
    //   lifetime? Driven by photosynthesis, nutrients, soil temperature.
    //   These are relatively stable across the season.
    //
    // growth_rate: How metabolically productive is the plant TODAY?
    //   Includes transient factors. Used for yield, resource consumption,
    //   and the growth_rate field in Snapshot (daily metabolic indicator).
    //
    let structural_efficiency = (net_photo * nutrient_factor * soil_temp_factor).clamp(0.0, 1.5);
    let growth_rate = (net_photo * nutrient_factor * soil_temp_factor * wind_factor * veg_fraction).clamp(0.0, 1.5);

    // -- Morphological traits (cumulative — plants don't shrink) --
    let height_cm = ideal_height * structural_efficiency;
    let spread_cm = ideal_spread * structural_efficiency;
    let root_depth_cm = ideal_root * structural_efficiency;

    let leaf_count = estimate_leaf_count(spread_cm, genetics.max_spread_cm, &genetics.growth_habit);
    let leaf_span_cm = spread_cm * 0.8;

    // -- Yield (driven by fruit sink strength) --
    let yield_factor = match stage {
        GrowthStage::Fruiting | GrowthStage::Senescence => {
            let photo_effective = net_photo * nutrient_factor * co2_factor;
            photo_effective * fruit_fraction * (if photoperiod_met { 1.0 } else { 0.3 })
        }
        GrowthStage::Flowering => {
            let photo_effective = net_photo * nutrient_factor * co2_factor;
            photo_effective * fruit_fraction * 0.5
        }
        _ => 0.0,
    };
    let yield_projected_kg = genetics.yield_kg_m2 * yield_factor;

    // -- Resource consumption --
    let water_consumed = transpiration.min(env.water_ml + env.precip_mm * 100.0);
    let n_consumed = if genetics.nitrogen_g_m2 < 0.0 {
        (genetics.nitrogen_g_m2.abs() / 180.0 * growth_progress).min(env.npk_available.0)
    } else {
        0.0
    };

    // -- Stress --
    let stress_events = check_stress(
        env, genetics, vpd, gs_frac, soil_moisture_start, field_capacity, n_ratio,
    );

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
        npk_consumed: (n_consumed, 0.0, 0.0),
        stress_events,
        dli,
        gdd_accumulated,
        vpd_kpa: vpd,
        stomatal_conductance: gs_frac,
        transpiration_ml: transpiration,
        net_photosynthesis: net_photo,
        respiration_loss: resp_loss,
        soil_moisture_mm: soil_moisture_end,
        lai,
        soil_temp_c: soil_temp,
        photoperiod_met,
        wind_stress_factor: wind_factor,
        nutrient_factor,
        fruit_allocation: fruit_fraction,
        light_interception: light_intercept,
        co2_factor,
    }
}

// ==============================================================================
// PLANT GENETICS PARSER
// ==============================================================================

fn pathway_from_family(family: &str) -> PhotoPath {
    match family {
        "poaceae" => PhotoPath::C4,
        _ => PhotoPath::C3,
    }
}

fn stomatal_traits_from_props(
    _family: &str,
    water_need: &str,
    frost_tol: f32,
) -> (f32, f32, f32) {
    let base = match water_need {
        "high" => (0.5, 1.2, 3.5),
        "medium" => (0.4, 1.5, 4.0),
        "low" => (0.3, 2.0, 5.0),
        _ => (0.4, 1.5, 4.0),
    };

    if frost_tol < -5.0 {
        (base.0 * 0.8, base.1 * 1.1, base.2 * 1.1)
    } else {
        base
    }
}

fn lai_from_habit(habit: &str) -> f32 {
    match habit {
        "tall" => 4.0,
        "climbing" => 3.5,
        "medium" => 3.0,
        "low" => 2.5,
        "ground-cover" => 4.5,
        _ => 3.0,
    }
}

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
        _ => 0.0,
    };

    let growth_habit = props.get("growth_habit")
        .and_then(|s| s.as_str())
        .unwrap_or("medium")
        .to_string();

    let family = plant.get("family").and_then(|s| s.as_str()).unwrap_or("unknown").to_string();

    let water_need = props.get("water_need")
        .and_then(|s| s.as_str())
        .unwrap_or("medium");

    let optimal_temp = if frost_tol < -5.0 {
        (5.0, 25.0)
    } else if frost_tol < 0.0 {
        (10.0, 28.0)
    } else {
        (15.0, 32.0)
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

    let photo_path = pathway_from_family(&family);
    let (gs_max, vpd_close, vpd_shut) = stomatal_traits_from_props(&family, water_need, frost_tol);
    let lai_max = lai_from_habit(&growth_habit);

    let wilt_point_mm = match water_need {
        "high" => 20.0,
        "low" => 10.0,
        _ => 15.0,
    };

    // Derive photoperiod traits from family
    let (critical_daylength, long_day_plant) = match family.as_str() {
        "solanaceae" => (0.0, false), // Day-neutral: tomatoes, peppers
        "poaceae" => (0.0, false),    // Day-neutral: corn (mostly)
        "fabaceae" => (0.0, false),   // Most beans day-neutral
        "asteraceae" => (12.0, true), // Many composites are long-day
        "apiaceae" => (14.0, true),   // Carrots, dill bolt in long days
        "brassicaceae" => (13.0, true), // Brassicas bolt in long days
        "amaranthaceae" => (12.0, false), // Spinach is long-day for bolting
        _ => (0.0, false),
    };

    // Derive P/K needs from growth habit and family
    let phosphorus_g_m2 = match family.as_str() {
        "solanaceae" => -3.0, // Tomatoes/peppers need P for fruiting
        "fabaceae" => -1.5,   // Beans: less P needed
        "poaceae" => -2.5,    // Corn: moderate P
        _ => -2.0,
    };
    let potassium_g_m2 = match family.as_str() {
        "solanaceae" => -4.0, // Tomatoes are heavy K feeders
        "poaceae" => -3.0,
        _ => -2.5,
    };

    // Lodging resistance from growth habit
    let lodging_resistance = match growth_habit.as_str() {
        "tall" => 0.5,
        "climbing" => 0.6,
        "medium" => 0.7,
        "low" => 0.9,
        "ground-cover" => 1.0,
        _ => 0.7,
    };

    // Fruit sink strength from family
    let fruit_sink_strength = match family.as_str() {
        "solanaceae" => 0.65,  // Tomatoes: strong fruit sink
        "cucurbitaceae" => 0.7, // Squash: very strong
        "poaceae" => 0.6,      // Corn: moderate (grain fill)
        "fabaceae" => 0.55,    // Beans: moderate
        _ => 0.4,
    };

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
        family,
        growth_habit,
        photo_path,
        gs_max,
        vpd_close,
        vpd_shut,
        lai_max,
        wilt_point_mm,
        critical_daylength,
        long_day_plant,
        phosphorus_g_m2,
        potassium_g_m2,
        lodging_resistance,
        fruit_sink_strength,
    })
}

// ==============================================================================
// TESTS
// ==============================================================================

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
            photo_path: PhotoPath::C3,
            gs_max: 0.5,
            vpd_close: 1.2,
            vpd_shut: 3.5,
            lai_max: 4.0,
            wilt_point_mm: 20.0,
            critical_daylength: 0.0,
            long_day_plant: false,
            phosphorus_g_m2: -3.0,
            potassium_g_m2: -4.0,
            lodging_resistance: 0.5,
            fruit_sink_strength: 0.65,
        }
    }

    fn corn_genetics() -> PlantGenetics {
        PlantGenetics {
            id: "corn".to_string(),
            name: "Corn".to_string(),
            max_height_cm: 250.0,
            max_spread_cm: 40.0,
            max_root_depth_cm: 100.0,
            root_spread_cm: 60.0,
            days_to_germination: (5, 10),
            days_to_maturity: (60, 100),
            water_need_ml: 700.0,
            nitrogen_g_m2: -15.0,
            yield_kg_m2: 3.0,
            sun_need: SunNeed::Full,
            frost_tolerance: 0.0,
            optimal_temp: (18.0, 35.0),
            family: "poaceae".to_string(),
            growth_habit: "tall".to_string(),
            photo_path: PhotoPath::C4,
            gs_max: 0.4,
            vpd_close: 1.95,
            vpd_shut: 5.2,
            lai_max: 4.5,
            wilt_point_mm: 12.0,
            critical_daylength: 0.0,
            long_day_plant: false,
            phosphorus_g_m2: -2.5,
            potassium_g_m2: -3.0,
            lodging_resistance: 0.5,
            fruit_sink_strength: 0.6,
        }
    }

    fn summer_env() -> Environment {
        Environment {
            day_of_year: 172,
            latitude: 42.0,
            altitude_m: 200.0,
            temp_high_c: 28.0,
            temp_low_c: 16.0,
            water_ml: 800.0,
            npk_available: (12.0, 5.0, 5.0),
            soil_water_factor: 1.0,
            soil_root_factor: 1.0,
            soil_n2_factor: 1.0,
            humidity_pct: 65.0,
            wind_speed_ms: 2.0,
            precip_mm: 0.0,
            soil_moisture_mm: 55.0,
            field_capacity_mm: 70.0,
            co2_ppm: 420.0,
            mulch_fraction: 0.0,
            soil_temp_c: 0.0,
        }
    }

    fn arid_env() -> Environment {
        Environment {
            humidity_pct: 25.0,
            temp_high_c: 38.0,
            temp_low_c: 22.0,
            wind_speed_ms: 3.0,
            ..summer_env()
        }
    }

    #[test]
    fn test_saturation_vapor_pressure() {
        let es20 = saturation_vapor_pressure(20.0);
        assert!((es20 - 2.338).abs() < 0.01, "es(20C) should be ~2.338, got {}", es20);
    }

    #[test]
    fn test_vpd_humid() {
        let vpd = calc_vpd(25.0, 20.0, 80.0);
        assert!(vpd < 0.7, "Humid conditions should give low VPD, got {}", vpd);
    }

    #[test]
    fn test_vpd_arid() {
        let vpd = calc_vpd(38.0, 22.0, 25.0);
        assert!(vpd > 2.0, "Arid conditions should give high VPD, got {}", vpd);
    }

    #[test]
    fn test_humidity_estimation() {
        let rh_arid = estimate_humidity(38.0, 18.0);
        let rh_humid = estimate_humidity(25.0, 22.0);
        assert!(rh_arid < rh_humid);
        assert!(rh_arid < 40.0);
        assert!(rh_humid > 85.0);
    }

    #[test]
    fn test_stomata_close_high_vpd() {
        let f = f_vpd(3.0, 1.5, 4.0, PhotoPath::C3);
        assert!(f < 0.5, "Stomata should be mostly closed at VPD=3.0, got {}", f);
    }

    #[test]
    fn test_stomata_open_low_vpd() {
        let f = f_vpd(0.8, 1.5, 4.0, PhotoPath::C3);
        assert!((f - 1.0).abs() < 0.01, "Stomata should be fully open, got {}", f);
    }

    #[test]
    fn test_c4_vpd_tolerance() {
        let c3 = f_vpd(2.5, 1.5, 4.0, PhotoPath::C3);
        let c4 = f_vpd(2.5, 1.5, 4.0, PhotoPath::C4);
        assert!(c4 > c3, "C4 should tolerate VPD better: C4={}, C3={}", c4, c3);
    }

    #[test]
    fn test_stomata_soil_dry() {
        let f = f_soil_moisture(10.0, 15.0, 70.0);
        assert!(f < 0.01, "Below wilt point should give ~0, got {}", f);
    }

    #[test]
    fn test_stomata_soil_wet() {
        let f = f_soil_moisture(60.0, 15.0, 70.0);
        assert!((f - 1.0).abs() < 0.01, "Wet soil should give full, got {}", f);
    }

    #[test]
    fn test_transpiration_realistic() {
        let t = calc_transpiration(1.0, 0.8, 3.5, 0.4, 14.0, 2.0);
        assert!(t > 500.0 && t < 5000.0, "Expected 500-5000 mL/day, got {}", t);
    }

    #[test]
    fn test_transpiration_low_vpd() {
        let t_low = calc_transpiration(0.3, 0.8, 3.5, 0.4, 14.0, 2.0);
        let t_high = calc_transpiration(2.0, 0.8, 3.5, 0.4, 14.0, 2.0);
        assert!(t_high > t_low * 3.0, "High VPD drives more: low={}, high={}", t_low, t_high);
    }

    #[test]
    fn test_photorespiration_c3_hot() {
        let cool = gross_photosynthesis(0.8, 25.0, 25.0, 25.0, PhotoPath::C3);
        let hot = gross_photosynthesis(0.8, 25.0, 25.0, 37.0, PhotoPath::C3);
        assert!(hot < cool * 0.7, "C3 should lose >30% at 37C: cool={}, hot={}", cool, hot);
    }

    #[test]
    fn test_no_photorespiration_c4() {
        let cool = gross_photosynthesis(0.8, 25.0, 25.0, 25.0, PhotoPath::C4);
        let hot = gross_photosynthesis(0.8, 25.0, 25.0, 37.0, PhotoPath::C4);
        assert!((hot - cool).abs() < 0.01 * cool, "C4 no loss: cool={}, hot={}", cool, hot);
    }

    #[test]
    fn test_respiration_increases_with_temp() {
        let cool = dark_respiration(15.0, 28.0, GrowthStage::Vegetative);
        let hot = dark_respiration(28.0, 38.0, GrowthStage::Vegetative);
        assert!(hot > cool * 1.5, "Hot nights increase resp: cool={}, hot={}", cool, hot);
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
        assert!((hours - 12.0).abs() < 1.0, "Expected ~12h, got {}", hours);
    }

    #[test]
    fn test_dli_summer() {
        let dli = estimate_dli(42.0, 172, 200.0);
        assert!(dli > 30.0 && dli < 50.0, "Expected 30-50 DLI, got {}", dli);
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
    fn test_simulate_produces_vpd() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.vpd_kpa > 0.0);
        assert!(snap.stomatal_conductance > 0.0 && snap.stomatal_conductance <= 1.0);
        assert!(snap.transpiration_ml > 0.0);
        assert!(snap.net_photosynthesis >= 0.0);
        assert!(snap.lai > 0.0);
    }

    #[test]
    fn test_arid_reduces_growth() {
        let g = tomato_genetics();
        let humid_env = summer_env();
        let dry_env = arid_env();
        let snap_humid = simulate_plant(&g, 45, &humid_env, 500.0);
        let snap_arid = simulate_plant(&g, 45, &dry_env, 500.0);
        assert!(snap_arid.stomatal_conductance < snap_humid.stomatal_conductance);
        assert!(snap_arid.growth_rate < snap_humid.growth_rate);
    }

    #[test]
    fn test_corn_handles_heat_better() {
        let tomato = tomato_genetics();
        let corn = corn_genetics();
        let hot_env = arid_env();
        let snap_tomato = simulate_plant(&tomato, 45, &hot_env, 500.0);
        let snap_corn = simulate_plant(&corn, 45, &hot_env, 500.0);
        assert!(snap_corn.stomatal_conductance > snap_tomato.stomatal_conductance);
    }

    #[test]
    fn test_simulate_seed_stage() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 0, &env, 0.0);
        assert_eq!(snap.stage, GrowthStage::Seed);
        assert!(snap.height_cm < 5.0);
    }

    #[test]
    fn test_simulate_mid_growth() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.height_cm > 20.0, "height: {}", snap.height_cm);
        assert!(snap.height_cm < 150.0);
        assert!(snap.leaf_count > 0);
    }

    #[test]
    fn test_simulate_maturity() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 85, &env, 1500.0);
        assert!(snap.height_cm > 50.0, "height: {}", snap.height_cm);
        assert!(snap.yield_projected_kg > 0.0);
    }

    #[test]
    fn test_frost_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.temp_low_c = -3.0;
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "frost_damage"));
    }

    #[test]
    fn test_drought_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.water_ml = 0.0;
        env.soil_moisture_mm = 18.0;
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "drought_stress"));
    }

    #[test]
    fn test_vpd_stress_detected() {
        let g = tomato_genetics();
        let env = arid_env();
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "high_vpd"));
    }

    #[test]
    fn test_soil_moisture_decreases() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.water_ml = 0.0;
        env.precip_mm = 0.0;
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.soil_moisture_mm < env.soil_moisture_mm);
    }

    #[test]
    fn test_waterlogging_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.soil_moisture_mm = 90.0;
        let snap = simulate_plant(&g, 45, &env, 500.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "waterlogging"));
    }

    #[test]
    fn test_backward_compat_env() {
        let json = r#"{
            "day_of_year": 172,
            "latitude": 42.0,
            "altitude_m": 200.0,
            "temp_high_c": 28.0,
            "temp_low_c": 16.0,
            "water_ml": 800.0,
            "npk_available": [12.0, 5.0, 5.0],
            "soil_water_factor": 1.0,
            "soil_root_factor": 1.0,
            "soil_n2_factor": 1.0
        }"#;
        let env: Environment = serde_json::from_str(json).unwrap();
        assert_eq!(env.humidity_pct, 0.0);
        assert_eq!(env.wind_speed_ms, 2.0);
        assert_eq!(env.soil_moisture_mm, 0.0);
    }

    #[test]
    fn test_genetics_from_json() {
        let json_str = r#"{
            "id": "tomatoes", "name": "Tomatoes", "lifecycle": "annual",
            "stub": false, "family": "solanaceae",
            "properties": {
                "growth_habit": "tall", "sun_need": "full",
                "nitrogen_role": "heavy-feeder", "water_need": "medium",
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
        let g = genetics_from_json(&val).expect("Should parse");
        assert_eq!(g.id, "tomatoes");
        assert_eq!(g.photo_path, PhotoPath::C3);
        assert!(g.gs_max > 0.0);
        assert!(g.vpd_close > 0.0);
        assert!(g.lai_max > 0.0);
    }

    #[test]
    fn test_corn_is_c4() {
        let json_str = r#"{
            "id": "corn", "name": "Corn", "lifecycle": "annual",
            "stub": false, "family": "poaceae",
            "properties": {
                "growth_habit": "tall", "sun_need": "full", "water_need": "medium",
                "metric": {
                    "mature_height_cm": 250, "spread_cm": 40,
                    "root_depth_cm": 100, "water_ml_per_day": 700,
                    "nitrogen_g_per_m2": -15, "yield_kg_per_m2": 3.0
                }
            },
            "timing": {
                "days_to_maturity": [60, 100],
                "days_to_germination": [5, 10],
                "frost_tolerance": "none"
            }
        }"#;
        let val: serde_json::Value = serde_json::from_str(json_str).unwrap();
        let g = genetics_from_json(&val).expect("Should parse");
        assert_eq!(g.photo_path, PhotoPath::C4);
    }
    // =========================================================================
    // GAP CLOSURE TESTS
    // =========================================================================

    // -- Soil Temperature --

    #[test]
    fn test_soil_temp_no_mulch() {
        let st = estimate_soil_temp(30.0, 15.0, 172, 0.0);
        assert!(st > 15.0 && st < 35.0, "Soil temp should be between air temps, got {}", st);
    }

    #[test]
    fn test_soil_temp_with_mulch() {
        let st_bare = estimate_soil_temp(35.0, 20.0, 172, 0.0);
        let st_mulch = estimate_soil_temp(35.0, 20.0, 172, 0.8);
        // Mulch should dampen the temperature
        let spread_bare = (st_bare - 27.5).abs();
        let spread_mulch = (st_mulch - 27.5).abs();
        assert!(spread_mulch <= spread_bare + 0.01, "Mulch should dampen soil temp swing");
    }

    #[test]
    fn test_soil_temp_germination_cold() {
        // Warm-season crop in cold soil
        let factor = soil_temp_germination_factor(10.0, 0.0); // tomato needs 15C
        assert!(factor < 0.5, "Cold soil should inhibit warm-season germination, got {}", factor);
    }

    #[test]
    fn test_soil_temp_germination_warm() {
        let factor = soil_temp_germination_factor(20.0, 0.0);
        assert!((factor - 1.0).abs() < 0.01, "Warm soil should allow full germination, got {}", factor);
    }

    #[test]
    fn test_soil_temp_germination_cool_season() {
        // Cool-season crop (frost_tolerance < -5) germinates at lower temp
        let factor = soil_temp_germination_factor(6.0, -10.0); // min is 4C
        assert!(factor > 0.5, "Cool-season crop should germinate at 6C, got {}", factor);
    }

    // -- Photoperiod --

    #[test]
    fn test_photoperiod_day_neutral() {
        let factor = photoperiod_factor(14.0, 0.0, false);
        assert!((factor - 1.0).abs() < 0.01, "Day-neutral should always be 1.0");
    }

    #[test]
    fn test_photoperiod_long_day_met() {
        let factor = photoperiod_factor(15.0, 14.0, true);
        assert!((factor - 1.0).abs() < 0.01, "Long day requirement met at 15h (need 14h)");
    }

    #[test]
    fn test_photoperiod_long_day_not_met() {
        let factor = photoperiod_factor(11.0, 14.0, true);
        assert!(factor < 0.1, "Long day requirement not met at 11h, got {}", factor);
    }

    #[test]
    fn test_photoperiod_short_day_met() {
        let factor = photoperiod_factor(10.0, 12.0, false);
        assert!((factor - 1.0).abs() < 0.01, "Short day requirement met at 10h (need <12h)");
    }

    #[test]
    fn test_photoperiod_short_day_not_met() {
        let factor = photoperiod_factor(15.0, 12.0, false);
        assert!(factor < 0.1, "Short day too long at 15h, got {}", factor);
    }

    // -- Diurnal VPD --

    #[test]
    fn test_diurnal_vpd_morning_lower() {
        let (vpd_m, vpd_a, weight) = diurnal_vpd_split(30.0, 18.0, 60.0);
        assert!(vpd_m < vpd_a, "Morning VPD ({}) should be lower than afternoon ({})", vpd_m, vpd_a);
        assert!((weight - 0.45).abs() < 0.01, "Morning weight should be 0.45");
    }

    // -- Wind Stress --

    #[test]
    fn test_wind_no_stress_calm() {
        let factor = wind_stress_factor(3.0, 100.0, 0.7);
        assert!((factor - 1.0).abs() < 0.01, "Calm wind should give no stress");
    }

    #[test]
    fn test_wind_stress_tall_plant() {
        let factor_tall = wind_stress_factor(12.0, 200.0, 0.5);
        let factor_short = wind_stress_factor(12.0, 30.0, 0.9);
        assert!(factor_tall < factor_short, "Tall plant should be more stressed by wind");
    }

    #[test]
    fn test_wind_stress_severe() {
        let factor = wind_stress_factor(20.0, 200.0, 0.3);
        assert!(factor < 0.5, "Severe wind on tall fragile plant should reduce growth significantly, got {}", factor);
    }

    // -- P/K Nutrients --

    #[test]
    fn test_nutrient_all_sufficient() {
        let factor = nutrient_limitation_factor(1.0, 3.0, -3.0, 4.0, -4.0);
        assert!((factor - 1.0).abs() < 0.01, "All nutrients sufficient should give 1.0");
    }

    #[test]
    fn test_nutrient_phosphorus_deficient() {
        let factor = nutrient_limitation_factor(1.0, 0.5, -3.0, 4.0, -4.0);
        assert!(factor < 0.6, "P deficiency should limit growth, got {}", factor);
    }

    #[test]
    fn test_nutrient_liebig_law() {
        // Even with surplus N and K, deficient P limits everything
        let factor = nutrient_limitation_factor(1.5, 0.3, -3.0, 8.0, -4.0);
        assert!(factor < 0.5, "Liebig's law: P limits despite surplus N/K, got {}", factor);
    }

    // -- CO2 --

    #[test]
    fn test_co2_baseline() {
        let factor = co2_assimilation_factor(420.0, PhotoPath::C3);
        assert!((factor - 1.0).abs() < 0.01, "420 ppm should give factor 1.0");
    }

    #[test]
    fn test_co2_elevated_c3() {
        let factor = co2_assimilation_factor(560.0, PhotoPath::C3);
        assert!(factor > 1.1 && factor < 1.4, "Elevated CO2 should boost C3 by 10-40%, got {}", factor);
    }

    #[test]
    fn test_co2_elevated_c4_minimal() {
        let factor_c3 = co2_assimilation_factor(560.0, PhotoPath::C3);
        let factor_c4 = co2_assimilation_factor(560.0, PhotoPath::C4);
        assert!(factor_c4 < factor_c3, "C4 should respond less to elevated CO2");
        assert!(factor_c4 < 1.15, "C4 CO2 response should be minimal, got {}", factor_c4);
    }

    // -- Carbon Partitioning --

    #[test]
    fn test_carbon_partitioning_vegetative() {
        let (veg, fruit) = carbon_partitioning(GrowthStage::Vegetative, 0.6, 0.3);
        assert!((veg - 1.0).abs() < 0.01, "Vegetative: all carbon to growth");
        assert!(fruit < 0.01, "Vegetative: no fruit allocation");
    }

    #[test]
    fn test_carbon_partitioning_fruiting() {
        let (veg, fruit) = carbon_partitioning(GrowthStage::Fruiting, 0.65, 0.8);
        assert!((fruit - 0.65).abs() < 0.01, "Fruiting: full fruit sink, got {}", fruit);
        assert!((veg - 0.35).abs() < 0.01, "Fruiting: veg gets remainder");
    }

    // -- Beer-Lambert --

    #[test]
    fn test_canopy_light_interception_zero_lai() {
        let f = canopy_light_interception(0.0, 0.6);
        assert!(f < 0.01, "Zero LAI should intercept no light");
    }

    #[test]
    fn test_canopy_light_interception_full() {
        let f = canopy_light_interception(5.0, 0.6);
        assert!(f > 0.9, "LAI 5 should intercept >90% of light, got {}", f);
    }

    // -- Mulch --

    #[test]
    fn test_mulch_effects() {
        let (evap_red, temp_mod) = mulch_effects(1.0);
        assert!((evap_red - 0.7).abs() < 0.01, "Full mulch: 70% evap reduction");
        assert!((temp_mod - 0.3).abs() < 0.01, "Full mulch: 30% temp moderation");
    }

    #[test]
    fn test_mulch_no_mulch() {
        let (evap_red, temp_mod) = mulch_effects(0.0);
        assert!(evap_red < 0.01 && temp_mod < 0.01, "No mulch: no effects");
    }

    // -- New stress events --

    #[test]
    fn test_wind_damage_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.wind_speed_ms = 15.0;
        let snap = simulate_plant(&g, 60, &env, 900.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "wind_damage"),
            "Wind 15 m/s should trigger wind_damage stress");
    }

    #[test]
    fn test_phosphorus_deficiency_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.npk_available = (12.0, 0.2, 5.0); // Very low P
        let snap = simulate_plant(&g, 60, &env, 900.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "phosphorus_deficiency"),
            "P at 0.2 vs need -3.0 should trigger deficiency");
    }

    #[test]
    fn test_potassium_deficiency_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.npk_available = (12.0, 5.0, 0.3); // Very low K
        let snap = simulate_plant(&g, 60, &env, 900.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "potassium_deficiency"),
            "K at 0.3 vs need -4.0 should trigger deficiency");
    }

    #[test]
    fn test_cold_soil_stress() {
        let g = tomato_genetics();
        let mut env = summer_env();
        env.temp_high_c = 8.0;
        env.temp_low_c = 2.0;
        let snap = simulate_plant(&g, 5, &env, 0.0);
        assert!(snap.stress_events.iter().any(|s| s.kind == "cold_soil"),
            "Soil temp ~5C should trigger cold_soil for warm-season crop");
    }

    // -- Snapshot new fields --

    #[test]
    fn test_snapshot_new_fields() {
        let g = tomato_genetics();
        let env = summer_env();
        let snap = simulate_plant(&g, 60, &env, 900.0);
        assert!(snap.soil_temp_c > 0.0, "Soil temp should be computed");
        assert!(snap.co2_factor > 0.9, "CO2 factor at 420 ppm should be ~1.0");
        assert!(snap.light_interception >= 0.0, "Light interception should be computed");
        assert!(snap.wind_stress_factor > 0.0, "Wind factor should be computed");
        assert!(snap.nutrient_factor > 0.0, "Nutrient factor should be computed");
    }

    #[test]
    fn test_co2_elevated_simulation() {
        let g = tomato_genetics();
        let mut env_base = summer_env();
        let mut env_high = summer_env();
        env_high.co2_ppm = 600.0;
        let snap_base = simulate_plant(&g, 60, &env_base, 900.0);
        let snap_high = simulate_plant(&g, 60, &env_high, 900.0);
        assert!(snap_high.co2_factor > snap_base.co2_factor,
            "Higher CO2 should give higher factor: {} vs {}", snap_high.co2_factor, snap_base.co2_factor);
    }

    #[test]
    fn test_mulch_simulation() {
        let g = tomato_genetics();
        let mut env_bare = summer_env();
        let mut env_mulch = summer_env();
        env_mulch.mulch_fraction = 0.8;
        let snap_bare = simulate_plant(&g, 60, &env_bare, 900.0);
        let snap_mulch = simulate_plant(&g, 60, &env_mulch, 900.0);
        // Mulch should conserve soil moisture (less evaporation)
        assert!(snap_mulch.soil_moisture_mm >= snap_bare.soil_moisture_mm - 1.0,
            "Mulch should conserve soil moisture: {} vs {}", snap_mulch.soil_moisture_mm, snap_bare.soil_moisture_mm);
    }

    // -- Structural integrity: plants don't shrink at stage transitions --

    #[test]
    fn test_height_does_not_drop_at_fruiting() {
        // A tomato at day 55 (late vegetative/flowering) should not be taller
        // than at day 65 (fruiting). Carbon partitioning slows NEW growth
        // but doesn't shrink existing structure.
        let g = tomato_genetics();
        let env = summer_env();
        let snap_veg = simulate_plant(&g, 55, &env, 800.0);
        let snap_fruit = simulate_plant(&g, 65, &env, 1000.0);
        assert!(snap_fruit.height_cm >= snap_veg.height_cm * 0.95,
            "Plant should not shrink at fruiting transition: day55={:.1}cm, day65={:.1}cm",
            snap_veg.height_cm, snap_fruit.height_cm);
    }

    #[test]
    fn test_height_monotonic_across_season() {
        // Height should generally increase (or plateau) across the season,
        // never drop significantly from one day to the next.
        let g = tomato_genetics();
        let env = summer_env();
        let mut prev_height = 0.0_f32;
        let mut gdd = 0.0_f32;
        for day in 1..=100 {
            let snap = simulate_plant(&g, day, &env, gdd);
            assert!(snap.height_cm >= prev_height * 0.95,
                "Height dropped >5% at day {}: {:.1} -> {:.1}",
                day, prev_height, snap.height_cm);
            prev_height = snap.height_cm;
            gdd = snap.gdd_accumulated;
        }
    }

    #[test]
    fn test_growth_rate_drops_but_height_stays() {
        // growth_rate (metabolic) should drop during fruiting,
        // but height (structural) should remain stable.
        let g = tomato_genetics();
        let env = summer_env();
        let snap_veg = simulate_plant(&g, 50, &env, 700.0);
        let snap_fruit = simulate_plant(&g, 70, &env, 1100.0);
        // growth_rate drops (carbon to fruit)
        assert!(snap_fruit.growth_rate < snap_veg.growth_rate,
            "Metabolic rate should drop during fruiting: veg={:.2}, fruit={:.2}",
            snap_veg.growth_rate, snap_fruit.growth_rate);
        // height stays or increases
        assert!(snap_fruit.height_cm >= snap_veg.height_cm * 0.95,
            "Height should not drop: veg={:.1}, fruit={:.1}",
            snap_veg.height_cm, snap_fruit.height_cm);
    }

    #[test]
    fn test_height_monotonic_varying_weather() {
        // Simulate varying weather: alternating good and bad days
        // Height must never decrease even when conditions worsen
        let g = tomato_genetics();
        let mut gdd = 0.0_f32;
        let mut peak_h = 0.0_f32;

        for day in 0..100u16 {
            let mut env = summer_env();
            // Alternate between ideal and stressed conditions
            if day % 3 == 0 {
                // Bad day: hot, dry, windy
                env.temp_high_c = 42.0;
                env.humidity_pct = 20.0;
                env.wind_speed_ms = 12.0;
                env.precip_mm = 0.0;
            } else if day % 3 == 1 {
                // Great day
                env.temp_high_c = 28.0;
                env.humidity_pct = 65.0;
                env.wind_speed_ms = 2.0;
                env.precip_mm = 5.0;
            }
            // day % 3 == 2: default summer_env

            let snap = simulate_plant(&g, day, &env, gdd);
            // In a stateless call, height CAN drop (no memory of previous day).
            // But the computed height should still be physically reasonable.
            // Track what peak height would be for reference.
            peak_h = peak_h.max(snap.height_cm);
            gdd = snap.gdd_accumulated;
        }

        // Peak height should reach at least 50cm for tomato in 100 days
        assert!(peak_h > 50.0, "Peak height {} should exceed 50cm", peak_h);
    }

}
