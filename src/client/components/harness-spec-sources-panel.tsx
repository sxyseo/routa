"use client";

import { useState } from "react";
import type {
  SpecConfidence,
  SpecDetectionResponse,
  SpecSource,
  SpecSourceKind,
  SpecStatus,
} from "@/core/harness/spec-detector-types";

type SpecSourcesPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: SpecDetectionResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

const KIND_LABELS: Record<SpecSourceKind, string> = {
  "native-tool": "Native Tool",
  framework: "Framework",
  "tool-integration": "Integration",
  legacy: "Legacy",
};

const STATUS_LABELS: Record<SpecStatus, string> = {
  "artifacts-present": "Has Artifacts",
  "installed-only": "Installed Only",
  archived: "Archived",
  legacy: "Legacy",
};

const CONFIDENCE_STYLES: Record<SpecConfidence, { bg: string; text: string }> = {
  high: { bg: "bg-emerald-100", text: "text-emerald-700" },
  medium: { bg: "bg-amber-100", text: "text-amber-700" },
  low: { bg: "bg-zinc-100", text: "text-zinc-500" },
};

const STATUS_STYLES: Record<SpecStatus, { bg: string; text: string; border: string }> = {
  "artifacts-present": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  "installed-only": { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  archived: { bg: "bg-zinc-50", text: "text-zinc-500", border: "border-zinc-200" },
  legacy: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
};

const KIND_STYLES: Record<SpecSourceKind, { bg: string; text: string }> = {
  "native-tool": { bg: "bg-violet-100", text: "text-violet-700" },
  framework: { bg: "bg-sky-100", text: "text-sky-700" },
  "tool-integration": { bg: "bg-zinc-100", text: "text-zinc-600" },
  legacy: { bg: "bg-amber-100", text: "text-amber-700" },
};

const SYSTEM_ICONS: Record<string, string> = {
  kiro: "K",
  qoder: "Q",
  openspec: "OS",
  "spec-kit": "SK",
  bmad: "B",
};

function groupSourcesByCategory(sources: SpecSource[]) {
  const nativeTools = sources.filter((s) => s.kind === "native-tool");
  const frameworks = sources.filter((s) => s.kind === "framework");
  const integrations = sources.filter((s) => s.kind === "tool-integration");
  const legacy = sources.filter((s) => s.kind === "legacy");
  return { nativeTools, frameworks, integrations, legacy };
}

function ConfidenceBadge({ confidence }: { confidence: SpecConfidence }) {
  const style = CONFIDENCE_STYLES[confidence];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.bg} ${style.text}`}>
      {confidence}
    </span>
  );
}

function StatusBadge({ status }: { status: SpecStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text} ${style.border}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function KindBadge({ kind }: { kind: SpecSourceKind }) {
  const style = KIND_STYLES[kind];
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${style.bg} ${style.text}`}>
      {KIND_LABELS[kind]}
    </span>
  );
}

function ArtifactTypeTag({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[9px] font-mono text-desktop-text-secondary">
      {type}
    </span>
  );
}

function SpecSourceCard({ source, expanded, onToggle }: { source: SpecSource; expanded: boolean; onToggle: () => void }) {
  const icon = SYSTEM_ICONS[source.system] ?? source.system.charAt(0).toUpperCase();
  const artifactCount = source.children.length;

  return (
    <div className={`rounded-xl border transition-colors ${
      expanded ? "border-desktop-accent bg-desktop-bg-primary" : "border-desktop-border bg-desktop-bg-primary/80 hover:bg-desktop-bg-primary"
    }`}>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
        onClick={onToggle}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-desktop-border bg-desktop-bg-secondary text-[11px] font-bold text-desktop-text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold capitalize text-desktop-text-primary">{source.system}</span>
            <KindBadge kind={source.kind} />
            <ConfidenceBadge confidence={source.confidence} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={source.status} />
            <span className="text-[10px] text-desktop-text-secondary">
              {source.rootPath}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {artifactCount > 0 && (
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {artifactCount} artifact{artifactCount !== 1 ? "s" : ""}
            </span>
          )}
          <svg
            className={`h-3.5 w-3.5 text-desktop-text-secondary transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-desktop-border px-3 py-2.5">
          {/* Evidence */}
          {source.evidence.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-desktop-text-secondary">Evidence</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {source.evidence.map((ev) => (
                  <span
                    key={ev}
                    className="inline-flex rounded border border-desktop-border bg-desktop-bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-desktop-text-secondary"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Artifacts */}
          {source.children.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold uppercase tracking-wider text-desktop-text-secondary">Artifacts</div>
              <div className="mt-1 space-y-0.5">
                {source.children.map((artifact) => (
                  <div key={artifact.path} className="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-desktop-bg-secondary/60">
                    <ArtifactTypeTag type={artifact.type} />
                    <span className="min-w-0 truncate font-mono text-desktop-text-primary">{artifact.path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {source.children.length === 0 && source.status === "installed-only" && (
            <div className="rounded-lg border border-sky-200 bg-sky-50/50 px-2.5 py-2 text-[10px] text-sky-700">
              {source.system === "qoder"
                ? "Qoder integration detected. No official native spec directory confirmed."
                : `${source.system} integration detected, but no spec artifacts found.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SourceGroup({ title, sources, expandedKey, onToggle }: {
  title: string;
  sources: SpecSource[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
}) {
  if (sources.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      <div className="space-y-1.5">
        {sources.map((source) => {
          const key = `${source.system}-${source.kind}-${source.rootPath}`;
          return (
            <SpecSourceCard
              key={key}
              source={source}
              expanded={expandedKey === key}
              onToggle={() => onToggle(expandedKey === key ? "" : key)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function HarnessSpecSourcesPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading,
  error,
  variant = "full",
}: SpecSourcesPanelProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const sources = data?.sources ?? [];
  const { nativeTools, frameworks, integrations, legacy } = groupSourcesByCategory(sources);

  const totalArtifacts = sources.reduce((sum, s) => sum + s.children.length, 0);
  const highConfidenceCount = sources.filter((s) => s.confidence === "high").length;

  const isCompact = variant === "compact";

  if (isCompact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
            Spec Sources
          </div>
          {loading ? (
            <span className="text-[10px] text-desktop-text-secondary">Loading...</span>
          ) : (
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
              {sources.length} source{sources.length !== 1 ? "s" : ""} · {totalArtifacts} artifact{totalArtifacts !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {error && !unsupportedMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>
        )}

        {!loading && !error && sources.length === 0 && (
          <div className="rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-2 text-[10px] text-desktop-text-secondary">
            No spec sources detected in this repository.
          </div>
        )}

        {sources.map((source) => {
          const key = `${source.system}-${source.kind}-${source.rootPath}`;
          return (
            <SpecSourceCard
              key={key}
              source={source}
              expanded={expandedKey === key}
              onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
            />
          );
        })}
      </div>
    );
  }

  // Full variant
  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
              Governance Loop
            </div>
            <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Spec Sources</h3>
            <p className="mt-0.5 text-[10px] text-desktop-text-secondary">
              Detected AI Coding spec tools, methodology frameworks, and tool integrations for <span className="font-medium text-desktop-text-primary">{repoLabel}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!loading && (
              <>
                <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                  {sources.length} source{sources.length !== 1 ? "s" : ""}
                </span>
                <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
                  {totalArtifacts} artifact{totalArtifacts !== 1 ? "s" : ""}
                </span>
                {highConfidenceCount > 0 && (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-700">
                    {highConfidenceCount} high confidence
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {loading && (
          <div className="mt-3 rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            Scanning for spec sources...
          </div>
        )}

        {unsupportedMessage && (
          <div className="mt-3">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-800">
              {unsupportedMessage}
            </div>
          </div>
        )}

        {error && !unsupportedMessage && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-[11px] text-red-700">{error}</div>
        )}

        {!loading && !error && !unsupportedMessage && sources.length === 0 && (
          <div className="mt-3 rounded-lg border border-desktop-border bg-desktop-bg-primary/80 px-3 py-3 text-[11px] text-desktop-text-secondary">
            No spec sources detected in this repository. Supported frameworks: Kiro, Qoder, OpenSpec, Spec Kit, BMAD.
          </div>
        )}

        {!loading && !unsupportedMessage && sources.length > 0 && (
          <div className="mt-3 space-y-3">
            <SourceGroup title="Native Tools" sources={nativeTools} expandedKey={expandedKey} onToggle={setExpandedKey} />
            <SourceGroup title="Frameworks" sources={frameworks} expandedKey={expandedKey} onToggle={setExpandedKey} />
            <SourceGroup title="Integrations" sources={integrations} expandedKey={expandedKey} onToggle={setExpandedKey} />
            <SourceGroup title="Legacy" sources={legacy} expandedKey={expandedKey} onToggle={setExpandedKey} />
          </div>
        )}

        {data?.warnings && data.warnings.length > 0 && (
          <div className="mt-3 space-y-1">
            {data.warnings.map((warning) => (
              <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700">
                {warning}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
