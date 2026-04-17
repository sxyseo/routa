use crate::error::TraceLearningError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Ord, PartialOrd)]
pub enum FeatureSurfaceKind {
    Page,
    Api,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurface {
    pub kind: FeatureSurfaceKind,
    pub route: String,
    pub source_path: String,
    pub source_dir: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SurfaceLinkConfidence {
    High,
    Medium,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurfaceLink {
    pub kind: FeatureSurfaceKind,
    pub route: String,
    pub source_path: String,
    pub via_path: String,
    pub confidence: SurfaceLinkConfidence,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FeatureSurfaceCatalog {
    pub surfaces: Vec<FeatureSurface>,
}

impl FeatureSurfaceCatalog {
    pub fn from_repo_root(repo_root: &Path) -> Result<Self, TraceLearningError> {
        let app_root = repo_root.join("src").join("app");
        let mut paths = Vec::new();
        collect_paths(&app_root, &mut paths)?;

        let mut surfaces = Vec::new();
        for path in paths {
            let rel = path
                .strip_prefix(repo_root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if rel.ends_with("/page.tsx") {
                let route = normalize_page_route(&rel);
                let source_dir = rel.trim_end_matches("/page.tsx").to_string();
                surfaces.push(FeatureSurface {
                    kind: FeatureSurfaceKind::Page,
                    route,
                    source_path: rel,
                    source_dir,
                });
            } else if rel.contains("/api/") && rel.ends_with("/route.ts") {
                let route = normalize_api_route(&rel);
                let source_dir = rel.trim_end_matches("/route.ts").to_string();
                surfaces.push(FeatureSurface {
                    kind: FeatureSurfaceKind::Api,
                    route,
                    source_path: rel,
                    source_dir,
                });
            }
        }

        surfaces.sort_by(|a, b| {
            a.route
                .cmp(&b.route)
                .then(a.source_path.cmp(&b.source_path))
        });
        Ok(Self { surfaces })
    }

    pub fn best_links_for_path(&self, changed_path: &str) -> Vec<FeatureSurfaceLink> {
        let mut best_per_kind: BTreeMap<FeatureSurfaceKind, (usize, bool, &FeatureSurface)> =
            BTreeMap::new();

        for surface in &self.surfaces {
            let direct = changed_path == surface.source_path;
            let nested = surface.route != "/"
                && changed_path.starts_with(&(surface.source_dir.clone() + "/"));
            if !direct && !nested {
                continue;
            }

            let specificity = surface.source_dir.matches('/').count();
            let replace = match best_per_kind.get(&surface.kind) {
                Some((best_specificity, best_direct, _)) => {
                    (direct && !best_direct)
                        || (direct == *best_direct && specificity > *best_specificity)
                }
                None => true,
            };

            if replace {
                best_per_kind.insert(surface.kind.clone(), (specificity, direct, surface));
            }
        }

        best_per_kind
            .into_values()
            .map(|(_, direct, surface)| FeatureSurfaceLink {
                kind: surface.kind.clone(),
                route: surface.route.clone(),
                source_path: surface.source_path.clone(),
                via_path: changed_path.to_string(),
                confidence: if direct {
                    SurfaceLinkConfidence::High
                } else {
                    SurfaceLinkConfidence::Medium
                },
            })
            .collect()
    }
}

fn collect_paths(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), TraceLearningError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_paths(&path, out)?;
        } else {
            out.push(path);
        }
    }
    Ok(())
}

fn normalize_page_route(rel: &str) -> String {
    if rel == "src/app/page.tsx" {
        return "/".to_string();
    }
    let route = rel
        .trim_start_matches("src/app/")
        .trim_end_matches("/page.tsx");
    format!("/{}", normalize_page_segments(route))
}

fn normalize_api_route(rel: &str) -> String {
    let mut route = rel
        .trim_start_matches("src/app/")
        .trim_end_matches("/route.ts")
        .to_string();
    route = route.replace("[...", "{");
    route = route.replace('[', "{");
    route = route.replace(']', "}");
    format!("/{}", route)
}

fn normalize_page_segments(route: &str) -> String {
    route
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            if segment.starts_with("[...") && segment.ends_with(']') {
                format!(":{}", &segment[4..segment.len() - 1])
            } else if segment.starts_with('[') && segment.ends_with(']') {
                format!(":{}", &segment[1..segment.len() - 1])
            } else {
                segment.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn builds_catalog_and_picks_most_specific_matches() {
        let dir = tempdir().unwrap();
        let repo = dir.path();
        fs::create_dir_all(repo.join("src/app/workspace/[workspaceId]/sessions/[sessionId]"))
            .unwrap();
        fs::create_dir_all(repo.join("src/app/api/sessions/[sessionId]")).unwrap();
        fs::write(repo.join("src/app/page.tsx"), "").unwrap();
        fs::write(
            repo.join("src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx"),
            "",
        )
        .unwrap();
        fs::write(repo.join("src/app/api/sessions/[sessionId]/route.ts"), "").unwrap();

        let catalog = FeatureSurfaceCatalog::from_repo_root(repo).unwrap();
        let links = catalog.best_links_for_path(
            "src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx",
        );

        assert_eq!(links.len(), 1);
        assert_eq!(
            links[0].route,
            "/workspace/:workspaceId/sessions/:sessionId"
        );

        let api_links = catalog.best_links_for_path("src/app/api/sessions/[sessionId]/route.ts");
        assert_eq!(api_links.len(), 1);
        assert_eq!(api_links[0].route, "/api/sessions/{sessionId}");
    }
}
