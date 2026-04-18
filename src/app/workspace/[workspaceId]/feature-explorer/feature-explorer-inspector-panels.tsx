"use client";

import { type ReactNode, useState } from "react";
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RotateCcw,
  X,
} from "lucide-react";

import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";

import type {
  AggregatedSelectionSession,
  ApiDetail,
  FeatureDetail,
} from "./types";
import {
  type ExplorerSurfaceItem,
  getHttpMethodBadgeClass,
} from "./surface-navigation";
import { sanitizeChangedFiles } from "./session-analysis";

function formatShortDate(iso: string): string {
  if (!iso || iso === "-") return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function formatSignalProvider(provider: string): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "qoder":
      return "Qoder";
    case "augment":
      return "Augment";
    default:
      return provider || "Session";
  }
}

function getSignalProviderBadgeClass(provider: string): string {
  switch (provider) {
    case "codex":
      return "border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-200";
    case "claude":
      return "border-orange-300/70 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/12 dark:text-orange-200";
    case "qoder":
      return "border-violet-300/70 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-200";
    case "augment":
      return "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-200";
    default:
      return "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary";
  }
}

function describeSurfaceKind(
  kind: ExplorerSurfaceItem["kind"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (kind) {
    case "feature":
      return t.featureExplorer.surfaceTypeFeature;
    case "page":
      return t.featureExplorer.surfaceTypePage;
    case "contract-api":
      return t.featureExplorer.surfaceTypeContractApi;
    case "nextjs-api":
      return t.featureExplorer.surfaceTypeNextjsApi;
    case "rust-api":
      return t.featureExplorer.surfaceTypeRustApi;
  }
}

function ContextSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-2.5">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      {children}
    </section>
  );
}

function CompactFileList({
  files,
  title,
}: {
  files: string[];
  title?: string;
}) {
  return (
    <div className="space-y-1">
      {title ? (
        <div className="text-[10px] font-medium text-desktop-text-secondary">{title}</div>
      ) : null}
      <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {files.map((sourceFile) => (
          <div
            key={sourceFile}
            className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
          >
            {sourceFile}
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalEmptyState({ message }: { message: string }) {
  return (
    <div className="mt-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
      {message}
    </div>
  );
}

function InlineMetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary">
      <span className="font-medium text-desktop-text-primary">{value}</span>
      <span>{label}</span>
    </div>
  );
}

export function ContextPanel({
  featureDetail,
  selectedFileCount,
  selectedScopeSessions,
  selectedSurface,
  selectedSurfaceFeatureNames,
  onOpenSessionAnalysis,
  t,
}: {
  featureDetail: FeatureDetail | null;
  selectedFileCount: number;
  selectedScopeSessions: AggregatedSelectionSession[];
  selectedSurface: ExplorerSurfaceItem | null;
  selectedSurfaceFeatureNames: string[];
  onOpenSessionAnalysis?: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [copiedResumeCommand, setCopiedResumeCommand] = useState("");
  const [expandedPromptSessions, setExpandedPromptSessions] = useState<Record<string, boolean>>({});

  if (!featureDetail && !selectedSurface) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  const isFeatureSurface = selectedSurface?.kind === "feature";
  const selectedSurfaceKindLabel = selectedSurface
    ? describeSurfaceKind(selectedSurface.kind, t)
    : "";
  const canOpenSessionAnalysis = selectedFileCount > 0
    && selectedScopeSessions.length > 0
    && typeof onOpenSessionAnalysis === "function";

  return (
    <div className="space-y-2">
      {selectedSurface && !isFeatureSurface ? (
        <ContextSection title={t.featureExplorer.selectedSurface}>
          <div className="space-y-2.5">
            <div>
              <div className="text-[13px] font-semibold text-desktop-text-primary">{selectedSurface.label}</div>
              {selectedSurface.badges?.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {selectedSurface.badges.map((badge) => (
                    <span key={badge} className={getHttpMethodBadgeClass(badge, "compact")}>
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}
              {selectedSurface.secondary && !(selectedSurface.badges?.length ?? 0) ? (
                <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{selectedSurface.secondary}</div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <InlineMetricPill label={t.featureExplorer.surfaceTypeLabel} value={selectedSurfaceKindLabel} />
              <InlineMetricPill
                label={t.featureExplorer.linkedFeatures}
                value={selectedSurfaceFeatureNames.length > 0 ? String(selectedSurfaceFeatureNames.length) : t.featureExplorer.unmappedLabel}
              />
            </div>

            {selectedSurfaceFeatureNames.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-desktop-text-secondary">{t.featureExplorer.linkedFeatures}</div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSurfaceFeatureNames.map((featureName) => (
                    <span
                      key={featureName}
                      className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[11px] text-desktop-text-secondary"
                    >
                      {featureName}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedSurface.sourceFiles.length > 0 ? (
              <CompactFileList title={t.featureExplorer.sourceFilesLabel} files={selectedSurface.sourceFiles} />
            ) : null}
          </div>
        </ContextSection>
      ) : null}

      {featureDetail ? (
        <section className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-2.5">
          <div className="space-y-1.5">
            <div>
              <div className="text-[14px] font-semibold text-desktop-text-primary">{featureDetail.name}</div>
              {featureDetail.summary ? (
                <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{featureDetail.summary}</div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <ContextSection title={t.featureExplorer.selectedFileSignals}>
        {selectedFileCount > 0 ? (
          selectedScopeSessions.length > 0 ? (
            <div className="space-y-1.5">
              {selectedScopeSessions.map((session) => {
                const sessionKey = `${session.provider}:${session.sessionId}`;
                const isExpanded = expandedPromptSessions[sessionKey] ?? false;
                const promptHistory = session.promptHistory.length > 0
                  ? session.promptHistory
                  : (session.promptSnippet ? [session.promptSnippet] : []);
                const visiblePrompts = isExpanded ? promptHistory : promptHistory.slice(0, 2);
                const relatedFiles = sanitizeChangedFiles(session.changedFiles);

                return (
                  <div
                    key={sessionKey}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${getSignalProviderBadgeClass(session.provider)}`}
                          >
                            {formatSignalProvider(session.provider)}
                          </span>
                          <code className="min-w-0 flex-1 break-all text-[10px] text-desktop-text-primary">
                            {session.sessionId}
                          </code>
                          <button
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard.writeText(session.resumeCommand ?? session.sessionId);
                              setCopiedResumeCommand(sessionKey);
                            }}
                            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-0.5 text-[10px] text-desktop-text-secondary hover:text-desktop-text-primary"
                            aria-label={
                              session.resumeCommand
                                ? `${t.featureExplorer.resumeCommandLabel}: ${session.sessionId}`
                                : `${t.common.copyToClipboard}: ${session.sessionId}`
                            }
                            title={session.resumeCommand ? t.featureExplorer.resumeCommandLabel : t.common.copyToClipboard}
                          >
                            {copiedResumeCommand === sessionKey ? (
                              <Check className="h-3 w-3" />
                            ) : session.resumeCommand ? (
                              <RotateCcw className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                      <span className="shrink-0 text-[10px] text-desktop-text-secondary">
                        {formatShortDate(session.updatedAt)}
                      </span>
                    </div>

                    {visiblePrompts.length > 0 ? (
                      <div className={`mt-1.5 space-y-1 pr-1 ${isExpanded ? "max-h-48 overflow-y-auto" : ""}`}>
                        {visiblePrompts.map((prompt, index) => (
                          <div
                            key={`${session.sessionId}:prompt:${index}`}
                            className={`rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[10px] leading-4 text-desktop-text-secondary ${
                              isExpanded ? "" : "line-clamp-4"
                            }`}
                          >
                            {prompt}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {promptHistory.length > 2 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPromptSessions((prev) => ({
                            ...prev,
                            [sessionKey]: !isExpanded,
                          }))}
                        className="mt-1 inline-flex items-center gap-1 rounded-sm border border-desktop-border bg-desktop-bg-primary px-1.5 py-1 text-[10px] text-desktop-text-secondary hover:text-desktop-text-primary"
                      >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        {isExpanded ? t.common.showLess : t.common.showAll}
                      </button>
                    ) : null}

                    {relatedFiles.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] font-medium text-desktop-text-secondary">
                          {t.featureExplorer.relatedFiles}
                        </div>
                        <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
                          {relatedFiles.map((filePath) => (
                            <div
                              key={`${sessionKey}:${filePath}`}
                              className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2 py-1 text-[10px] text-desktop-text-secondary"
                            >
                              {filePath}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <SignalEmptyState message={t.featureExplorer.noSessionEvidence} />
          )
        ) : (
          <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary">
            {t.featureExplorer.noFilesSelected}
          </div>
        )}
      </ContextSection>

      {featureDetail && featureDetail.relatedFeatures.length > 0 ? (
        <ContextSection title={t.featureExplorer.relatedFeaturesLabel}>
          <div className="flex flex-wrap gap-1.5">
            {featureDetail.relatedFeatures.map((relId) => (
              <span
                key={relId}
                className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[11px] text-desktop-text-secondary"
              >
                {relId}
              </span>
            ))}
          </div>
        </ContextSection>
      ) : null}

      <ContextSection title={t.featureExplorer.sessionAnalysisTitle}>
        <div className="space-y-2">
          <div className="text-[11px] leading-5 text-desktop-text-secondary">
            {canOpenSessionAnalysis
              ? t.featureExplorer.sessionAnalysisDescription
              : t.featureExplorer.sessionAnalysisEmpty}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <InlineMetricPill label={t.featureExplorer.filesLabel} value={String(selectedFileCount)} />
            <InlineMetricPill label={t.featureExplorer.sessionsLabel} value={String(selectedScopeSessions.length)} />
          </div>

          <button
            type="button"
            onClick={() => onOpenSessionAnalysis?.()}
            disabled={!canOpenSessionAnalysis}
            className={`inline-flex w-full items-center justify-center rounded-sm border px-2 py-1.5 text-[11px] font-medium transition-colors ${
              canOpenSessionAnalysis
                ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary hover:bg-desktop-bg-primary"
                : "cursor-not-allowed border-desktop-border bg-desktop-bg-primary/40 text-desktop-text-secondary/60"
            }`}
          >
            {t.featureExplorer.sessionAnalysisOpen}
          </button>
        </div>
      </ContextSection>
    </div>
  );
}

export function SessionAnalysisDrawer({
  open,
  selectedFilePaths,
  selectedScopeSessions,
  providers,
  selectedProvider,
  onProviderChange,
  isStartingSessionAnalysis = false,
  sessionAnalysisError,
  onClose,
  onStartSessionAnalysis,
  t,
}: {
  open: boolean;
  selectedFilePaths: string[];
  selectedScopeSessions: AggregatedSelectionSession[];
  providers: AcpProviderInfo[];
  selectedProvider: string;
  onProviderChange: (provider: string) => void;
  isStartingSessionAnalysis?: boolean;
  sessionAnalysisError?: string | null;
  onClose: () => void;
  onStartSessionAnalysis: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        data-testid="feature-explorer-session-analysis-backdrop"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex h-full w-[26rem] max-w-full flex-col overflow-hidden border-l border-desktop-border bg-desktop-bg-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t.featureExplorer.sessionAnalysisTitle}
        data-testid="feature-explorer-session-analysis-drawer"
      >
        <div className="flex items-start justify-between gap-3 border-b border-desktop-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-desktop-text-primary">
              {t.featureExplorer.sessionAnalysisTitle}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
              {t.featureExplorer.sessionAnalysisDescription}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            title={t.common.close}
            className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-desktop-text-secondary hover:text-desktop-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-desktop-border bg-desktop-bg-secondary/40 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <InlineMetricPill label={t.featureExplorer.filesLabel} value={String(selectedFilePaths.length)} />
            <InlineMetricPill label={t.featureExplorer.sessionsLabel} value={String(selectedScopeSessions.length)} />
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                {t.settings.provider}
              </span>
              <AcpProviderDropdown
                providers={providers}
                selectedProvider={selectedProvider}
                onProviderChange={onProviderChange}
                dataTestId="feature-explorer-session-analysis-provider"
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <ContextSection title={t.featureExplorer.selectedFiles}>
            <CompactFileList files={selectedFilePaths} />
          </ContextSection>

          <ContextSection title={t.featureExplorer.selectedFileSignals}>
            <div className="space-y-2">
              {selectedScopeSessions.map((session) => (
                <div
                  key={`${session.provider}:${session.sessionId}`}
                  className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${getSignalProviderBadgeClass(session.provider)}`}
                        >
                          {formatSignalProvider(session.provider)}
                        </span>
                        <code className="min-w-0 flex-1 break-all text-[10px] text-desktop-text-primary">
                          {session.sessionId}
                        </code>
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                        {session.promptSnippet || t.featureExplorer.noPromptHistory}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-desktop-text-secondary">
                      {formatShortDate(session.updatedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ContextSection>

          {sessionAnalysisError ? (
            <div className="rounded-sm border border-red-400/40 bg-red-500/8 px-3 py-2 text-[11px] text-red-500">
              {sessionAnalysisError}
            </div>
          ) : null}
        </div>

        <div className="border-t border-desktop-border bg-desktop-bg-secondary/40 px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-1.5 text-[11px] text-desktop-text-secondary hover:text-desktop-text-primary"
            >
              {t.common.close}
            </button>
            <button
              type="button"
              onClick={onStartSessionAnalysis}
              disabled={isStartingSessionAnalysis}
              className={`rounded-sm border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                isStartingSessionAnalysis
                  ? "cursor-wait border-desktop-border bg-desktop-bg-primary/40 text-desktop-text-secondary/60"
                  : "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary hover:bg-desktop-bg-primary"
              }`}
            >
              {isStartingSessionAnalysis
                ? t.featureExplorer.sessionAnalysisStarting
                : t.featureExplorer.sessionAnalysisAction}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export function ScreenshotPanel({
  featureDetail,
  t,
}: {
  featureDetail: FeatureDetail | null;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  if (!featureDetail) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  return (
    <ContextSection title={t.featureExplorer.screenshotTab}>
      <div className="space-y-2">
        <div className="text-[11px] text-desktop-text-secondary">{t.featureExplorer.screenshotComingSoon}</div>
        <div className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2 text-[11px] text-desktop-text-secondary">
          {featureDetail.pageDetails?.length || featureDetail.pages.length > 0
            ? t.featureExplorer.pendingImplementation
            : t.featureExplorer.noPagesDeclared}
        </div>
      </div>
    </ContextSection>
  );
}

export function ApiPanel({
  featureDetail,
  t,
  onRequest,
}: {
  featureDetail: FeatureDetail | null;
  t: ReturnType<typeof useTranslation>["t"];
  onRequest: (method: string, path: string) => Promise<string>;
}) {
  const [selectedApiIdx, setSelectedApiIdx] = useState(0);
  const [responseBody, setResponseBody] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const fallbackApiDetails: ApiDetail[] = featureDetail?.apis.map((declaration): ApiDetail => {
    const [method, endpoint] = declaration.split(/\s+/, 2);
    if (endpoint) {
      return { group: "", method, endpoint, description: "" };
    }
    return { group: "", method: "GET", endpoint: declaration, description: "" };
  }) ?? [];
  const apiDetails: ApiDetail[] = featureDetail?.apiDetails ?? fallbackApiDetails;

  if (!featureDetail || apiDetails.length === 0) {
    return <div className="text-xs text-desktop-text-secondary">-</div>;
  }

  const selectedApi: ApiDetail = apiDetails[selectedApiIdx] ?? apiDetails[0] ?? {
    group: "",
    method: "GET",
    endpoint: "",
    description: "",
  };
  const method = selectedApi.method;
  const apiPath = selectedApi.endpoint;
  const nextjsSources: string[] = [...new Set(selectedApi.nextjsSourceFiles ?? [])];
  const rustSources: string[] = [...new Set(selectedApi.rustSourceFiles ?? [])];

  const methodTone = method === "GET"
    ? "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-200"
    : method === "POST"
      ? "border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-200"
      : "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200";

  const handleRequest = async () => {
    setRequestState("loading");
    try {
      const result = await onRequest(method, apiPath);
      setResponseBody(result);
      setRequestState("done");
    } catch {
      setRequestState("error");
    }
  };

  return (
    <div className="space-y-2">
      <ContextSection title={t.featureExplorer.apiTab}>
        <select
          value={selectedApiIdx}
          onChange={(e) => {
            setSelectedApiIdx(Number(e.target.value));
            setResponseBody("");
            setRequestState("idle");
          }}
          className="w-full rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-primary outline-none"
        >
          {apiDetails.map((api, idx) => (
            <option key={`${api.method}-${api.endpoint}`} value={idx}>{`${api.method} ${api.endpoint}`}</option>
          ))}
        </select>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className={`rounded-sm border px-2 py-0.5 font-semibold ${methodTone}`}>
            {method}
          </span>
          <code className="truncate text-desktop-text-secondary">{apiPath}</code>
        </div>
        {selectedApi.group || selectedApi.description || nextjsSources.length > 0 || rustSources.length > 0 ? (
          <div className="mt-2 rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-2">
            {selectedApi.group ? (
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                {selectedApi.group}
              </div>
            ) : null}
            {selectedApi.description ? (
              <div className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">
                {selectedApi.description}
              </div>
            ) : null}
            {nextjsSources.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  Next.js
                </div>
                <div className="mt-1 space-y-1">
                  {nextjsSources.map((sourceFile) => (
                    <div key={sourceFile} className="break-all text-[11px] text-desktop-text-secondary">
                      {sourceFile}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {rustSources.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-desktop-text-secondary">
                  Rust
                </div>
                <div className="mt-1 space-y-1">
                  {rustSources.map((sourceFile) => (
                    <div key={sourceFile} className="break-all text-[11px] text-desktop-text-secondary">
                      {sourceFile}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </ContextSection>

      <ContextSection title={t.featureExplorer.requestBody}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRequest}
            className="inline-flex items-center gap-1 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[10px] text-desktop-text-primary"
          >
            <Braces className="h-3 w-3" />
            {t.featureExplorer.tryLiveRequest}
          </button>
          <span className="text-[10px] text-desktop-text-secondary">{requestState}</span>
        </div>
      </ContextSection>

      {responseBody ? (
        <ContextSection title={t.featureExplorer.response}>
          <pre className="overflow-x-auto rounded-sm border border-desktop-border bg-desktop-bg-secondary p-2 text-[11px] leading-5 text-desktop-text-primary">
            {responseBody}
          </pre>
        </ContextSection>
      ) : null}
    </div>
  );
}
