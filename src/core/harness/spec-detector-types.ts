export type SpecSourceKind = "native-tool" | "framework" | "tool-integration" | "legacy";

export type SpecSystem = "kiro" | "qoder" | "openspec" | "spec-kit" | "bmad";

export type SpecConfidence = "high" | "medium" | "low";

export type SpecStatus = "artifacts-present" | "installed-only" | "archived" | "legacy";

export type SpecArtifactType =
  | "requirements"
  | "bugfix"
  | "design"
  | "tasks"
  | "proposal"
  | "plan"
  | "contract"
  | "data-model"
  | "research"
  | "quickstart"
  | "epic"
  | "story"
  | "context"
  | "prd"
  | "architecture"
  | "config"
  | "other";

export type SpecArtifact = {
  type: SpecArtifactType;
  path: string;
};

export type SpecSource = {
  kind: SpecSourceKind;
  system: SpecSystem;
  rootPath: string;
  confidence: SpecConfidence;
  status: SpecStatus;
  evidence: string[];
  children: SpecArtifact[];
};

export type SpecDetectionResponse = {
  generatedAt: string;
  repoRoot: string;
  sources: SpecSource[];
  warnings: string[];
};
