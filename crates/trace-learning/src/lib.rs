pub mod analyzer;
pub mod catalog;
pub mod codex;
pub mod error;
pub mod model;
pub mod provider;
pub mod transcript_discovery;

pub use analyzer::{SessionAnalysis, SessionAnalyzer};
pub use catalog::{
    FeatureSurface, FeatureSurfaceCatalog, FeatureSurfaceKind, FeatureSurfaceLink,
    SurfaceLinkConfidence,
};
pub use codex::CodexSessionAdapter;
pub use error::TraceLearningError;
pub use model::{
    FileEvidenceKind, FileOperationKind, NormalizedFileEvent, NormalizedPrompt, NormalizedSession,
    NormalizedToolCall, PromptRole, ProviderKey, SessionSourceRef, ToolCallStatus,
};
pub use provider::{AdapterRegistry, SessionAdapter};
pub use transcript_discovery::{
    discover_transcript_session_roots, discover_transcript_session_roots_with_overrides,
    TranscriptSessionRoot, TranscriptSessionSource,
};
