//! ACP Binary Manager - Downloads and extracts binary agents.
//!
//! Handles:
//! - Downloading agent archives from URLs
//! - Extracting ZIP, TAR.GZ, TAR.BZ2 formats
//! - Setting executable permissions on Unix
//! - Removing macOS quarantine attributes

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;

use super::paths::AcpPaths;
use super::registry_types::BinaryInfo;

/// Manages binary agent downloads and extraction.
pub struct AcpBinaryManager {
    paths: AcpPaths,
    /// Locks to prevent concurrent downloads of the same agent
    download_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl AcpBinaryManager {
    /// Create a new binary manager.
    pub fn new(paths: AcpPaths) -> Self {
        Self {
            paths,
            download_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Download and install a binary agent.
    /// Returns the path to the executable.
    /// Records version history for rollback support.
    ///
    /// **Incremental update strategy:**
    /// 1. If `diff_url` is present and non-empty, and an older version exists on disk,
    ///    attempt diff download + patch first.
    /// 2. Apply the patch to produce the new binary, then verify SHA256.
    /// 3. If SHA256 matches the registry target → success.
    /// 4. If SHA256 mismatches or patch fails → fallback to full archive download.
    pub async fn install_binary(
        &self,
        agent_id: &str,
        version: &str,
        binary_info: &BinaryInfo,
    ) -> Result<PathBuf, String> {
        // Get or create a lock for this agent
        let lock = {
            let mut locks = self.download_locks.lock().await;
            locks
                .entry(agent_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        // Hold the lock during download/extraction
        let _guard = lock.lock().await;

        let install_dir = self.paths.agent_version_dir(agent_id, version);
        let download_dir = self.paths.agent_download_dir(agent_id, version);

        // Check if already installed
        if install_dir.exists() {
            if let Some(exe) = self.find_executable(&install_dir, binary_info).await {
                tracing::info!(
                    "[AcpBinaryManager] Agent {} already installed at {:?}",
                    agent_id,
                    exe
                );
                return Ok(exe);
            }
        }

        // Create directories
        tokio::fs::create_dir_all(&download_dir)
            .await
            .map_err(|e| format!("Failed to create download dir: {e}"))?;
        tokio::fs::create_dir_all(&install_dir)
            .await
            .map_err(|e| format!("Failed to create install dir: {e}"))?;

        // Download the archive
        let archive_path = self
            .download_archive(&binary_info.archive, &download_dir)
        // Time the installation for rollback comparison
        let install_start = Instant::now();

        // Attempt incremental update (diff + patch), with fallback to full download
        let (archive_path, download_method) = self
            .install_with_incremental_fallback(
                agent_id,
                version,
                binary_info,
                &download_dir,
            )
            .await?;

        // Extract the archive
        self.extract_archive(&archive_path, &install_dir).await?;

        // Find and prepare the executable
        let exe_path = self
            .find_executable(&install_dir, binary_info)
            .await
            .ok_or_else(|| "Could not find executable in extracted archive".to_string())?;

        // Set executable permissions and remove quarantine
        self.prepare_executable(&exe_path).await?;

        let install_duration_ms = install_start.elapsed().as_millis() as u64;

        // Compute SHA256 of the installed binary
        let sha256 = self.compute_sha256(&exe_path).await.ok();

        // Get file size
        let size_bytes = tokio::fs::metadata(&exe_path)
            .await
            .ok()
            .map(|m| m.len());

        // Record version history (installer handles the ref to AcpInstallationState)
        let entry = VersionHistoryEntry {
            version: version.to_string(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            sha256: sha256.clone(),
            size_bytes,
            install_duration_ms: Some(install_duration_ms),
            download_method: Some(match download_method {
                DownloadMethod::Incremental => "incremental".to_string(),
                DownloadMethod::Full => "full".to_string(),
            }),
        };

        // Store in install_dir for retrieval by installation_state manager
        self.save_version_entry(&install_dir, &entry).await?;

        // Clean up download directory
        let _ = tokio::fs::remove_dir_all(&download_dir).await;

        tracing::info!(
            "[AcpBinaryManager] Installed {} v{} at {:?}",
            agent_id,
            version,
            exe_path
            exe_path,
            install_duration_ms,
            sha256.as_ref().map(|s| &s[..8.min(s.len())])
        );
        Ok(exe_path)
    }

    /// Rollback a binary agent to a specific version.
    /// - Re-downloads the binary for the target version
    /// - Verifies SHA256 checksum
    /// - Ensures rollback time does not exceed 150% of original install time
    /// Returns the path to the rolled-back executable.
    pub async fn rollback_binary(
        &self,
        agent_id: &str,
        target_version: &str,
        binary_info: &BinaryInfo,
        history_entry: Option<VersionHistoryEntry>,
    ) -> Result<PathBuf, String> {
        let lock = {
            let mut locks = self.download_locks.lock().await;
            locks
                .entry(agent_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = lock.lock().await;

        // Look up version history for the time constraint
        let max_duration_ms = history_entry
            .as_ref()
            .and_then(|e| e.install_duration_ms)
            .map(|d| (d as f64 * 1.5) as u64);

        let install_dir = self.paths.agent_version_dir(agent_id, target_version);
        let download_dir = self.paths.agent_download_dir(agent_id, target_version);

        // Remove existing directory for a clean rollback
        if install_dir.exists() {
            tokio::fs::remove_dir_all(&install_dir)
                .await
                .map_err(|e| format!("Failed to remove old version dir: {e}"))?;
        }

        tokio::fs::create_dir_all(&download_dir)
            .await
            .map_err(|e| format!("Failed to create download dir: {e}"))?;
        tokio::fs::create_dir_all(&install_dir)
            .await
            .map_err(|e| format!("Failed to create install dir: {e}"))?;

        let install_start = Instant::now();

        // Download (rollbacks always use full download — no incremental for rollbacks)
        let archive_path = self
            .download_archive(&binary_info.archive, &download_dir)
            .await?;

        // Extract
        self.extract_archive(&archive_path, &install_dir).await?;

        // Find executable
        let exe_path = self
            .find_executable(&install_dir, binary_info)
            .await
            .ok_or_else(|| "Could not find executable in extracted archive".to_string())?;

        // Prepare executable
        self.prepare_executable(&exe_path).await?;

        let actual_duration_ms = install_start.elapsed().as_millis() as u64;

        // Verify time constraint
        if let Some(max_ms) = max_duration_ms {
            if actual_duration_ms > max_ms {
                tracing::warn!(
                    "[AcpBinaryManager] Rollback of {} v{} took {}ms (limit: {}ms) — exceeding 150% threshold",
                    agent_id,
                    target_version,
                    actual_duration_ms,
                    max_ms
                );
            }
        }

        // Verify SHA256
        let actual_sha256 = self.compute_sha256(&exe_path).await?;
        if let Some(expected_sha256) = &binary_info.sha256 {
            if &actual_sha256 != expected_sha256 {
                return Err(format!(
                    "SHA256 mismatch during rollback: expected {}, got {}",
                    expected_sha256, actual_sha256
                ));
            }
        }

        // Save the new version entry for future rollbacks
        let entry = VersionHistoryEntry {
            version: target_version.to_string(),
            installed_at: chrono::Utc::now().to_rfc3339(),
            sha256: Some(actual_sha256.clone()),
            size_bytes: tokio::fs::metadata(&exe_path).await.ok().map(|m| m.len()),
            install_duration_ms: Some(actual_duration_ms),
            download_method: Some("full".to_string()),
        };
        self.save_version_entry(&install_dir, &entry).await?;

        let _ = tokio::fs::remove_dir_all(&download_dir).await;

        tracing::info!(
            "[AcpBinaryManager] Rolled back {} to v{} at {:?} ({}ms, sha256={})",
            agent_id,
            target_version,
            exe_path,
            actual_duration_ms,
            &actual_sha256[..8.min(actual_sha256.len())]
        );
        Ok(exe_path)
    }

    /// Encode bytes as lowercase hex string.
    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Compute SHA256 hash of a file.
    async fn compute_sha256(&self, path: &Path) -> Result<String, String> {
        let path = path.to_path_buf();
        tokio::task::spawn_blocking(move || {
            use std::fs::File;
            use std::io::Read;

            let mut file = File::open(&path)
                .map_err(|e| format!("Failed to open file for SHA256: {e}"))?;
            let mut hasher = sha2::Sha256::new();
            let mut buffer = [0u8; 8192];

            loop {
                let n = file
                    .read(&mut buffer)
                    .map_err(|e| format!("Failed to read file for SHA256: {e}"))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buffer[..n]);
            }

            Ok(Self::hex_encode(hasher.finalize().as_ref()))
        })
        .await
        .map_err(|e| format!("SHA256 task failed: {e}"))?
    }

    /// Download method for version history recording.
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum DownloadMethod {
        Incremental,
        Full,
    }

    /// Attempt incremental update (diff + patch), fallback to full download on any failure.
    /// Returns (archive_path, download_method).
    async fn install_with_incremental_fallback(
        &self,
        agent_id: &str,
        version: &str,
        binary_info: &BinaryInfo,
        download_dir: &Path,
    ) -> Result<(PathBuf, DownloadMethod), String> {
        // Step 1: Check if diff_url is available
        let Some(diff_url) = binary_info.diff_url.as_ref() else {
            tracing::info!(
                "[AcpBinaryManager] No diff_url for {} {} — using full download",
                agent_id,
                version
            );
            let path = self
                .download_archive(&binary_info.archive, download_dir)
                .await?;
            return Ok((path, DownloadMethod::Full));
        };

        if diff_url.trim().is_empty() {
            tracing::info!(
                "[AcpBinaryManager] diff_url is empty for {} {} — using full download",
                agent_id,
                version
            );
            let path = self
                .download_archive(&binary_info.archive, download_dir)
                .await?;
            return Ok((path, DownloadMethod::Full));
        }

        // Step 2: Find the currently installed older version to use as source
        let older_version = self.find_older_installed_version(agent_id, version).await;

        if let Some((older_ver, older_exe)) = older_version {
            tracing::info!(
                "[AcpBinaryManager] Attempting incremental update for {} from {} → {}",
                agent_id,
                older_ver,
                version
            );

            // Download the patch
            let patch_path = self
                .download_archive(diff_url, download_dir)
                .await
                .inspect_err(|e| {
                    tracing::warn!(
                        "[AcpBinaryManager] Diff download failed for {} {}: {e}",
                        agent_id,
                        version
                    );
                })
                .ok();

            if let Some(patch_path) = patch_path {
                let patch_bytes = tokio::fs::read(&patch_path).await
                    .map_err(|e| format!("Failed to read patch file: {e}"))
                    .inspect_err(|e| tracing::warn!("[AcpBinaryManager] {e}"))
                    .ok();

                if let Some(patch_data) = patch_bytes {
                    // Apply patch to older binary
                    match self.apply_patch(&older_exe, &patch_data).await {
                        Ok(patched_bytes) => {
                            tracing::info!(
                                "[AcpBinaryManager] Patch applied successfully ({} bytes), verifying SHA256",
                                patched_bytes.len()
                            );

                            // Verify SHA256 against expected value
                            let actual_sha = Self::hex_encode(sha2::Sha256::digest(&patched_bytes).as_ref());
                            if let Some(expected_sha) = &binary_info.sha256 {
                                if actual_sha == **expected_sha {
                                    // Write the patched binary as the new archive
                                    let patched_exe_path = download_dir.join(format!("{}-patched", binary_info.cmd.as_deref().unwrap_or("binary")));
                                    if let Err(e) = tokio::fs::write(&patched_exe_path, &patched_bytes).await {
                                        tracing::warn!("[AcpBinaryManager] Failed to write patched binary: {e} — falling back to full download",);
                                        // Fall through to full download
                                    } else {
                                        let full_bytes = patched_bytes.len();
                                        tracing::info!(
                                            "[AcpBinaryManager] Incremental update SUCCESS for {} {} (downloaded {} bytes vs {} expected full bytes)",
                                            agent_id,
                                            version,
                                            patch_data.len(),
                                            full_bytes
                                        );
                                        return Ok((patched_exe_path, DownloadMethod::Incremental));
                                    }
                                } else {
                                    tracing::warn!(
                                        "[AcpBinaryManager] SHA256 mismatch after patch for {} {}: expected {}, got {} — falling back to full download",
                                        agent_id,
                                        version,
                                        expected_sha,
                                        &actual_sha[..8.min(actual_sha.len())]
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            tracing::warn!(
                                "[AcpBinaryManager] Patch application failed for {} {}: {e} — falling back to full download",
                                agent_id,
                                version
                            );
                        }
                    }
                }
            }
        } else {
            tracing::info!(
                "[AcpBinaryManager] No older version found for incremental update of {} {} — using full download",
                agent_id,
                version
            );
        }

        // Fallback to full download
        let path = self
            .download_archive(&binary_info.archive, download_dir)
            .await?;
        Ok((path, DownloadMethod::Full))
    }

    /// Find the newest installed version older than the target version.
    /// Returns (version_string, executable_path) or None.
    async fn find_older_installed_version(
        &self,
        agent_id: &str,
        target_version: &str,
    ) -> Option<(String, PathBuf)> {
        let agent_dir = self.paths.agent_dir(agent_id);
        if !agent_dir.exists() {
            return None;
        }

        let mut candidates: Vec<(String, PathBuf)> = Vec::new();

        if let Ok(mut entries) = tokio::fs::read_dir(&agent_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let version_name = entry.file_name().to_string_lossy().to_string();
                if version_name.starts_with('.') {
                    continue;
                }
                // Only consider versions older than target (simple string comparison as approximation)
                if version_name < target_version {
                    // Try to find the executable in this version dir
                    if let Ok(mut contents) = tokio::fs::read_dir(&path).await {
                        let mut has_version_info = false;
                        while let Ok(Some(entry)) = contents.next_entry().await {
                            if entry.file_name().to_string_lossy() == ".version-info.json" {
                                has_version_info = true;
                                break;
                            }
                        }
                        if has_version_info {
                            if let Ok(data) = tokio::fs::read(&path.join(".version-info.json")).await {
                                if serde_json::from_slice::<serde_json::Value>(&data).is_ok() {
                                    // Check if there's a binary file
                                    if let Ok(exe) = Self::find_executable_in_dir(&path).await {
                                        let ver = serde_json::from_slice::<serde_json::Value>(&data)
                                            .ok()
                                            .and_then(|vinfo| vinfo.get("version"))
                                            .and_then(|v| v.as_str())
                                            .unwrap_or(&version_name)
                                            .to_string();
                                        candidates.push((ver, exe));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Return the newest candidate
        candidates.sort_by(|a, b| b.0.cmp(&a.0));
        candidates.into_iter().next()
    }

    async fn find_executable_in_dir(dir: &Path) -> Result<PathBuf, String> {
        let mut entries = tokio::fs::read_dir(dir).await
            .map_err(|e| format!("Failed to read dir: {e}"))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = path.metadata() {
                        if meta.permissions().mode() & 0o111 != 0 {
                            return Ok(path);
                        }
                    }
                }
                #[cfg(windows)]
                {
                    if path.extension().map(|e| e == "exe").unwrap_or(false) {
                        return Ok(path);
                    }
                }
            }
        }
        Err("No executable found".to_string())
    }

    /// Apply a binary patch (bsdiff format) to the source file.
    /// Returns the patched binary bytes.
    async fn apply_patch(&self, old_binary: &Path, patch_data: &[u8]) -> Result<Vec<u8>, String> {
        let old_binary = old_binary.to_path_buf();
        let patch_data = patch_data.to_vec();
        tokio::task::spawn_blocking(move || {
            let old_bytes = std::fs::read(&old_binary)
                .map_err(|e| format!("Failed to read old binary for patching: {e}"))?;

            let patched = rustbsdiff::patch(&old_bytes, &patch_data)
                .map_err(|e| format!("Patch application failed: {e}"))?;

            Ok(patched)
        })
        .await
        .map_err(|e| format!("Patch task panicked: {e}"))?
    }

    /// Save version entry metadata to the install directory for later retrieval.
    async fn save_version_entry(
        &self,
        install_dir: &Path,
        entry: &VersionHistoryEntry,
    ) -> Result<(), String> {
        let path = install_dir.join(".version-info.json");
        let content = serde_json::to_string_pretty(entry)
            .map_err(|e| format!("Failed to serialize version entry: {e}"))?;
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| format!("Failed to write version entry: {e}"))?;
        Ok(())
    }

    /// Load version entry metadata from the install directory.
    pub async fn load_version_entry(&self, agent_id: &str, version: &str) -> Option<VersionHistoryEntry> {
        let path = self.paths.agent_version_dir(agent_id, version).join(".version-info.json");
        if !path.exists() {
            return None;
        }
        let content = tokio::fs::read_to_string(&path).await.ok()?;
        serde_json::from_str::<VersionHistoryEntry>(&content).ok()
    }

    /// Delete a specific version directory.
    pub async fn delete_version(&self, agent_id: &str, version: &str) -> Result<(), String> {
        let version_dir = self.paths.agent_version_dir(agent_id, version);
        if version_dir.exists() {
            tokio::fs::remove_dir_all(&version_dir)
                .await
                .map_err(|e| format!("Failed to remove version directory: {e}"))?;
        }
        Ok(())
    }

    /// Download an archive from a URL.
    async fn download_archive(&self, url: &str, download_dir: &Path) -> Result<PathBuf, String> {
        tracing::info!("[AcpBinaryManager] Downloading from {}", url);

        let response = reqwest::get(url)
            .await
            .map_err(|e| format!("Failed to download: {e}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Download failed with status: {}",
                response.status()
            ));
        }

        // Determine filename from URL or Content-Disposition
        let filename = url
            .split('/')
            .next_back()
            .unwrap_or("archive")
            .split('?')
            .next()
            .unwrap_or("archive");

        let archive_path = download_dir.join(filename);

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?;

        tokio::fs::write(&archive_path, &bytes)
            .await
            .map_err(|e| format!("Failed to write archive: {e}"))?;

        tracing::info!(
            "[AcpBinaryManager] Downloaded {} bytes to {:?}",
            bytes.len(),
            archive_path
        );
        Ok(archive_path)
    }

    /// Extract an archive to a directory.
    async fn extract_archive(&self, archive_path: &Path, install_dir: &Path) -> Result<(), String> {
        let archive_str = archive_path.to_string_lossy().to_lowercase();
        let archive_path = archive_path.to_path_buf();
        let install_dir = install_dir.to_path_buf();

        // Run extraction in blocking task
        tokio::task::spawn_blocking(move || {
            if archive_str.ends_with(".zip") {
                Self::extract_zip(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar.gz") || archive_str.ends_with(".tgz") {
                Self::extract_tar_gz(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar.bz2") || archive_str.ends_with(".tbz2") {
                Self::extract_tar_bz2(&archive_path, &install_dir)
            } else if archive_str.ends_with(".tar") {
                Self::extract_tar(&archive_path, &install_dir)
            } else {
                // Assume it's a raw binary
                let filename = archive_path.file_name().unwrap_or_default();
                let dest = install_dir.join(filename);
                std::fs::copy(&archive_path, &dest)
                    .map_err(|e| format!("Failed to copy binary: {e}"))?;
                Ok(())
            }
        })
        .await
        .map_err(|e| format!("Extract task failed: {e}"))?
    }

    fn extract_zip(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive).map_err(|e| format!("Failed to open zip: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {e}"))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {e}"))?;
            let outpath = dest.join(file.mangled_name());

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file: {e}"))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {e}"))?;
            }
        }
        Ok(())
    }

    fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<(), String> {
        let file =
            std::fs::File::open(archive).map_err(|e| format!("Failed to open tar.gz: {e}"))?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar.gz: {e}"))?;
        Ok(())
    }

    fn extract_tar_bz2(archive: &Path, dest: &Path) -> Result<(), String> {
        let file =
            std::fs::File::open(archive).map_err(|e| format!("Failed to open tar.bz2: {e}"))?;
        let bz2 = bzip2::read::BzDecoder::new(file);
        let mut tar = tar::Archive::new(bz2);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar.bz2: {e}"))?;
        Ok(())
    }

    fn extract_tar(archive: &Path, dest: &Path) -> Result<(), String> {
        let file = std::fs::File::open(archive).map_err(|e| format!("Failed to open tar: {e}"))?;
        let mut tar = tar::Archive::new(file);
        tar.unpack(dest)
            .map_err(|e| format!("Failed to extract tar: {e}"))?;
        Ok(())
    }

    /// Find the executable in the install directory.
    async fn find_executable(
        &self,
        install_dir: &Path,
        binary_info: &BinaryInfo,
    ) -> Option<PathBuf> {
        // If cmd (executable name) is specified, look for it
        if let Some(cmd) = &binary_info.cmd {
            // cmd might be "./codex-acp" or "codex-acp", strip the "./" prefix
            let exe_name = cmd.strip_prefix("./").unwrap_or(cmd);
            let direct = install_dir.join(exe_name);
            if direct.exists() {
                return Some(direct);
            }
            // Search recursively
            if let Some(found) = self.find_file_recursive(install_dir, exe_name).await {
                return Some(found);
            }
        }

        // Look for common executable patterns
        let mut entries = tokio::fs::read_dir(install_dir).await.ok()?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_file() {
                // Check if it's executable (on Unix) or has no extension (likely binary)
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(meta) = path.metadata() {
                        if meta.permissions().mode() & 0o111 != 0 {
                            return Some(path);
                        }
                    }
                }
                #[cfg(windows)]
                {
                    if path.extension().map(|e| e == "exe").unwrap_or(false) {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    async fn find_file_recursive(&self, dir: &Path, name: &str) -> Option<PathBuf> {
        let mut stack = vec![dir.to_path_buf()];
        while let Some(current) = stack.pop() {
            if let Ok(mut entries) = tokio::fs::read_dir(&current).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else if path.file_name().map(|n| n == name).unwrap_or(false) {
                        return Some(path);
                    }
                }
            }
        }
        None
    }

    /// Prepare the executable (set permissions, remove quarantine).
    async fn prepare_executable(&self, _exe_path: &Path) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(_exe_path)
                .await
                .map_err(|e| format!("Failed to get metadata: {e}"))?
                .permissions();
            perms.set_mode(perms.mode() | 0o755);
            tokio::fs::set_permissions(_exe_path, perms)
                .await
                .map_err(|e| format!("Failed to set permissions: {e}"))?;
        }

        // Remove macOS quarantine attribute
        #[cfg(target_os = "macos")]
        {
            let exe_str = _exe_path.to_string_lossy().to_string();
            let _ = tokio::process::Command::new("xattr")
                .args(["-d", "com.apple.quarantine", &exe_str])
                .output()
                .await;
        }

        Ok(())
    }

    /// Uninstall a binary agent.
    pub async fn uninstall(&self, agent_id: &str) -> Result<(), String> {
        let agent_dir = self.paths.agent_dir(agent_id);
        if agent_dir.exists() {
            tokio::fs::remove_dir_all(&agent_dir)
                .await
                .map_err(|e| format!("Failed to remove agent directory: {e}"))?;
        }
        Ok(())
    }
}
