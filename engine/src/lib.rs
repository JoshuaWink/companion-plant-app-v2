//! Companion Garden Engine
//!
//! Graph queries (companions, antagonists, conflicts, succession)
//! + plant lifecycle simulation (growth curves, environment response, stress)

mod graph;
pub mod growth;
mod model;
mod timeline;

pub use graph::CompanionGraph;
pub use growth::{Environment, PlantGenetics, Snapshot, simulate_plant, genetics_from_json, PhotoPath, PlantingPlan, Planting, SeedTreatment, ManagementMode, apply_treatments};
pub use model::{ConfidenceTier, Edge, Plant, RelationType, TemporalDep};
pub use timeline::{compute_window, PlantTiming, PlantingWindow};

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// WASM-exported wrapper around CompanionGraph.
#[wasm_bindgen]
pub struct Garden {
    inner: CompanionGraph,
}

#[wasm_bindgen]
impl Garden {
    /// Load a garden graph from plants.json and relationships.json content.
    #[wasm_bindgen(constructor)]
    pub fn new(plants_json: &str, relationships_json: &str) -> Result<Garden, JsError> {
        let plants: Vec<Plant> =
            serde_json::from_str(plants_json).map_err(|e| JsError::new(&e.to_string()))?;
        let edges: Vec<Edge> =
            serde_json::from_str(relationships_json).map_err(|e| JsError::new(&e.to_string()))?;

        let inner = CompanionGraph::from_data(plants, edges);
        Ok(Garden { inner })
    }

    /// Get all companions for a plant (returns JSON array of plant IDs).
    pub fn companions(&self, plant_id: &str) -> String {
        let result = self.inner.companions(plant_id);
        serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get all antagonists for a plant (returns JSON array of plant IDs).
    pub fn antagonists(&self, plant_id: &str) -> String {
        let result = self.inner.antagonists(plant_id);
        serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
    }

    /// Given a set of plant IDs (JSON array), return conflicts (JSON array of conflict objects).
    pub fn conflicts(&self, plant_ids_json: &str) -> String {
        let plant_ids: Vec<String> =
            serde_json::from_str(plant_ids_json).unwrap_or_default();
        let result = self.inner.conflicts(&plant_ids);
        serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
    }

    /// Given a set of plant IDs (JSON array), return temporal succession dependencies.
    pub fn temporal_deps(&self, plant_ids_json: &str) -> String {
        let plant_ids: Vec<String> =
            serde_json::from_str(plant_ids_json).unwrap_or_default();
        let result = self.inner.temporal_deps(&plant_ids);
        serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get the full relationship detail between two plants (JSON object or null).
    pub fn relationship(&self, source: &str, target: &str) -> String {
        match self.inner.relationship(source, target) {
            Some(edge) => serde_json::to_string(&edge).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        }
    }

    /// Get all plant IDs in the graph.
    pub fn plant_ids(&self) -> String {
        let ids = self.inner.plant_ids();
        serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get plant count.
    pub fn plant_count(&self) -> usize {
        self.inner.plant_count()
    }

    /// Get edge count.
    pub fn edge_count(&self) -> usize {
        self.inner.edge_count()
    }

    /// Given a JSON map of {plant_id: PlantTiming} and last_frost_doy,
    /// return a JSON array of PlantingWindow objects.
    pub fn planting_windows(&self, timing_json: &str, last_frost_doy: u16) -> String {
        use std::collections::HashMap;
        let timing_map: HashMap<String, PlantTiming> =
            serde_json::from_str(timing_json).unwrap_or_default();
        let windows: Vec<PlantingWindow> = timing_map
            .iter()
            .map(|(id, t)| compute_window(id, t, last_frost_doy))
            .collect();
        serde_json::to_string(&windows).unwrap_or_else(|_| "[]".to_string())
    }
}

// ── Growth Simulation WASM API ──

/// Simulate a single plant for one day.
/// `plant_json` — a single plant object from plants.json
/// `day` — days since planting
/// `env_json` — Environment object as JSON
/// `gdd_so_far` — accumulated GDD from previous days
/// Returns Snapshot as JSON.
#[wasm_bindgen]
pub fn simulate_growth(plant_json: &str, day: u16, env_json: &str, gdd_so_far: f32) -> Result<String, JsError> {
    let plant_val: serde_json::Value =
        serde_json::from_str(plant_json).map_err(|e| JsError::new(&e.to_string()))?;
    let genetics = growth::genetics_from_json(&plant_val)
        .ok_or_else(|| JsError::new("Could not parse plant genetics — missing required fields"))?;
    let env: growth::Environment =
        serde_json::from_str(env_json).map_err(|e| JsError::new(&e.to_string()))?;

    let snap = growth::simulate_plant(&genetics, day, &env, gdd_so_far);
    serde_json::to_string(&snap).map_err(|e| JsError::new(&e.to_string()))
}

/// Simulate a full season for one plant.
/// Returns JSON array of Snapshots, one per day.
/// Soil moisture carries over between days for realistic water dynamics.
#[wasm_bindgen]
pub fn simulate_season(plant_json: &str, num_days: u16, env_json: &str) -> Result<String, JsError> {
    let plant_val: serde_json::Value =
        serde_json::from_str(plant_json).map_err(|e| JsError::new(&e.to_string()))?;
    let genetics = growth::genetics_from_json(&plant_val)
        .ok_or_else(|| JsError::new("Could not parse plant genetics"))?;
    let base_env: growth::Environment =
        serde_json::from_str(env_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut snapshots = Vec::with_capacity(num_days as usize);
    let mut gdd = 0.0_f32;
    let mut soil_moisture = base_env.soil_moisture_mm;
    // Track peak structural dimensions — plants don't shrink
    let mut peak_height = 0.0_f32;
    let mut peak_spread = 0.0_f32;
    let mut peak_root = 0.0_f32;
    // Track cumulative yield, harvest flushes, and yield trend
    let mut cumulative_yield = 0.0_f32;
    let mut peak_daily_yield = 0.0_f32;
    let mut flush_count = 0_u16;
    let mut was_producing = false;

    for day in 0..num_days {
        let mut env = base_env.clone();
        env.day_of_year = ((base_env.day_of_year as u32 + day as u32) % 365) as u16;
        if env.day_of_year == 0 { env.day_of_year = 1; }

        if soil_moisture > 0.0 {
            env.soil_moisture_mm = soil_moisture;
        }

        let mut snap = growth::simulate_plant(&genetics, day, &env, gdd);
        gdd = snap.gdd_accumulated;
        soil_moisture = snap.soil_moisture_mm;

        // Enforce monotonic structural dimensions — plants can't un-grow.
        peak_height = peak_height.max(snap.height_cm);
        peak_spread = peak_spread.max(snap.spread_cm);
        peak_root = peak_root.max(snap.root_depth_cm);
        snap.height_cm = peak_height;
        snap.spread_cm = peak_spread;
        snap.root_depth_cm = peak_root;

        // Accumulate yield over the season
        cumulative_yield += snap.daily_yield_rate;
        snap.cumulative_yield_kg = cumulative_yield;

        // Track harvest flushes (a new producing period after a gap)
        if snap.is_producing && !was_producing {
            flush_count += 1;
        }
        was_producing = snap.is_producing;
        snap.harvest_flush_count = flush_count;

        // Yield trend: ratio of today's yield to peak yield so far
        peak_daily_yield = peak_daily_yield.max(snap.daily_yield_rate);
        snap.yield_trend = if peak_daily_yield > 0.001 {
            snap.daily_yield_rate / peak_daily_yield
        } else {
            0.0
        };

        snapshots.push(snap);
    }

    serde_json::to_string(&snapshots).map_err(|e| JsError::new(&e.to_string()))
}

/// Simulate multiple plants in a bed for one day.
/// Returns JSON array of {plant_id, snapshot} objects.
#[wasm_bindgen]
pub fn simulate_bed(plants_json: &str, day: u16, env_json: &str) -> Result<String, JsError> {
    let plants: Vec<serde_json::Value> =
        serde_json::from_str(plants_json).map_err(|e| JsError::new(&e.to_string()))?;
    let env: growth::Environment =
        serde_json::from_str(env_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut snapshots = Vec::with_capacity(plants.len());
    for plant_val in &plants {
        let genetics = match growth::genetics_from_json(plant_val) {
            Some(g) => g,
            None => continue,
        };
        let snap = growth::simulate_plant(&genetics, day, &env, 0.0);
        snapshots.push(serde_json::json!({
            "plant_id": genetics.id,
            "snapshot": snap,
        }));
    }

    serde_json::to_string(&snapshots).map_err(|e| JsError::new(&e.to_string()))
}

#[derive(Debug, Clone, Deserialize)]
struct WeatherDay {
    #[serde(default)]
    temp_high_c: Option<f32>,
    #[serde(default)]
    temp_low_c: Option<f32>,
    #[serde(default)]
    humidity_pct: Option<f32>,
    #[serde(default)]
    wind_speed_ms: Option<f32>,
    #[serde(default)]
    precip_mm: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlanPlantResult {
    plant_id: String,
    role: String,
    planting_day_offset: u16,
    snapshots: Vec<growth::Snapshot>,
}

#[derive(Debug, Clone)]
struct PlanPlantState {
    plant_id: String,
    role: String,
    planting_day_offset: u16,
    genetics: growth::PlantGenetics,
    spacing_cm: f32,
    gdd: f32,
    soil_moisture: f32,
    peak_height: f32,
    peak_spread: f32,
    peak_root: f32,
    cumulative_yield: f32,
    peak_daily_yield: f32,
    flush_count: u16,
    was_producing: bool,
    snapshots: Vec<growth::Snapshot>,
}

#[derive(Debug, Clone)]
struct CompetitionPreview {
    state_index: usize,
    height_cm: f32,
    lai: f32,
    canopy_area_m2: f32,
    root_area_m2: f32,
}

fn plant_spacing_cm(plant_val: &serde_json::Value, genetics: &growth::PlantGenetics) -> f32 {
    plant_val
        .get("properties")
        .and_then(|props| props.get("metric"))
        .and_then(|metric| metric.get("spacing_cm"))
        .and_then(|value| value.as_f64())
        .map(|value| value as f32)
        .filter(|value| *value > 0.0)
        .unwrap_or_else(|| genetics.max_spread_cm.max(20.0))
}

fn plant_cell_area_m2(spacing_cm: f32) -> f32 {
    let spacing_m = spacing_cm.max(15.0) / 100.0;
    spacing_m * spacing_m
}

fn canopy_area_m2(snapshot: &growth::Snapshot) -> f32 {
    let radius_m = (snapshot.spread_cm.max(1.0) / 100.0) / 2.0;
    std::f32::consts::PI * radius_m * radius_m
}

fn root_area_m2(genetics: &growth::PlantGenetics, snapshot: &growth::Snapshot) -> f32 {
    let root_progress = if genetics.max_root_depth_cm > 0.0 {
        (snapshot.root_depth_cm / genetics.max_root_depth_cm).clamp(0.1, 1.0)
    } else {
        0.5
    };
    let radius_m = ((genetics.root_spread_cm * root_progress).max(10.0) / 100.0) / 2.0;
    std::f32::consts::PI * radius_m * radius_m
}

fn build_day_env(
    base_env: &growth::Environment,
    calendar_day: u16,
    soil_moisture: f32,
    weather: Option<&WeatherDay>,
) -> growth::Environment {
    let mut env = base_env.clone();
    env.day_of_year = ((base_env.day_of_year as u32 + calendar_day as u32) % 365) as u16;
    if env.day_of_year == 0 {
        env.day_of_year = 1;
    }
    if soil_moisture > 0.0 {
        env.soil_moisture_mm = soil_moisture;
    }
    if let Some(day) = weather {
        if let Some(value) = day.temp_high_c {
            env.temp_high_c = value;
        }
        if let Some(value) = day.temp_low_c {
            env.temp_low_c = value;
        }
        if let Some(value) = day.humidity_pct {
            env.humidity_pct = value;
        }
        if let Some(value) = day.wind_speed_ms {
            env.wind_speed_ms = value;
        }
        if let Some(value) = day.precip_mm {
            env.precip_mm = value;
        }
    }
    env
}

fn shade_fraction(previews: &[CompetitionPreview], preview_index: usize, bed_area_m2: f32) -> f32 {
    if bed_area_m2 <= 0.0 {
        return 0.0;
    }

    let target = &previews[preview_index];
    let target_height = target.height_cm.max(1.0);
    let mut overstory_lai = 0.0_f32;

    for (idx, other) in previews.iter().enumerate() {
        if idx == preview_index || other.height_cm <= target_height {
            continue;
        }

        let height_advantage = ((other.height_cm - target_height) / other.height_cm.max(1.0))
            .clamp(0.0, 1.0);
        let cover_fraction = (other.canopy_area_m2 / bed_area_m2).clamp(0.0, 4.0);
        overstory_lai += other.lai * cover_fraction * height_advantage;
    }

    (1.0 - (-0.6 * overstory_lai).exp()).clamp(0.0, 0.85)
}

fn competition_events(
    shade_fraction: f32,
    root_pressure_ratio: f32,
    root_share: f32,
    active_count: usize,
) -> Vec<growth::StressEvent> {
    let mut events = Vec::new();

    if shade_fraction > 0.01 {
        events.push(growth::StressEvent {
            kind: "competition_shade".to_string(),
            severity: shade_fraction,
            detail: format!(
                "Neighbor canopy blocks about {:.0}% of incoming light",
                shade_fraction * 100.0
            ),
        });
    }

    if root_pressure_ratio > 1.0 {
        let severity = ((root_pressure_ratio - 1.0) / root_pressure_ratio).clamp(0.0, 1.0);
        events.push(growth::StressEvent {
            kind: "root_competition".to_string(),
            severity,
            detail: format!(
                "Combined root zones exceed available bed area by {:.0}%",
                (root_pressure_ratio - 1.0) * 100.0
            ),
        });
    }

    let equal_share = 1.0 / active_count.max(1) as f32;
    if root_share + 0.01 < equal_share {
        let severity = ((equal_share - root_share) / equal_share).clamp(0.0, 1.0);
        events.push(growth::StressEvent {
            kind: "resource_competition".to_string(),
            severity,
            detail: format!(
                "This plant only captures about {:.0}% of the shared root-zone resources",
                root_share * 100.0
            ),
        });
    }

    events
}

fn build_plan_states(
    plan: &growth::PlantingPlan,
    all_plants: &[serde_json::Value],
) -> Vec<PlanPlantState> {
    let mut states = Vec::with_capacity(plan.plantings.len());

    for planting in &plan.plantings {
        let plant_val = all_plants.iter().find(|plant| {
            plant.get("id").and_then(|value| value.as_str()) == Some(&planting.plant_id)
        });
        let plant_val = match plant_val {
            Some(value) => value,
            None => continue,
        };

        let base_genetics = match growth::genetics_from_json(plant_val) {
            Some(value) => value,
            None => continue,
        };

        let genetics = if planting.seed_treatments.is_empty() {
            base_genetics
        } else {
            growth::apply_treatments(base_genetics, &planting.seed_treatments)
        };

        states.push(PlanPlantState {
            plant_id: planting.plant_id.clone(),
            role: planting.role.clone(),
            planting_day_offset: planting.planting_day_offset,
            spacing_cm: plant_spacing_cm(plant_val, &genetics),
            genetics,
            gdd: 0.0,
            soil_moisture: 0.0,
            peak_height: 0.0,
            peak_spread: 0.0,
            peak_root: 0.0,
            cumulative_yield: 0.0,
            peak_daily_yield: 0.0,
            flush_count: 0,
            was_producing: false,
            snapshots: Vec::new(),
        });
    }

    states
}

fn simulate_plan_internal(
    plan: &growth::PlantingPlan,
    all_plants: &[serde_json::Value],
    num_days: u16,
    base_env: &growth::Environment,
    weather: Option<&[WeatherDay]>,
) -> Result<Vec<PlanPlantResult>, JsError> {
    let mut states = build_plan_states(plan, all_plants);

    for calendar_day in 0..num_days {
        let weather_day = weather.and_then(|days| days.get(calendar_day as usize));
        let active_indices: Vec<usize> = states
            .iter()
            .enumerate()
            .filter_map(|(index, state)| {
                if calendar_day >= state.planting_day_offset {
                    Some(index)
                } else {
                    None
                }
            })
            .collect();

        if active_indices.is_empty() {
            continue;
        }

        let bed_area_m2 = active_indices
            .iter()
            .map(|index| plant_cell_area_m2(states[*index].spacing_cm))
            .sum::<f32>()
            .max(0.05);

        let previews: Vec<CompetitionPreview> = active_indices
            .iter()
            .map(|index| {
                let state = &states[*index];
                let plant_day = calendar_day - state.planting_day_offset;
                let env = build_day_env(base_env, calendar_day, state.soil_moisture, weather_day);
                let snapshot = growth::simulate_plant(&state.genetics, plant_day, &env, state.gdd);

                CompetitionPreview {
                    state_index: *index,
                    height_cm: snapshot.height_cm,
                    lai: snapshot.lai,
                    canopy_area_m2: canopy_area_m2(&snapshot),
                    root_area_m2: root_area_m2(&state.genetics, &snapshot),
                }
            })
            .collect();

        let active_count = previews.len();
        let total_root_area = previews
            .iter()
            .map(|preview| preview.root_area_m2)
            .sum::<f32>()
            .max(0.0001);
        let root_pressure_ratio = total_root_area / bed_area_m2;
        let root_space_factor = if total_root_area > bed_area_m2 {
            bed_area_m2 / total_root_area
        } else {
            1.0
        };

        let total_water_budget = base_env.water_ml * active_count as f32;
        let total_n_budget = base_env.npk_available.0 * active_count as f32;
        let total_p_budget = base_env.npk_available.1 * active_count as f32;
        let total_k_budget = base_env.npk_available.2 * active_count as f32;

        for (preview_index, preview) in previews.iter().enumerate() {
            let root_share = preview.root_area_m2 / total_root_area;
            let shade = shade_fraction(&previews, preview_index, bed_area_m2);
            let light_factor = (1.0 - shade).clamp(0.15, 1.0);

            let state = &mut states[preview.state_index];
            let plant_day = calendar_day - state.planting_day_offset;
            let mut env = build_day_env(base_env, calendar_day, state.soil_moisture, weather_day);
            env.water_ml = total_water_budget * root_share;
            env.npk_available = (
                total_n_budget * root_share,
                total_p_budget * root_share,
                total_k_budget * root_share,
            );
            env.soil_root_factor *= root_space_factor;

            let mut snapshot = growth::simulate_plant_with_light(
                &state.genetics,
                plant_day,
                &env,
                state.gdd,
                light_factor,
            );

            state.gdd = snapshot.gdd_accumulated;
            state.soil_moisture = snapshot.soil_moisture_mm;

            state.peak_height = state.peak_height.max(snapshot.height_cm);
            state.peak_spread = state.peak_spread.max(snapshot.spread_cm);
            state.peak_root = state.peak_root.max(snapshot.root_depth_cm);
            snapshot.height_cm = state.peak_height;
            snapshot.spread_cm = state.peak_spread;
            snapshot.root_depth_cm = state.peak_root;

            state.cumulative_yield += snapshot.daily_yield_rate;
            snapshot.cumulative_yield_kg = state.cumulative_yield;

            if snapshot.is_producing && !state.was_producing {
                state.flush_count += 1;
            }
            state.was_producing = snapshot.is_producing;
            snapshot.harvest_flush_count = state.flush_count;

            state.peak_daily_yield = state.peak_daily_yield.max(snapshot.daily_yield_rate);
            snapshot.yield_trend = if state.peak_daily_yield > 0.001 {
                snapshot.daily_yield_rate / state.peak_daily_yield
            } else {
                0.0
            };

            snapshot.day = calendar_day;
            snapshot.stress_events.extend(competition_events(
                shade,
                root_pressure_ratio,
                root_share,
                active_count,
            ));
            state.snapshots.push(snapshot);
        }
    }

    Ok(states
        .into_iter()
        .map(|state| PlanPlantResult {
            plant_id: state.plant_id,
            role: state.role,
            planting_day_offset: state.planting_day_offset,
            snapshots: state.snapshots,
        })
        .collect())
}

/// Simulate a planting plan over a full season.
/// Each planting starts at its day offset. Returns JSON array of per-plant results.
///
/// Input: plan_json (PlantingPlan), plants_json (plant database array),
///        num_days (season length), env_json (base Environment)
///
/// Output: [{ plant_id, role, planting_day_offset, snapshots: [Snapshot...] }]
#[wasm_bindgen]
pub fn simulate_plan(
    plan_json: &str,
    plants_json: &str,
    num_days: u16,
    env_json: &str,
) -> Result<String, JsError> {
    let plan: growth::PlantingPlan =
        serde_json::from_str(plan_json).map_err(|e| JsError::new(&e.to_string()))?;
    let all_plants: Vec<serde_json::Value> =
        serde_json::from_str(plants_json).map_err(|e| JsError::new(&e.to_string()))?;
    let base_env: growth::Environment =
        serde_json::from_str(env_json).map_err(|e| JsError::new(&e.to_string()))?;

    let results = simulate_plan_internal(&plan, &all_plants, num_days, &base_env, None)?;
    serde_json::to_string(&results).map_err(|e| JsError::new(&e.to_string()))
}

/// Simulate a planting plan over a weather series.
/// `weather_json` is an array of daily weather objects in chronological order.
#[wasm_bindgen]
pub fn simulate_plan_weather(
    plan_json: &str,
    plants_json: &str,
    weather_json: &str,
    num_days: u16,
    env_json: &str,
) -> Result<String, JsError> {
    let plan: growth::PlantingPlan =
        serde_json::from_str(plan_json).map_err(|e| JsError::new(&e.to_string()))?;
    let all_plants: Vec<serde_json::Value> =
        serde_json::from_str(plants_json).map_err(|e| JsError::new(&e.to_string()))?;
    let weather: Vec<WeatherDay> =
        serde_json::from_str(weather_json).map_err(|e| JsError::new(&e.to_string()))?;
    let base_env: growth::Environment =
        serde_json::from_str(env_json).map_err(|e| JsError::new(&e.to_string()))?;

    let results = simulate_plan_internal(&plan, &all_plants, num_days, &base_env, Some(&weather))?;
    serde_json::to_string(&results).map_err(|e| JsError::new(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_plant(
        id: &str,
        name: &str,
        family: &str,
        growth_habit: &str,
        mature_height_cm: f32,
        spread_cm: f32,
        root_depth_cm: f32,
        root_spread_cm: f32,
        spacing_cm: f32,
        water_ml_per_day: f32,
        nitrogen_g_per_m2: f32,
        yield_kg_per_m2: f32,
    ) -> serde_json::Value {
        json!({
            "id": id,
            "name": name,
            "family": family,
            "properties": {
                "sun_need": "full",
                "growth_habit": growth_habit,
                "water_need": if water_ml_per_day >= 700.0 { "high" } else { "medium" },
                "metric": {
                    "mature_height_cm": mature_height_cm,
                    "spread_cm": spread_cm,
                    "root_depth_cm": root_depth_cm,
                    "root_spread_cm": root_spread_cm,
                    "spacing_cm": spacing_cm,
                    "water_ml_per_day": water_ml_per_day,
                    "nitrogen_g_per_m2": nitrogen_g_per_m2,
                    "yield_kg_per_m2": yield_kg_per_m2
                }
            },
            "timing": {
                "frost_tolerance": "none",
                "days_to_germination": [5, 8],
                "days_to_maturity": [70, 90]
            }
        })
    }

    fn base_env_json() -> String {
        serde_json::to_string(&growth::Environment {
            day_of_year: 150,
            latitude: 42.0,
            altitude_m: 200.0,
            temp_high_c: 29.0,
            temp_low_c: 17.0,
            water_ml: 700.0,
            npk_available: (12.0, 6.0, 6.0),
            soil_water_factor: 1.0,
            soil_root_factor: 1.0,
            soil_n2_factor: 1.0,
            humidity_pct: 55.0,
            wind_speed_ms: 2.0,
            precip_mm: 0.0,
            soil_moisture_mm: 0.0,
            field_capacity_mm: 0.0,
            co2_ppm: 420.0,
            mulch_fraction: 0.0,
            soil_temp_c: 0.0,
        })
        .expect("env json")
    }

    fn plan_json(plant_ids: &[&str]) -> String {
        serde_json::to_string(&json!({
            "plan_name": "test-plan",
            "management_mode": "managed",
            "plantings": plant_ids.iter().enumerate().map(|(idx, id)| json!({
                "plant_id": id,
                "role": if idx == 0 { "primary" } else { "support" },
                "planting_day_offset": 0,
                "seed_treatments": []
            })).collect::<Vec<_>>()
        }))
        .expect("plan json")
    }

    fn parse_results(output: &str) -> Vec<PlanPlantResult> {
        serde_json::from_str(output).expect("parse plan results")
    }

    fn find_result<'a>(results: &'a [PlanPlantResult], plant_id: &str) -> &'a PlanPlantResult {
        results
            .iter()
            .find(|result| result.plant_id == plant_id)
            .expect("plant result")
    }

    #[test]
    fn simulate_plan_couples_light_and_root_competition() {
        let tomato = sample_plant(
            "tomato",
            "Tomato",
            "solanaceae",
            "medium",
            120.0,
            80.0,
            65.0,
            75.0,
            40.0,
            800.0,
            -12.0,
            5.0,
        );
        let corn = sample_plant(
            "corn",
            "Corn",
            "poaceae",
            "tall",
            260.0,
            55.0,
            100.0,
            65.0,
            30.0,
            700.0,
            -15.0,
            3.0,
        );
        let plants_json = serde_json::to_string(&vec![tomato.clone(), corn.clone()]).expect("plants json");
        let env_json = base_env_json();

        let tomato_only = parse_results(
            &simulate_plan(&plan_json(&["tomato"]), &plants_json, 110, &env_json).expect("single plan"),
        );
        let tomato_mix = parse_results(
            &simulate_plan(&plan_json(&["tomato", "corn"]), &plants_json, 110, &env_json).expect("mixed plan"),
        );

        let tomato_alone = &find_result(&tomato_only, "tomato").snapshots;
        let tomato_mixed = &find_result(&tomato_mix, "tomato").snapshots;

        let avg_single_dli = tomato_alone
            .iter()
            .map(|snapshot| snapshot.dli)
            .sum::<f32>() / tomato_alone.len() as f32;
        let avg_mixed_dli = tomato_mixed
            .iter()
            .map(|snapshot| snapshot.dli)
            .sum::<f32>() / tomato_mixed.len() as f32;

        assert!(avg_mixed_dli < avg_single_dli);
        assert!(tomato_mixed.iter().any(|snapshot| snapshot.stress_events.iter().any(|event| {
            event.kind == "competition_shade" || event.kind == "root_competition"
        })));
    }

    #[test]
    fn simulate_plan_weather_uses_daily_series_length() {
        let tomato = sample_plant(
            "tomato",
            "Tomato",
            "solanaceae",
            "medium",
            120.0,
            80.0,
            65.0,
            75.0,
            40.0,
            800.0,
            -12.0,
            5.0,
        );
        let plants_json = serde_json::to_string(&vec![tomato]).expect("plants json");
        let env_json = base_env_json();
        let weather_json = serde_json::to_string(&vec![
            json!({"temp_high_c": 24.0, "temp_low_c": 14.0, "humidity_pct": 60.0, "precip_mm": 2.0}),
            json!({"temp_high_c": 25.0, "temp_low_c": 15.0, "humidity_pct": 58.0, "precip_mm": 0.0}),
            json!({"temp_high_c": 26.0, "temp_low_c": 16.0, "humidity_pct": 56.0, "precip_mm": 0.0}),
            json!({"temp_high_c": 27.0, "temp_low_c": 16.0, "humidity_pct": 54.0, "precip_mm": 1.0}),
            json!({"temp_high_c": 28.0, "temp_low_c": 17.0, "humidity_pct": 52.0, "precip_mm": 0.0}),
            json!({"temp_high_c": 29.0, "temp_low_c": 18.0, "humidity_pct": 50.0, "precip_mm": 0.0}),
        ])
        .expect("weather json");

        let results = parse_results(
            &simulate_plan_weather(&plan_json(&["tomato"]), &plants_json, &weather_json, 6, &env_json)
                .expect("plan weather"),
        );

        assert_eq!(find_result(&results, "tomato").snapshots.len(), 6);
    }
}
