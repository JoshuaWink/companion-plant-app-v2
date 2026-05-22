//! Companion Garden Engine
//!
//! Graph queries (companions, antagonists, conflicts, succession)
//! + plant lifecycle simulation (growth curves, environment response, stress)

mod graph;
pub mod growth;
mod model;
mod timeline;

pub use graph::CompanionGraph;
pub use growth::{Environment, PlantGenetics, Snapshot, simulate_plant, genetics_from_json, PhotoPath};
pub use model::{Edge, Plant, RelationType, TemporalDep};
pub use timeline::{compute_window, PlantTiming, PlantingWindow};

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
