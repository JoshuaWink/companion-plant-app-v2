//! Companion Garden Graph Engine
//!
//! Loads plant relationship data and answers graph queries:
//! - companions/antagonists for a given plant
//! - conflict detection for a set of plants
//! - path finding between plants through shared relationships

mod graph;
mod model;

pub use graph::CompanionGraph;
pub use model::{Edge, Plant, RelationType};

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
}
