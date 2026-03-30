import * as fs from "fs";
import * as path from "path";
import type {
  SpecArtifact,
  SpecArtifactType,
  SpecConfidence,
  SpecDetectionResponse,
  SpecSource,
  SpecStatus,
} from "./spec-detector-types";

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listDirs(parent: string): string[] {
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listFiles(parent: string): string[] {
  try {
    return fs.readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function relPath(repoRoot: string, absPath: string): string {
  return path.relative(repoRoot, absPath);
}

function inferArtifactType(fileName: string): SpecArtifactType {
  const lower = fileName.toLowerCase().replace(/\.md$/, "");
  const mapping: Record<string, SpecArtifactType> = {
    requirements: "requirements",
    bugfix: "bugfix",
    design: "design",
    tasks: "tasks",
    proposal: "proposal",
    plan: "plan",
    spec: "requirements",
    "data-model": "data-model",
    research: "research",
    quickstart: "quickstart",
    prd: "prd",
    architecture: "architecture",
    config: "config",
    "project-context": "context",
  };
  return mapping[lower] ?? "other";
}

// ----- Kiro -----

function detectKiro(repoRoot: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const kiroSpecsDir = path.join(repoRoot, ".kiro", "specs");
  const kiroRoot = path.join(repoRoot, ".kiro");

  if (dirExists(kiroSpecsDir)) {
    const features = listDirs(kiroSpecsDir);
    const artifacts: SpecArtifact[] = [];
    const evidence: string[] = [];

    for (const feature of features) {
      const featureDir = path.join(kiroSpecsDir, feature);
      const files = listFiles(featureDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          artifacts.push({
            type: inferArtifactType(file),
            path: relPath(repoRoot, path.join(featureDir, file)),
          });
        }
      }
      if (files.length > 0) {
        evidence.push(`.kiro/specs/${feature}/ (${files.length} files)`);
      }
    }

    if (artifacts.length > 0) {
      sources.push({
        kind: "native-tool",
        system: "kiro",
        rootPath: relPath(repoRoot, kiroSpecsDir),
        confidence: "high",
        status: "artifacts-present",
        evidence,
        children: artifacts,
      });
    } else {
      sources.push({
        kind: "native-tool",
        system: "kiro",
        rootPath: relPath(repoRoot, kiroSpecsDir),
        confidence: "medium",
        status: "installed-only",
        evidence: [".kiro/specs/ exists but no feature artifacts found"],
        children: [],
      });
    }
  }

  // Kiro integration dirs (prompts, skills, steering, agents)
  const integrationDirs = ["prompts", "skills", "steering", "agents"];
  const foundIntegrations: string[] = [];
  for (const dir of integrationDirs) {
    if (dirExists(path.join(kiroRoot, dir))) {
      foundIntegrations.push(`.kiro/${dir}/`);
    }
  }

  if (foundIntegrations.length > 0 && !sources.some((s) => s.system === "kiro" && s.status === "artifacts-present")) {
    if (sources.length === 0) {
      sources.push({
        kind: "tool-integration",
        system: "kiro",
        rootPath: relPath(repoRoot, kiroRoot),
        confidence: "low",
        status: "installed-only",
        evidence: foundIntegrations,
        children: [],
      });
    }
  }

  return sources;
}

// ----- Qoder -----

function detectQoder(repoRoot: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const qoderRoot = path.join(repoRoot, ".qoder");

  if (!dirExists(qoderRoot)) return sources;

  const integrationDirs = ["commands", "skills", "rules"];
  const foundIntegrations: string[] = [];
  for (const dir of integrationDirs) {
    if (dirExists(path.join(qoderRoot, dir))) {
      foundIntegrations.push(`.qoder/${dir}/`);
    }
  }

  if (foundIntegrations.length > 0) {
    sources.push({
      kind: "tool-integration",
      system: "qoder",
      rootPath: relPath(repoRoot, qoderRoot),
      confidence: "low",
      status: "installed-only",
      evidence: foundIntegrations,
      children: [],
    });
  }

  return sources;
}

// ----- OpenSpec -----

function detectOpenSpec(repoRoot: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const openspecRoot = path.join(repoRoot, "openspec");

  if (!dirExists(openspecRoot)) return sources;

  const evidence: string[] = [];
  const artifacts: SpecArtifact[] = [];

  // config.yaml => medium confidence
  if (fileExists(path.join(openspecRoot, "config.yaml"))) {
    evidence.push("openspec/config.yaml");
    artifacts.push({ type: "config", path: "openspec/config.yaml" });
  }

  // specs/<domain>/spec.md
  const specsDir = path.join(openspecRoot, "specs");
  if (dirExists(specsDir)) {
    for (const domain of listDirs(specsDir)) {
      const domainDir = path.join(specsDir, domain);
      for (const file of listFiles(domainDir)) {
        if (file.endsWith(".md")) {
          artifacts.push({
            type: inferArtifactType(file),
            path: relPath(repoRoot, path.join(domainDir, file)),
          });
        }
      }
      evidence.push(`openspec/specs/${domain}/`);
    }
  }

  // changes/<change>/(proposal.md|design.md|tasks.md)
  const changesDir = path.join(openspecRoot, "changes");
  if (dirExists(changesDir)) {
    for (const change of listDirs(changesDir)) {
      if (change === "archive") {
        evidence.push("openspec/changes/archive/ (archived)");
        continue;
      }
      const changeDir = path.join(changesDir, change);
      const files = listFiles(changeDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          artifacts.push({
            type: inferArtifactType(file),
            path: relPath(repoRoot, path.join(changeDir, file)),
          });
        }
      }
      // Also check for nested specs inside a change
      const changeSpecsDir = path.join(changeDir, "specs");
      if (dirExists(changeSpecsDir)) {
        for (const domain of listDirs(changeSpecsDir)) {
          for (const file of listFiles(path.join(changeSpecsDir, domain))) {
            if (file.endsWith(".md")) {
              artifacts.push({
                type: inferArtifactType(file),
                path: relPath(repoRoot, path.join(changeSpecsDir, domain, file)),
              });
            }
          }
        }
      }
      evidence.push(`openspec/changes/${change}/`);
    }
  }

  const hasHighEvidence = artifacts.some((a) => a.type !== "config");
  const confidence: SpecConfidence = hasHighEvidence ? "high" : "medium";
  const status: SpecStatus = hasHighEvidence ? "artifacts-present" : "installed-only";

  sources.push({
    kind: "framework",
    system: "openspec",
    rootPath: relPath(repoRoot, openspecRoot),
    confidence,
    status,
    evidence,
    children: artifacts,
  });

  return sources;
}

// ----- Spec Kit -----

function detectSpecKit(repoRoot: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const specifyRoot = path.join(repoRoot, ".specify");
  const specsRoot = path.join(repoRoot, "specs");

  let hasFramework = false;
  const evidence: string[] = [];
  const artifacts: SpecArtifact[] = [];

  // .specify/ => framework root
  if (dirExists(specifyRoot)) {
    hasFramework = true;
    if (fileExists(path.join(specifyRoot, "memory", "constitution.md"))) {
      evidence.push(".specify/memory/constitution.md");
      artifacts.push({ type: "context", path: ".specify/memory/constitution.md" });
    }
    for (const dir of ["templates", "presets", "extensions"]) {
      if (dirExists(path.join(specifyRoot, dir))) {
        evidence.push(`.specify/${dir}/`);
      }
    }

    // .specify/specs/<feature>/
    const specifySpecsDir = path.join(specifyRoot, "specs");
    if (dirExists(specifySpecsDir)) {
      for (const feature of listDirs(specifySpecsDir)) {
        const featureDir = path.join(specifySpecsDir, feature);
        for (const file of listFiles(featureDir)) {
          if (file.endsWith(".md")) {
            artifacts.push({
              type: inferArtifactType(file),
              path: relPath(repoRoot, path.join(featureDir, file)),
            });
          }
        }
        evidence.push(`.specify/specs/${feature}/`);
      }
    }
  }

  // specs/<feature>/ (compat path for Spec Kit)
  if (dirExists(specsRoot)) {
    for (const feature of listDirs(specsRoot)) {
      const featureDir = path.join(specsRoot, feature);
      const files = listFiles(featureDir);
      const specKitFiles = files.filter((f) =>
        /^(spec|plan|tasks|data-model|research|quickstart)\.md$/i.test(f)
        || f === "contracts",
      );
      if (specKitFiles.length > 0 || dirExists(path.join(featureDir, "contracts"))) {
        for (const file of files) {
          if (file.endsWith(".md")) {
            artifacts.push({
              type: inferArtifactType(file),
              path: relPath(repoRoot, path.join(featureDir, file)),
            });
          }
        }
        evidence.push(`specs/${feature}/`);
        hasFramework = true;
      }
    }
  }

  if (hasFramework || artifacts.length > 0) {
    const hasArtifacts = artifacts.some((a) => a.type !== "context" && a.type !== "config");
    sources.push({
      kind: "framework",
      system: "spec-kit",
      rootPath: dirExists(specifyRoot) ? relPath(repoRoot, specifyRoot) : "specs",
      confidence: hasArtifacts ? "high" : "medium",
      status: hasArtifacts ? "artifacts-present" : "installed-only",
      evidence,
      children: artifacts,
    });
  }

  return sources;
}

// ----- BMAD -----

function detectBmad(repoRoot: string): SpecSource[] {
  const sources: SpecSource[] = [];
  const bmadRoot = path.join(repoRoot, "_bmad");
  const bmadOutput = path.join(repoRoot, "_bmad-output");

  // BMAD v6
  if (dirExists(bmadRoot) || dirExists(bmadOutput)) {
    const evidence: string[] = [];
    const artifacts: SpecArtifact[] = [];

    if (dirExists(bmadRoot)) {
      evidence.push("_bmad/");
      for (const dir of ["_config", "core", "bmm"]) {
        if (dirExists(path.join(bmadRoot, dir))) {
          evidence.push(`_bmad/${dir}/`);
        }
      }
    }

    if (dirExists(bmadOutput)) {
      evidence.push("_bmad-output/");
      const planningDir = path.join(bmadOutput, "planning-artifacts");
      if (dirExists(planningDir)) {
        for (const file of listFiles(planningDir)) {
          if (file.endsWith(".md")) {
            artifacts.push({
              type: inferArtifactType(file),
              path: relPath(repoRoot, path.join(planningDir, file)),
            });
          }
        }
        if (dirExists(path.join(planningDir, "epics"))) {
          for (const file of listFiles(path.join(planningDir, "epics"))) {
            if (file.endsWith(".md")) {
              artifacts.push({
                type: "epic",
                path: relPath(repoRoot, path.join(planningDir, "epics", file)),
              });
            }
          }
          evidence.push("_bmad-output/planning-artifacts/epics/");
        }
      }

      if (fileExists(path.join(bmadOutput, "project-context.md"))) {
        artifacts.push({ type: "context", path: "_bmad-output/project-context.md" });
        evidence.push("_bmad-output/project-context.md");
      }

      const implDir = path.join(bmadOutput, "implementation-artifacts");
      if (dirExists(implDir)) {
        evidence.push("_bmad-output/implementation-artifacts/");
      }
    }

    const hasHighEvidence = artifacts.length > 0;
    sources.push({
      kind: "framework",
      system: "bmad",
      rootPath: dirExists(bmadOutput) ? "_bmad-output" : "_bmad",
      confidence: hasHighEvidence ? "high" : "medium",
      status: hasHighEvidence ? "artifacts-present" : "installed-only",
      evidence,
      children: artifacts,
    });
  }

  // BMAD legacy/brownfield (docs/ patterns)
  if (!dirExists(bmadRoot) && !dirExists(bmadOutput)) {
    const docsDir = path.join(repoRoot, "docs");
    if (dirExists(docsDir)) {
      const evidence: string[] = [];
      const artifacts: SpecArtifact[] = [];

      const legacyFiles: Array<{ name: string; type: SpecArtifactType }> = [
        { name: "prd.md", type: "prd" },
        { name: "PRD.md", type: "prd" },
        { name: "architecture.md", type: "architecture" },
        { name: "brownfield-architecture.md", type: "architecture" },
      ];

      for (const { name, type } of legacyFiles) {
        if (fileExists(path.join(docsDir, name))) {
          artifacts.push({ type, path: `docs/${name}` });
          evidence.push(`docs/${name}`);
        }
      }

      for (const dirName of ["prd", "PRD"]) {
        if (dirExists(path.join(docsDir, dirName))) {
          for (const file of listFiles(path.join(docsDir, dirName))) {
            if (file.endsWith(".md")) {
              artifacts.push({
                type: "prd",
                path: `docs/${dirName}/${file}`,
              });
            }
          }
          evidence.push(`docs/${dirName}/`);
        }
      }

      // Only include BMAD tools integration evidence
      const bmadToolDirs = [
        { base: ".claude/skills", prefix: "bmad-" },
        { base: ".cursor/skills", prefix: "bmad-" },
        { base: ".windsurf/skills", prefix: "bmad-" },
      ];

      let hasBmadToolIntegration = false;
      for (const { base, prefix } of bmadToolDirs) {
        const dir = path.join(repoRoot, base);
        if (dirExists(dir)) {
          const entries = listDirs(dir).filter((d) => d.startsWith(prefix));
          if (entries.length > 0) {
            hasBmadToolIntegration = true;
            evidence.push(`${base}/${entries[0]}/`);
          }
        }
      }

      if (artifacts.length > 0 && hasBmadToolIntegration) {
        sources.push({
          kind: "legacy",
          system: "bmad",
          rootPath: "docs",
          confidence: "low",
          status: "legacy",
          evidence,
          children: artifacts,
        });
      }
    }
  }

  return sources;
}

/** Scan a repository root and return all detected spec sources. */
export function detectSpecSources(repoRoot: string): SpecDetectionResponse {
  const warnings: string[] = [];
  const sources: SpecSource[] = [];

  // Phase 1: Framework & native tool detection
  try { sources.push(...detectKiro(repoRoot)); } catch (e) { warnings.push(`Kiro detection failed: ${e}`); }
  try { sources.push(...detectQoder(repoRoot)); } catch (e) { warnings.push(`Qoder detection failed: ${e}`); }
  try { sources.push(...detectOpenSpec(repoRoot)); } catch (e) { warnings.push(`OpenSpec detection failed: ${e}`); }
  try { sources.push(...detectSpecKit(repoRoot)); } catch (e) { warnings.push(`Spec Kit detection failed: ${e}`); }
  try { sources.push(...detectBmad(repoRoot)); } catch (e) { warnings.push(`BMAD detection failed: ${e}`); }

  // Phase 3: Cross-tool integration detection
  try { sources.push(...detectToolIntegrations(repoRoot, sources)); } catch (e) { warnings.push(`Tool integration detection failed: ${e}`); }

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    sources,
    warnings,
  };
}

// ----- Cross-tool integration detection -----

function detectToolIntegrations(repoRoot: string, existingSources: SpecSource[]): SpecSource[] {
  const sources: SpecSource[] = [];
  const alreadyDetectedSystems = new Set(existingSources.map((s) => s.system));

  // Check for OpenSpec integrations across tools
  if (!alreadyDetectedSystems.has("openspec")) {
    const openspecIntegrations: string[] = [];
    const checks: Array<{ dir: string; prefix: string }> = [
      { dir: ".kiro/prompts", prefix: "opsx-" },
      { dir: ".kiro/skills", prefix: "openspec-" },
      { dir: ".qoder/commands/opsx", prefix: "" },
      { dir: ".qoder/skills", prefix: "openspec-" },
      { dir: ".claude/skills", prefix: "openspec-" },
      { dir: ".cursor/commands", prefix: "openspec-" },
      { dir: ".windsurf/workflows", prefix: "openspec-" },
    ];

    for (const { dir, prefix } of checks) {
      const fullDir = path.join(repoRoot, dir);
      if (!dirExists(fullDir)) continue;
      if (prefix) {
        const matches = (listDirs(fullDir).concat(listFiles(fullDir)))
          .filter((entry) => entry.startsWith(prefix));
        if (matches.length > 0) {
          openspecIntegrations.push(`${dir}/${matches[0]}`);
        }
      } else {
        // Directory itself is the match (e.g., .qoder/commands/opsx/)
        openspecIntegrations.push(`${dir}/`);
      }
    }

    if (openspecIntegrations.length > 0) {
      sources.push({
        kind: "tool-integration",
        system: "openspec",
        rootPath: openspecIntegrations[0],
        confidence: "low",
        status: "installed-only",
        evidence: openspecIntegrations,
        children: [],
      });
    }
  }

  // Check for Spec Kit integrations across tools
  if (!alreadyDetectedSystems.has("spec-kit")) {
    const specKitIntegrations: string[] = [];
    const toolDirs = [
      ".qoder/commands",
      ".kiro/prompts",
      ".claude/commands",
      ".cursor/commands",
      ".windsurf/workflows",
      ".github/agents",
      ".opencode/command",
      ".trae/rules",
    ];

    for (const dir of toolDirs) {
      const fullDir = path.join(repoRoot, dir);
      if (dirExists(fullDir)) {
        const entries = listFiles(fullDir).concat(listDirs(fullDir));
        const specKitMatches = entries.filter((e) =>
          /speckit|spec.kit|specify/i.test(e),
        );
        if (specKitMatches.length > 0) {
          specKitIntegrations.push(`${dir}/${specKitMatches[0]}`);
        }
      }
    }

    if (specKitIntegrations.length > 0) {
      sources.push({
        kind: "tool-integration",
        system: "spec-kit",
        rootPath: specKitIntegrations[0],
        confidence: "low",
        status: "installed-only",
        evidence: specKitIntegrations,
        children: [],
      });
    }
  }

  return sources;
}
