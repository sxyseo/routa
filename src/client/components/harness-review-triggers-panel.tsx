"use client";

import { useState } from "react";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { HooksResponse, ReviewTriggerRuleSummary } from "@/client/hooks/use-harness-settings-data";

type ReviewTriggersPanelProps = {
  repoLabel: string;
  unsupportedMessage?: string | null;
  data?: HooksResponse | null;
  loading?: boolean;
  error?: string | null;
  variant?: "full" | "compact";
};

type ReviewDimensionTone = "danger" | "warning" | "info" | "success";

type ReviewDimensionCard = {
  key: "risk" | "confidence" | "complexity" | "routing";
  title: string;
  value: string;
  subtitle: string;
  barLabel: string;
  barValue: number;
  tone: ReviewDimensionTone;
  tags: string[];
  rules: ReviewTriggerRuleSummary[];
  metaDetails: Array<{
    label: string;
    value: string;
  }>;
};

const RISK_RULE_NAMES = new Set([
  "high_risk_directory_change",
  "sensitive_contract_or_governance_change",
  "core_engine_change",
  "sensitive_release_files",
]);

const CONFIDENCE_RULE_NAMES = new Set([
  "fitness_evidence_gap_for_core_paths",
  "api_contract_evidence_gap",
  "code_without_evidence",
]);

const COMPLEXITY_RULE_TYPES = new Set([
  "cross_boundary_change",
  "directory_file_count",
  "diff_size",
]);

const TONE_STYLES: Record<ReviewDimensionTone, {
  pill: string;
  bar: string;
  border: string;
  surface: string;
  tag: string;
}> = {
  danger: {
    pill: "bg-rose-600 text-white",
    bar: "bg-rose-600",
    border: "border-rose-200",
    surface: "bg-rose-50/70",
    tag: "border-rose-200 bg-white text-rose-700",
  },
  warning: {
    pill: "bg-amber-500 text-white",
    bar: "bg-amber-500",
    border: "border-amber-200",
    surface: "bg-amber-50/80",
    tag: "border-amber-200 bg-white text-amber-800",
  },
  info: {
    pill: "bg-sky-600 text-white",
    bar: "bg-sky-600",
    border: "border-sky-200",
    surface: "bg-sky-50/75",
    tag: "border-sky-200 bg-white text-sky-700",
  },
  success: {
    pill: "bg-emerald-600 text-white",
    bar: "bg-emerald-600",
    border: "border-emerald-200",
    surface: "bg-emerald-50/80",
    tag: "border-emerald-200 bg-white text-emerald-700",
  },
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(value, max));
}

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(" ");
}

function scoreSeverity(severity: string): number {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function toneFromScore(score: number): ReviewDimensionTone {
  if (score >= 0.75) return "danger";
  if (score >= 0.45) return "warning";
  return "info";
}

function confidenceTone(score: number): ReviewDimensionTone {
  if (score >= 0.75) return "success";
  if (score >= 0.45) return "warning";
  return "danger";
}

function formatRuleLabel(ruleName: string): string {
  return formatTokenLabel(ruleName);
}

function formatRuleList(ruleNames: string[], emptyText: string): string {
  return ruleNames.length ? ruleNames.map(formatRuleLabel).join(", ") : emptyText;
}

function buildRuleBadges(rule: ReviewTriggerRuleSummary): string[] {
  return [
    formatTokenLabel(rule.type),
    rule.severity,
    formatTokenLabel(rule.action),
    rule.pathCount > 0 ? `${rule.pathCount} paths` : "",
    rule.evidencePathCount > 0 ? `${rule.evidencePathCount} evidence` : "",
    rule.boundaryCount > 0 ? `${rule.boundaryCount} boundaries` : "",
    rule.directoryCount > 0 ? `${rule.directoryCount} directories` : "",
  ].filter(Boolean);
}

function uniqueLabels(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function containerClass(compactMode: boolean): string {
  return compactMode
    ? "rounded-2xl border border-amber-200 bg-amber-50/60 p-3"
    : "rounded-2xl border border-amber-200 bg-amber-50/45 p-4 shadow-sm";
}

function cardGridClass(compactMode: boolean): string {
  return compactMode ? "mt-3 grid grid-cols-1 gap-3" : "mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4";
}

function isRiskRule(rule: ReviewTriggerRuleSummary): boolean {
  if (RISK_RULE_NAMES.has(rule.name)) {
    return true;
  }
  if (rule.type === "sensitive_file_change") {
    return true;
  }
  return rule.type === "changed_paths" && rule.severity === "high";
}

function isConfidenceRule(rule: ReviewTriggerRuleSummary): boolean {
  if (CONFIDENCE_RULE_NAMES.has(rule.name)) {
    return true;
  }
  return rule.type === "evidence_gap";
}

function isComplexityRule(rule: ReviewTriggerRuleSummary): boolean {
  if (isRiskRule(rule) || isConfidenceRule(rule)) {
    return false;
  }
  if (COMPLEXITY_RULE_TYPES.has(rule.type)) {
    return true;
  }
  return /boundary|oversized|diff|file_count/i.test(rule.name);
}

function buildReviewDimensionCards(
  rules: ReviewTriggerRuleSummary[],
  reviewProfiles: HooksResponse["profiles"],
  reviewHooks: string[],
): ReviewDimensionCard[] {
  const riskRules = rules.filter(isRiskRule);
  const confidenceRules = rules.filter(isConfidenceRule);
  const complexityRules = rules.filter(isComplexityRule);

  const riskScore = riskRules.length
    ? clamp(riskRules.reduce((sum, rule) => sum + scoreSeverity(rule.severity), 0) / (riskRules.length * 3))
    : 0;
  const riskTags = riskRules.length
    ? riskRules.map((rule) => formatRuleLabel(rule.name)).slice(0, 3)
    : ["No dedicated risk policy"];

  const evidencePathCount = confidenceRules.reduce((sum, rule) => sum + rule.evidencePathCount, 0);
  const confidenceScore = confidenceRules.length
    ? clamp((confidenceRules.length * 2 + Math.min(evidencePathCount, 8)) / 10)
    : 0;
  const confidenceTags = confidenceRules.length
    ? confidenceRules.map((rule) => formatRuleLabel(rule.name)).slice(0, 3)
    : ["No evidence-gap policy"];

  const complexityBoundaryCount = complexityRules.reduce((sum, rule) => sum + rule.boundaryCount, 0);
  const complexityDirectoryCount = complexityRules.reduce((sum, rule) => sum + rule.directoryCount, 0);
  const complexityScore = complexityRules.length
    ? clamp(
      (
        complexityRules.reduce((sum, rule) => sum + scoreSeverity(rule.severity), 0) +
        complexityBoundaryCount +
        complexityDirectoryCount
      ) / Math.max(complexityRules.length * 3 + 2, 5),
    )
    : 0;
  const complexityTags = uniqueLabels([
    ...complexityRules.map((rule) => formatRuleLabel(rule.name)).slice(0, 2),
    complexityBoundaryCount > 0 ? `${complexityBoundaryCount} boundaries` : "",
    complexityDirectoryCount > 0 ? `${complexityDirectoryCount} directories` : "",
  ]);

  const actionLabels = uniqueLabels(rules.map((rule) => formatTokenLabel(rule.action)));
  const profileLabels = uniqueLabels(reviewProfiles.map((profile) => formatTokenLabel(profile.name)));
  const hookLabels = uniqueLabels(reviewHooks.map((hook) => formatTokenLabel(hook)));
  const routingReady = actionLabels.length > 0 && profileLabels.length > 0;
  const routingTone: ReviewDimensionTone = routingReady ? "success" : "warning";
  const routingTags = uniqueLabels([
    ...profileLabels.slice(0, 2),
    ...hookLabels.slice(0, 1),
    ...actionLabels.slice(0, 1),
  ]);
  const routingScore = clamp(
    (actionLabels.length > 0 ? 0.4 : 0) +
      (profileLabels.length > 0 ? 0.35 : 0) +
      Math.min(hookLabels.length, 2) * 0.125,
  );

  return [
    {
      key: "risk",
      title: "Risk",
      value: riskRules.length ? `${riskRules.length} rules` : "No risk gates",
      subtitle: riskRules.length
        ? "核心目录、治理文件和敏感契约的变更会优先升级人工评审。"
        : "当前没有针对高影响面目录或契约的专门升级规则。",
      barLabel: "Impact and blast radius",
      barValue: riskScore,
      tone: toneFromScore(riskScore),
      tags: riskTags,
      rules: riskRules,
      metaDetails: [
        { label: "Rules", value: formatRuleList(riskRules.map((rule) => rule.name), "No dedicated risk policy") },
        { label: "Severity", value: `${riskRules.filter((rule) => rule.severity === "high").length} high / ${riskRules.filter((rule) => rule.severity === "medium").length} medium` },
        { label: "Path scope", value: `${riskRules.reduce((sum, rule) => sum + rule.pathCount, 0)} guarded paths` },
      ],
    },
    {
      key: "confidence",
      title: "Confidence",
      value: confidenceRules.length ? `${evidencePathCount} evidence paths` : "No evidence gates",
      subtitle: confidenceRules.length
        ? "证据缺口会触发 review，避免核心改动在缺少 fitness 或 contract 佐证时直接流过。"
        : "当前没有把证据不足单独建模为 review trigger。",
      barLabel: "Evidence coverage",
      barValue: confidenceScore,
      tone: confidenceTone(confidenceScore),
      tags: confidenceTags,
      rules: confidenceRules,
      metaDetails: [
        { label: "Rules", value: formatRuleList(confidenceRules.map((rule) => rule.name), "No evidence-gap policy") },
        { label: "Evidence", value: `${evidencePathCount} evidence paths` },
        { label: "Protected scope", value: `${confidenceRules.reduce((sum, rule) => sum + rule.pathCount, 0)} guarded paths` },
      ],
    },
    {
      key: "complexity",
      title: "Complexity",
      value: complexityRules.length ? `${complexityRules.length} guards` : "No load gates",
      subtitle: complexityRules.length
        ? "跨边界、目录膨胀和 diff 体量共同定义这次 review 的认知负荷。"
        : "当前没有针对跨边界或变更规模的独立复杂度门槛。",
      barLabel: "Cross-boundary and scale pressure",
      barValue: complexityScore,
      tone: toneFromScore(complexityScore),
      tags: complexityTags.length ? complexityTags : ["No complexity signal"],
      rules: complexityRules,
      metaDetails: [
        { label: "Rules", value: formatRuleList(complexityRules.map((rule) => rule.name), "No complexity signal") },
        { label: "Boundaries", value: `${complexityBoundaryCount} boundaries` },
        { label: "Directories", value: `${complexityDirectoryCount} directories` },
      ],
    },
    {
      key: "routing",
      title: "Routing",
      value: routingReady ? actionLabels[0] ?? "Review gate ready" : "Route incomplete",
      subtitle: routingReady
        ? "系统会把这些触发器收敛到 review phase，并路由到明确的人审动作。"
        : "规则存在，但 review phase 或动作绑定还不够完整。",
      barLabel: "Human review routing",
      barValue: routingScore,
      tone: routingTone,
      tags: routingTags.length ? routingTags : ["No review phase binding"],
      rules: [],
      metaDetails: [
        { label: "Action", value: actionLabels.join(", ") || "No review action" },
        { label: "Profiles", value: profileLabels.join(", ") || "No review profile" },
        { label: "Hooks", value: hookLabels.join(", ") || "No hook binding" },
      ],
    },
  ];
}

export function HarnessReviewTriggersPanel({
  repoLabel,
  unsupportedMessage,
  data,
  loading = false,
  error = null,
  variant = "full",
}: ReviewTriggersPanelProps) {
  const reviewTriggerFile = data?.reviewTriggerFile ?? null;
  const profiles = data?.profiles ?? [];
  const reviewProfiles = profiles.filter((profile) => profile.phases.includes("review"));
  const reviewHooks = uniqueLabels(reviewProfiles.flatMap((profile) => profile.hooks));
  const [expandedCardKey, setExpandedCardKey] = useState<ReviewDimensionCard["key"] | null>(null);
  const compactMode = variant === "compact";
  const cards = reviewTriggerFile
    ? buildReviewDimensionCards(reviewTriggerFile.rules, reviewProfiles, reviewHooks)
    : [];
  const highSeverityCount = reviewTriggerFile?.rules.filter((rule) => rule.severity === "high").length ?? 0;

  return (
    <section className={containerClass(compactMode)}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800">Review triggers</div>
        </div>

        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="rounded-full border border-amber-200 bg-white/90 px-2.5 py-1 text-amber-800">
            {repoLabel}
          </span>
          <span className="rounded-full border border-amber-200 bg-white/90 px-2.5 py-1 text-amber-800">
            {reviewTriggerFile?.ruleCount ?? 0} rules
          </span>
          <span className="rounded-full border border-amber-200 bg-white/90 px-2.5 py-1 text-amber-800">
            {highSeverityCount} high severity
          </span>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/90 px-4 py-4 text-[11px] text-amber-900/75">
          Loading review trigger policies...
        </div>
      ) : null}

      {unsupportedMessage ? <HarnessUnsupportedState /> : null}

      {error && !unsupportedMessage ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-[11px] text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && !error && !unsupportedMessage && !reviewTriggerFile ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/90 px-4 py-4 text-[11px] text-amber-900/75">
          No `docs/fitness/review-triggers.yaml` file was found for the selected repository.
        </div>
      ) : null}

      {!loading && !error && !unsupportedMessage && reviewTriggerFile && !reviewTriggerFile.rules.length ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-white/90 px-4 py-4 text-[11px] text-amber-900/75">
          The YAML file loaded successfully, but no `review_triggers` entries were parsed.
        </div>
      ) : null}

      {!loading && !error && !unsupportedMessage && reviewTriggerFile && reviewTriggerFile.rules.length ? (
        <div className={cardGridClass(compactMode)}>
          {cards.map((card) => {
            const styles = TONE_STYLES[card.tone];
            const expanded = expandedCardKey === card.key;
            return (
              <article
                key={card.key}
                className={`rounded-2xl border px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)] ${styles.border} ${styles.surface}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                      {card.key}
                    </div>
                    <h4 className="mt-0.5 text-[15px] font-semibold text-desktop-text-primary">{card.title}</h4>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${styles.pill}`}>
                    {card.value}
                  </span>
                </div>

                <p className="mt-2 min-h-[44px] text-[10px] leading-4 text-desktop-text-secondary">
                  {card.subtitle}
                </p>

                <div className="mt-3 text-[10px] font-medium text-desktop-text-secondary">
                  {card.barLabel}
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/85">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${styles.bar}`}
                    style={{ width: `${Math.max(8, card.barValue * 100)}%` }}
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {card.tags.map((tag) => (
                    <span
                      key={`${card.key}-${tag}`}
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${styles.tag}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setExpandedCardKey(expanded ? null : card.key)}
                    aria-expanded={expanded}
                    className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-desktop-text-secondary transition-colors hover:bg-white"
                  >
                    <span>{expanded ? "Hide details" : "Show details"}</span>
                    <span className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>›</span>
                  </button>
                </div>

                {expanded ? (
                  <div className="mt-3 border-t border-black/8 pt-3">
                    <div className="grid gap-2">
                      {card.rules.map((rule) => (
                        <div
                          key={`${card.key}-${rule.name}`}
                          className="rounded-xl border border-black/8 bg-white/70 px-3 py-2"
                        >
                          <div className="text-[10px] font-semibold text-desktop-text-primary">
                            {formatRuleLabel(rule.name)}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {buildRuleBadges(rule).map((badge) => (
                              <span
                                key={`${rule.name}-${badge}`}
                                className="rounded-full border border-black/8 bg-white px-2 py-0.5 text-[9px] text-desktop-text-secondary"
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}

                      {card.metaDetails.map((detail) => (
                        <div
                          key={`${card.key}-${detail.label}`}
                          className="rounded-xl border border-black/8 bg-white/70 px-3 py-2"
                        >
                          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                            {detail.label}
                          </div>
                          <div className="mt-1 text-[10px] leading-4 text-desktop-text-primary">
                            {detail.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
