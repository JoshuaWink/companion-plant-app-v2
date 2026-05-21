use std::collections::HashMap;

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;

use crate::model::{Conflict, Edge, Plant, RelationType};

/// The core graph data structure wrapping petgraph.
pub struct CompanionGraph {
    graph: DiGraph<Plant, Edge>,
    /// Fast lookup: plant ID → node index
    id_map: HashMap<String, NodeIndex>,
}

impl CompanionGraph {
    /// Build the graph from deserialized plant and edge data.
    pub fn from_data(plants: Vec<Plant>, edges: Vec<Edge>) -> Self {
        let mut graph = DiGraph::new();
        let mut id_map = HashMap::new();

        // Add plant nodes
        for plant in plants {
            let id = plant.id.clone();
            let idx = graph.add_node(plant);
            id_map.insert(id, idx);
        }

        // Add edges (skip edges that reference unknown plants)
        for edge in edges {
            if let (Some(&src_idx), Some(&tgt_idx)) =
                (id_map.get(&edge.source), id_map.get(&edge.target))
            {
                graph.add_edge(src_idx, tgt_idx, edge);
            }
        }

        CompanionGraph { graph, id_map }
    }

    /// Get all companions for a plant.
    pub fn companions(&self, plant_id: &str) -> Vec<String> {
        self.neighbors_by_type(plant_id, RelationType::Companion)
    }

    /// Get all antagonists for a plant.
    pub fn antagonists(&self, plant_id: &str) -> Vec<String> {
        self.neighbors_by_type(plant_id, RelationType::Antagonist)
    }

    /// Get outgoing neighbors filtered by relationship type.
    fn neighbors_by_type(&self, plant_id: &str, rel_type: RelationType) -> Vec<String> {
        let Some(&idx) = self.id_map.get(plant_id) else {
            return Vec::new();
        };

        self.graph
            .edges_directed(idx, Direction::Outgoing)
            .filter(|e| e.weight().rel_type == rel_type)
            .map(|e| {
                self.graph[e.target()].id.clone()
            })
            .collect()
    }

    /// Given a set of selected plants, find all antagonist conflicts among them.
    pub fn conflicts(&self, plant_ids: &[String]) -> Vec<Conflict> {
        let mut results = Vec::new();
        let id_set: std::collections::HashSet<&str> =
            plant_ids.iter().map(|s| s.as_str()).collect();

        for id in plant_ids {
            let Some(&idx) = self.id_map.get(id.as_str()) else {
                continue;
            };

            for edge in self.graph.edges_directed(idx, Direction::Outgoing) {
                let weight = edge.weight();
                if weight.rel_type == RelationType::Antagonist {
                    let target_id = &self.graph[edge.target()].id;
                    if id_set.contains(target_id.as_str()) {
                        results.push(Conflict {
                            source: id.clone(),
                            target: target_id.clone(),
                            reason: weight.reason.clone(),
                        });
                    }
                }
            }
        }

        results
    }

    /// Get the relationship detail between two specific plants.
    pub fn relationship(&self, source: &str, target: &str) -> Option<&Edge> {
        let src_idx = self.id_map.get(source)?;
        let tgt_idx = self.id_map.get(target)?;

        self.graph
            .edges_directed(*src_idx, Direction::Outgoing)
            .find(|e| e.target() == *tgt_idx)
            .map(|e| e.weight())
    }

    /// Get all plant IDs.
    pub fn plant_ids(&self) -> Vec<&str> {
        self.graph
            .node_weights()
            .map(|p| p.id.as_str())
            .collect()
    }

    /// Number of plants in the graph.
    pub fn plant_count(&self) -> usize {
        self.graph.node_count()
    }

    /// Number of relationship edges.
    pub fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_data() -> (Vec<Plant>, Vec<Edge>) {
        let plants = vec![
            Plant { id: "basil".into(), name: "Basil".into(), lifecycle: Some("annual".into()), stub: false },
            Plant { id: "tomatoes".into(), name: "Tomatoes".into(), lifecycle: Some("annual".into()), stub: false },
            Plant { id: "sage".into(), name: "Sage".into(), lifecycle: Some("perennial".into()), stub: false },
            Plant { id: "corn".into(), name: "Corn".into(), lifecycle: Some("annual".into()), stub: false },
        ];

        let edges = vec![
            Edge { source: "basil".into(), target: "tomatoes".into(), rel_type: RelationType::Companion, reason: "Repels hornworms".into() },
            Edge { source: "tomatoes".into(), target: "basil".into(), rel_type: RelationType::Companion, reason: "Basil repels pests".into() },
            Edge { source: "basil".into(), target: "sage".into(), rel_type: RelationType::Antagonist, reason: "Sage needs dry soil".into() },
            Edge { source: "corn".into(), target: "tomatoes".into(), rel_type: RelationType::Antagonist, reason: "Corn shades tomatoes".into() },
        ];

        (plants, edges)
    }

    #[test]
    fn test_build_graph() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        assert_eq!(g.plant_count(), 4);
        assert_eq!(g.edge_count(), 4);
    }

    #[test]
    fn test_companions() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let companions = g.companions("basil");
        assert_eq!(companions, vec!["tomatoes"]);
    }

    #[test]
    fn test_antagonists() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let antags = g.antagonists("basil");
        assert_eq!(antags, vec!["sage"]);
    }

    #[test]
    fn test_unknown_plant_returns_empty() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        assert!(g.companions("fennel").is_empty());
        assert!(g.antagonists("fennel").is_empty());
    }

    #[test]
    fn test_conflicts_in_selection() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);

        // Selecting basil + sage should surface the antagonist relationship
        let conflicts = g.conflicts(&["basil".into(), "sage".into()]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].source, "basil");
        assert_eq!(conflicts[0].target, "sage");
    }

    #[test]
    fn test_no_conflicts_for_companions() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);

        let conflicts = g.conflicts(&["basil".into(), "tomatoes".into()]);
        assert_eq!(conflicts.len(), 0);
    }

    #[test]
    fn test_relationship_detail() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);

        let rel = g.relationship("basil", "tomatoes").unwrap();
        assert_eq!(rel.rel_type, RelationType::Companion);
        assert!(rel.reason.contains("hornworms"));
    }

    #[test]
    fn test_relationship_none_for_unconnected() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);

        assert!(g.relationship("sage", "corn").is_none());
    }

    #[test]
    fn test_plant_ids() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let ids = g.plant_ids();
        assert_eq!(ids.len(), 4);
        assert!(ids.contains(&"basil"));
        assert!(ids.contains(&"tomatoes"));
    }

    #[test]
    fn test_edges_with_unknown_target_are_skipped() {
        let plants = vec![
            Plant { id: "basil".into(), name: "Basil".into(), lifecycle: Some("annual".into()), stub: false },
        ];
        let edges = vec![
            Edge { source: "basil".into(), target: "nonexistent".into(), rel_type: RelationType::Companion, reason: "...".into() },
        ];

        let g = CompanionGraph::from_data(plants, edges);
        assert_eq!(g.plant_count(), 1);
        assert_eq!(g.edge_count(), 0); // edge skipped because target doesn't exist
    }
}
