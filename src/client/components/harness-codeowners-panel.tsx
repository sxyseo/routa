"use client";

import { HarnessSectionCard, HarnessSectionStateFrame } from "@/client/components/harness-section-card";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { CodeownersResponse } from "@/core/harness/codeowners-types";

type HarnessCodeownersPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: CodeownersResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "neutral" | "amber" | "rose";
}) {
  const border =
    tone === "rose"
      ? "border-rose-200 bg-rose-50/60"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50/60"
        : "border-desktop-border bg-desktop-bg-primary/80";
  if (items.length === 0) {
    return null;
  }
  return (
    <div className={`rounded-xl border px-3 py-2 ${border}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">{title}</div>
      <ul className="mt-1.5 max-h-40 list-inside list-disc space-y-0.5 overflow-y-auto font-mono text-[11px] text-desktop-text-primary">
        {items.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
    </div>
  );
}

export function HarnessCodeownersPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading = false,
  error = null,
  variant = "full",
}: HarnessCodeownersPanelProps) {
  const compactMode = variant === "compact";

  return (
    <HarnessSectionCard
      title="CODEOWNERS"
      description={
        compactMode
          ? "GitHub ownership rules for review routing."
          : "Parse `.github/CODEOWNERS`, resolve owner groups, and surface unowned or overlapping paths next to review triggers."
      }
      variant={variant}
    >
      {loading ? (
        <HarnessSectionStateFrame tone="warning">Loading CODEOWNERS...</HarnessSectionStateFrame>
      ) : null}

      {unsupportedMessage ? (
        <HarnessUnsupportedState className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-[11px] text-amber-800" />
      ) : null}

      {error && !unsupportedMessage ? (
        <HarnessSectionStateFrame tone="error">{error}</HarnessSectionStateFrame>
      ) : null}

      {!loading && !error && !unsupportedMessage && data ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-desktop-text-secondary">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 font-mono text-[10px]">
              {repoLabel}
            </span>
            {data.codeownersFile ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
                {data.codeownersFile}
              </span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                Missing file
              </span>
            )}
            <span className="text-desktop-text-secondary/80">
              {data.rules.length} rule{data.rules.length === 1 ? "" : "s"}
            </span>
          </div>

          {data.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
              <div className="font-semibold">Warnings</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {data.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {data.owners.length > 0 ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-desktop-text-secondary">Owner groups</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.owners.map((o) => (
                  <span
                    key={o.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[11px]"
                  >
                    <span className="font-medium text-desktop-text-primary">{o.name}</span>
                    <span className="rounded bg-desktop-bg-secondary px-1.5 py-0.5 text-[10px] text-desktop-text-secondary">{o.kind}</span>
                    <span className="text-[10px] text-desktop-text-secondary">{o.matchedFileCount} files</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.rules.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-desktop-border">
              <table className="w-full min-w-[480px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-desktop-border bg-desktop-bg-secondary/60">
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Pattern</th>
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Owners</th>
                    <th className="px-3 py-2 font-semibold text-desktop-text-secondary">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((rule) => (
                    <tr key={`${rule.line}-${rule.pattern}`} className="border-b border-desktop-border/80">
                      <td className="px-3 py-2 font-mono text-desktop-text-primary">{rule.pattern}</td>
                      <td className="px-3 py-2 text-desktop-text-primary">{rule.owners.join(", ")}</td>
                      <td className="px-3 py-2 text-desktop-text-secondary">{rule.line}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <ListBlock title="Unowned files (sample)" items={data.coverage.unownedFiles} tone="amber" />
            <ListBlock title="Overlapping matches (sample)" items={data.coverage.overlappingFiles} tone="neutral" />
          </div>
          <ListBlock
            title="Sensitive paths without ownership"
            items={data.coverage.sensitiveUnownedFiles}
            tone="rose"
          />
        </div>
      ) : null}
    </HarnessSectionCard>
  );
}
