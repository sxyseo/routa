"use client";

import type { ReactNode } from "react";
import type { CanonicalStoryParseResult } from "@/core/kanban/canonical-story";
import { useTranslation } from "@/i18n";

interface CanonicalStoryRendererProps {
  parseResult: CanonicalStoryParseResult;
  compact?: boolean;
  className?: string;
}

type InvestStatus = "pass" | "warning" | "fail";

function getStatusTone(status: InvestStatus): string {
  switch (status) {
    case "pass":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200";
    case "fail":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200";
  }
}

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function SummaryBlock({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-[#0f141d]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value}
      </div>
    </div>
  );
}

function ListBlock({
  label,
  items,
  emptyLabel,
}: {
  label: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-[#0f141d]">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </div>
      {items.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">{emptyLabel}</div>
      )}
    </div>
  );
}

function formatStatus(status: InvestStatus, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (status) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
  }
}

function CompactField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 dark:border-slate-700 dark:bg-[#0f141d]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700 dark:text-slate-200">
        {value}
      </div>
    </div>
  );
}

function CompactDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className="group rounded-xl border border-slate-200/80 bg-white/90 dark:border-slate-700 dark:bg-[#0f141d]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            {title}
          </div>
          {summary && (
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {summary}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[11px] font-medium text-slate-400 transition-colors group-hover:text-slate-600 dark:group-hover:text-slate-300">
          +
        </span>
      </summary>
      <div className="border-t border-slate-200/70 px-3 py-2.5 dark:border-slate-700">
        {children}
      </div>
    </details>
  );
}

export function CanonicalStoryRenderer({
  parseResult,
  compact = false,
  className = "",
}: CanonicalStoryRendererProps) {
  const { t } = useTranslation();

  if (parseResult.story == null) {
    return (
      <div
        className={joinClasses(
          "canonical-story-renderer not-prose rounded-2xl border border-rose-200 bg-rose-50/80 p-3 dark:border-rose-900/40 dark:bg-rose-900/10",
          className,
        )}
        data-testid="canonical-story-renderer-invalid"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
            {t.kanbanDetail.invalidYaml}
          </span>
          <span className="text-xs text-rose-700 dark:text-rose-200">
            {t.kanbanDetail.invalidYamlHint}
          </span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-rose-800 dark:text-rose-100">
          {parseResult.issues.map((issue) => (
            <li key={issue} className="whitespace-pre-wrap">
              - {issue}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { story } = parseResult.story;
  const investItems = [
    { label: t.kanbanDetail.investIndependent, check: story.invest.independent },
    { label: t.kanbanDetail.investNegotiable, check: story.invest.negotiable },
    { label: t.kanbanDetail.investValuable, check: story.invest.valuable },
    { label: t.kanbanDetail.investEstimable, check: story.invest.estimable },
    { label: t.kanbanDetail.investSmall, check: story.invest.small },
    { label: t.kanbanDetail.investTestable, check: story.invest.testable },
  ] as const;

  if (compact) {
    return (
      <div
        className={joinClasses(
          "canonical-story-renderer not-prose rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/10",
          className,
        )}
        data-testid="canonical-story-renderer"
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
                {t.kanbanDetail.validYaml}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {t.kanbanDetail.structuredStory}
              </span>
            </div>

            <div className="text-base font-semibold leading-7 text-slate-950 dark:text-slate-50">
              {story.title}
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
                {t.kanbanDetail.version} {story.version}
              </span>
              <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
                {t.language}: {story.language}
              </span>
              <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
                {t.kanbanDetail.acceptanceCriteria}: {story.acceptance_criteria.length}
              </span>
              <span className="rounded-full border border-slate-200 bg-white/90 px-2 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
                {t.kanbanDetail.independentStoryCheck}: {formatStatus(story.dependencies_and_sequencing.independent_story_check, t)}
              </span>
            </div>
          </div>

          <div className="grid gap-2">
            <CompactField label={t.kanbanDetail.problemStatement} value={story.problem_statement} />
            <CompactField label={t.kanbanDetail.userValue} value={story.user_value} />
          </div>

          <CompactDisclosure
            title={t.kanbanDetail.acceptanceCriteria}
            summary={`#${story.acceptance_criteria.length}`}
            defaultOpen
          >
            <div className="space-y-2">
              {story.acceptance_criteria.map((criterion) => (
                <div
                  key={criterion.id}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-300">
                      {criterion.id}
                    </span>
                    <span
                      className={joinClasses(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                        getStatusTone(criterion.testable ? "pass" : "fail"),
                      )}
                    >
                      {criterion.testable ? t.kanbanDetail.investTestable : t.kanbanDetail.fail}
                    </span>
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700 dark:text-slate-200">
                    {criterion.text}
                  </div>
                </div>
              ))}
            </div>
          </CompactDisclosure>

          <CompactDisclosure
            title={t.kanbanDetail.investSummary}
            summary={investItems.map(({ label, check }) => `${label}: ${formatStatus(check.status, t)}`).join(" · ")}
          >
            <div className="grid gap-2">
              {investItems.map(({ label, check }) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                      {label}
                    </div>
                    <span
                      className={joinClasses(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                        getStatusTone(check.status),
                      )}
                    >
                      {formatStatus(check.status, t)}
                    </span>
                  </div>
                  <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-700 dark:text-slate-200">
                    {check.reason}
                  </div>
                </div>
              ))}
            </div>
          </CompactDisclosure>

          <CompactDisclosure
            title={`${t.kanbanDetail.affectedAreas} / ${t.kanbanDetail.dependsOn}`}
            summary={`${story.constraints_and_affected_areas.length} · ${story.dependencies_and_sequencing.depends_on.length}`}
          >
            <div className="grid gap-2">
              <ListBlock
                label={t.kanbanDetail.affectedAreas}
                items={story.constraints_and_affected_areas}
                emptyLabel={t.kanbanDetail.none}
              />
              <ListBlock
                label={t.kanbanDetail.dependsOn}
                items={story.dependencies_and_sequencing.depends_on}
                emptyLabel={t.kanbanDetail.none}
              />
              <CompactField
                label={t.kanbanDetail.unblockCondition}
                value={story.dependencies_and_sequencing.unblock_condition || t.kanbanDetail.none}
              />
              <ListBlock
                label={t.kanbanDetail.outOfScope}
                items={story.out_of_scope}
                emptyLabel={t.kanbanDetail.none}
              />
            </div>
          </CompactDisclosure>
        </div>
      </div>
    );
  }

  return (
    <div
      className={joinClasses(
        "canonical-story-renderer not-prose rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/40 dark:bg-emerald-900/10",
        className,
      )}
      data-testid="canonical-story-renderer"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              {t.kanbanDetail.validYaml}
            </span>
            <span className="text-xs text-slate-600 dark:text-slate-300">
              {t.kanbanDetail.structuredStory}
            </span>
          </div>
          <div className="text-lg font-semibold leading-8 text-slate-950 dark:text-slate-50">
            {story.title}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
              {t.kanbanDetail.version} {story.version}
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
              {t.language}: {story.language}
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
              {t.kanbanDetail.acceptanceCriteria}: {story.acceptance_criteria.length}
            </span>
            <span className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 dark:border-slate-700 dark:bg-[#0f141d]">
              {t.kanbanDetail.independentStoryCheck}: {formatStatus(story.dependencies_and_sequencing.independent_story_check, t)}
            </span>
          </div>
        </div>

        <div className={joinClasses("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
          <SummaryBlock label={t.kanbanDetail.problemStatement} value={story.problem_statement} />
          <SummaryBlock label={t.kanbanDetail.userValue} value={story.user_value} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-[#0f141d]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t.kanbanDetail.acceptanceCriteria}
          </div>
          <div className="mt-3 space-y-2">
            {story.acceptance_criteria.map((criterion) => (
              <div
                key={criterion.id}
                className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/70"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:bg-[#0f141d] dark:text-slate-300">
                    {criterion.id}
                  </span>
                  <span
                    className={joinClasses(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                      getStatusTone(criterion.testable ? "pass" : "fail"),
                    )}
                  >
                    {criterion.testable ? t.kanbanDetail.investTestable : t.kanbanDetail.fail}
                  </span>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
                  {criterion.text}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={joinClasses("grid gap-2", compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3")}>
          {investItems.map(({ label, check }) => (
            <div
              key={label}
              className="min-w-0 rounded-2xl border border-slate-200 bg-white/90 p-3 dark:border-slate-700 dark:bg-[#0f141d]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {label}
                </div>
                <span
                  className={joinClasses(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                    getStatusTone(check.status),
                  )}
                >
                  {formatStatus(check.status, t)}
                </span>
              </div>
              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                {check.reason}
              </div>
            </div>
          ))}
        </div>

        <div className={joinClasses("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
          <ListBlock
            label={t.kanbanDetail.affectedAreas}
            items={story.constraints_and_affected_areas}
            emptyLabel={t.kanbanDetail.none}
          />
          <ListBlock
            label={t.kanbanDetail.dependsOn}
            items={story.dependencies_and_sequencing.depends_on}
            emptyLabel={t.kanbanDetail.none}
          />
          <SummaryBlock
            label={t.kanbanDetail.unblockCondition}
            value={story.dependencies_and_sequencing.unblock_condition || t.kanbanDetail.none}
          />
          <ListBlock
            label={t.kanbanDetail.outOfScope}
            items={story.out_of_scope}
            emptyLabel={t.kanbanDetail.none}
          />
        </div>
      </div>
    </div>
  );
}
