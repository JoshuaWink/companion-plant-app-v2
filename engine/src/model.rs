use serde::{Deserialize, Serialize};

/// A plant node in the graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plant {
    pub id: String,
    pub name: String,
    pub lifecycle: Option<String>,
    #[serde(default)]
    pub stub: bool,
}

/// The type of relationship between two plants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RelationType {
    Companion,
    Antagonist,
    Precedes,
}

/// A directed edge between two plants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub rel_type: RelationType,
    #[serde(default)]
    pub reason: String,
    /// Minimum gap in days between predecessor harvest and successor planting.
    #[serde(default)]
    pub gap_days: Option<u16>,
}

/// A conflict detected in a garden selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    pub source: String,
    pub target: String,
    pub reason: String,
}

/// A temporal succession dependency between two plants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemporalDep {
    pub predecessor: String,
    pub successor: String,
    pub reason: String,
    pub gap_days: u16,
}
