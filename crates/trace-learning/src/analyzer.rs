use crate::catalog::{FeatureSurfaceCatalog, FeatureSurfaceLink};
use crate::model::NormalizedSession;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionAnalysis {
    pub session_id: String,
    pub changed_files: Vec<String>,
    pub tool_call_counts: BTreeMap<String, usize>,
    pub surface_links: Vec<FeatureSurfaceLink>,
}

pub struct SessionAnalyzer<'a> {
    catalog: Option<&'a FeatureSurfaceCatalog>,
}

impl<'a> SessionAnalyzer<'a> {
    pub fn new() -> Self {
        Self { catalog: None }
    }

    pub fn with_catalog(catalog: &'a FeatureSurfaceCatalog) -> Self {
        Self {
            catalog: Some(catalog),
        }
    }

    pub fn analyze(&self, session: &NormalizedSession) -> SessionAnalysis {
        let mut changed_file_set = BTreeSet::new();
        let mut tool_call_counts = BTreeMap::new();
        let mut surface_links = Vec::new();

        for tool_call in &session.tool_calls {
            *tool_call_counts
                .entry(tool_call.tool_name.clone())
                .or_insert(0) += 1;
        }

        for file_event in &session.file_events {
            changed_file_set.insert(file_event.path.clone());
        }

        if let Some(catalog) = self.catalog {
            for changed_file in &changed_file_set {
                surface_links.extend(catalog.best_links_for_path(changed_file));
            }

            surface_links.sort_by(|a, b| {
                a.route
                    .cmp(&b.route)
                    .then(a.via_path.cmp(&b.via_path))
                    .then(a.source_path.cmp(&b.source_path))
            });
            surface_links.dedup_by(|a, b| {
                a.route == b.route && a.via_path == b.via_path && a.source_path == b.source_path
            });
        }

        SessionAnalysis {
            session_id: session.session_id.clone(),
            changed_files: changed_file_set.into_iter().collect(),
            tool_call_counts,
            surface_links,
        }
    }
}
