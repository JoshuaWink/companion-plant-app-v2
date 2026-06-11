use std::collections::HashMap;

use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;

use crate::model::{ConfidenceTier, Conflict, Edge, Plant, RelationType, TemporalDep};

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
        for mut edge in edges {
            let (inferred_confidence, inferred_evidence) =
                infer_relationship_metadata(&edge.reason, edge.rel_type);
            if edge.evidence.is_empty() {
                edge.evidence = inferred_evidence.to_string();
                if edge.confidence == ConfidenceTier::Speculative {
                    edge.confidence = inferred_confidence;
                }
            }
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
                            confidence: weight.confidence,
                            evidence: weight.evidence.clone(),
                        });
                    }
                }
            }
        }

        results
    }

    /// Given a set of selected plants, find all temporal (precedes) dependencies.
    pub fn temporal_deps(&self, plant_ids: &[String]) -> Vec<TemporalDep> {
        let mut results = Vec::new();
        let id_set: std::collections::HashSet<&str> =
            plant_ids.iter().map(|s| s.as_str()).collect();

        for id in plant_ids {
            let Some(&idx) = self.id_map.get(id.as_str()) else {
                continue;
            };

            for edge in self.graph.edges_directed(idx, Direction::Outgoing) {
                let weight = edge.weight();
                if weight.rel_type == RelationType::Precedes {
                    let target_id = &self.graph[edge.target()].id;
                    if id_set.contains(target_id.as_str()) {
                        results.push(TemporalDep {
                            predecessor: id.clone(),
                            successor: target_id.clone(),
                            reason: weight.reason.clone(),
                            confidence: weight.confidence,
                            evidence: weight.evidence.clone(),
                            gap_days: weight.gap_days.unwrap_or(0),
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

fn infer_relationship_metadata(reason: &str, rel_type: RelationType) -> (ConfidenceTier, &'static str) {
    let text = reason.trim().to_lowercase();

    if text.is_empty() {
        return (ConfidenceTier::Speculative, "missing-reason");
    }

    let disease_terms = [
        "verticillium",
        "fusarium",
        "blight",
        "wilt",
        "club root",
        "clubroot",
        "nematode",
        "nematodes",
        "susceptible",
        "share pests",
        "same family",
    ];
    if disease_terms.iter().any(|term| text.contains(term)) {
        return (ConfidenceTier::Consensus, "disease-avoidance");
    }

    if rel_type == RelationType::Precedes &&
        ["gap", "soil", "nitrogen", "weed", "suppression", "establishment"]
            .iter()
            .any(|term| text.contains(term))
    {
        return (ConfidenceTier::Consensus, "succession-practice");
    }

    let mechanistic_terms = [
        "repel",
        "deter",
        "aphid",
        "beetle",
        "insect",
        "trap crop",
        "pollinator",
        "shade",
        "support",
        "trellis",
        "water",
        "soil",
        "nutrient",
        "nitrogen",
        "sun",
        "ground cover",
        "growing conditions",
        "resources",
        "lime",
    ];
    let hedged_terms = [" may ", " might ", " can ", "sometimes", "thought to", "often"];

    if mechanistic_terms.iter().any(|term| text.contains(term)) {
        if hedged_terms.iter().any(|term| text.contains(term)) {
            return (ConfidenceTier::Traditional, "garden-tradition");
        }
        return (ConfidenceTier::Empirical, "observed-garden-practice");
    }

    if hedged_terms.iter().any(|term| text.contains(term)) {
        return (ConfidenceTier::Traditional, "garden-tradition");
    }

    (ConfidenceTier::Speculative, "inferred-from-text")
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
            Plant { id: "peas".into(), name: "Peas".into(), lifecycle: Some("annual".into()), stub: false },
        ];

        let edges = vec![
            Edge { source: "basil".into(), target: "tomatoes".into(), rel_type: RelationType::Companion, reason: "Repels hornworms".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: None },
            Edge { source: "tomatoes".into(), target: "basil".into(), rel_type: RelationType::Companion, reason: "Basil repels pests".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: None },
            Edge { source: "basil".into(), target: "sage".into(), rel_type: RelationType::Antagonist, reason: "Sage needs dry soil".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: None },
            Edge { source: "corn".into(), target: "tomatoes".into(), rel_type: RelationType::Antagonist, reason: "Corn shades tomatoes".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: None },
            Edge { source: "peas".into(), target: "tomatoes".into(), rel_type: RelationType::Precedes, reason: "Peas fix nitrogen for heavy-feeding tomatoes".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: Some(7) },
            Edge { source: "peas".into(), target: "corn".into(), rel_type: RelationType::Precedes, reason: "Peas fix nitrogen; corn benefits from enriched soil".into(), confidence: ConfidenceTier::Speculative, evidence: "".into(), gap_days: Some(7) },
        ];

        (plants, edges)
    }

    #[test]
    fn test_build_graph() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        assert_eq!(g.plant_count(), 5);
        assert_eq!(g.edge_count(), 6);
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
        let conflicts = g.conflicts(&["basil".into(), "sage".into()]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].source, "basil");
        assert_eq!(conflicts[0].target, "sage");
        assert_eq!(conflicts[0].confidence, ConfidenceTier::Empirical);
        assert_eq!(conflicts[0].evidence, "observed-garden-practice");
    }

    #[test]
    fn test_disease_reason_infers_consensus_confidence() {
        let plants = vec![
            Plant { id: "tomatoes".into(), name: "Tomatoes".into(), lifecycle: Some("annual".into()), stub: false },
            Plant { id: "potatoes".into(), name: "Potatoes".into(), lifecycle: Some("annual".into()), stub: false },
        ];
        let edges = vec![
            Edge {
                source: "tomatoes".into(),
                target: "potatoes".into(),
                rel_type: RelationType::Antagonist,
                reason: "They are susceptible to verticillium wilt and share pests.".into(),
                confidence: ConfidenceTier::Speculative,
                evidence: "".into(),
                gap_days: None,
            },
        ];
        let g = CompanionGraph::from_data(plants, edges);
        let rel = g.relationship("tomatoes", "potatoes").unwrap();
        assert_eq!(rel.confidence, ConfidenceTier::Consensus);
        assert_eq!(rel.evidence, "disease-avoidance");
    }

    #[test]
    fn test_no_conflicts_for_companions() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let conflicts = g.conflicts(&["basil".into(), "tomatoes".into()]);
        assert_eq!(conflicts.len(), 0);
    }

    #[test]
    fn test_temporal_deps_found() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let deps = g.temporal_deps(&["peas".into(), "tomatoes".into()]);
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].predecessor, "peas");
        assert_eq!(deps[0].successor, "tomatoes");
        assert_eq!(deps[0].gap_days, 7);
        assert!(deps[0].reason.contains("nitrogen"));
    }

    #[test]
    fn test_temporal_deps_multiple() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let deps = g.temporal_deps(&["peas".into(), "tomatoes".into(), "corn".into()]);
        assert_eq!(deps.len(), 2);
    }

    #[test]
    fn test_temporal_deps_none_when_no_precedes() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let deps = g.temporal_deps(&["basil".into(), "tomatoes".into()]);
        assert_eq!(deps.len(), 0);
    }

    #[test]
    fn test_temporal_deps_empty_selection() {
        let (plants, edges) = test_data();
        let g = CompanionGraph::from_data(plants, edges);
        let deps = g.temporal_deps(&[]);
        assert_eq!(deps.len(), 0);
    }
}
