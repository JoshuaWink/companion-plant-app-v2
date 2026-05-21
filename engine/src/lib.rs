//! Companion Garden Graph Engine
//!
//! Loads plant relationship data and answers graph queries:
//! - companions/antagonists for a given plant
//! - conflict detection for a set of plants
//! - temporal succession dependencies
//! - planting window calculations

mod graph;
mod model;
mod timeline;

pub use graph::CompanionGraph;
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
