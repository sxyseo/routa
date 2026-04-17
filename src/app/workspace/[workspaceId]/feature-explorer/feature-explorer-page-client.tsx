"use client";

import { type ReactNode, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileCode2,
  FileJson2,
  FileText,
  FlaskConical,
  Folder,
  ImageIcon,
  Play,
  Search,
} from "lucide-react";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { useCodebases, useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import {
  type ApiPreset,
  type ExplorerScope,
  type FeatureDefinition,
  type FileNode,
  type InspectorTab,
  getFeatureDefinitions,
} from "./mock-data";

type FlatFileMap = Record<string, FileNode>;

function flattenFiles(nodes: FileNode[], acc: FlatFileMap = {}): FlatFileMap {
  for (const node of nodes) {
    acc[node.id] = node;
    if (node.children?.length) {
      flattenFiles(node.children, acc);
    }
  }
  return acc;
}

function getVisibleNode(node: FileNode, scope: ExplorerScope): FileNode | null {
  const scopeRank: Record<ExplorerScope, number> = {
    changed: 0,
    related: 1,
    all: 2,
  };

  if (node.kind === "file") {
    return scopeRank[node.scope] <= scopeRank[scope] ? node : null;
  }

  const visibleChildren = (node.children ?? [])
    .map((child) => getVisibleNode(child, scope))
    .filter(Boolean) as FileNode[];

  if (visibleChildren.length === 0) return null;
  return { ...node, children: visibleChildren };
}

function buildVisibleTree(feature: FeatureDefinition, scope: ExplorerScope): FileNode[] {
  return feature.files
    .map((node) => getVisibleNode(node, scope))
    .filter(Boolean) as FileNode[];
}

function collectLeafIds(node: FileNode, acc: string[] = []): string[] {
  if (node.kind === "file") {
    acc.push(node.id);
    return acc;
  }
  for (const child of node.children ?? []) {
    collectLeafIds(child, acc);
  }
  return acc;
}

function displayMethodTone(method: ApiPreset["method"]): string {
  switch (method) {
    case "GET":
      return "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-200";
    case "POST":
      return "border-sky-300/70 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-200";
    case "PATCH":
      return "border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200";
    default:
      return "border-slate-300/70 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-200";
  }
}

type FeatureGroupId = "execution" | "workflow" | "governance";

function getFeatureMeta(featureId: string): { code: string; group: FeatureGroupId } {
  switch (featureId) {
    case "kanban-workflow":
      return { code: "KB", group: "workflow" };
    case "harness-console":
      return { code: "HC", group: "governance" };
    case "session-recovery":
    default:
      return { code: "SR", group: "execution" };
  }
}

export function FeatureExplorerPageClient({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const workspacesHook = useWorkspaces();
  const { codebases } = useCodebases(workspaceId);

  const [scope, setScope] = useState<ExplorerScope>("changed");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("context");
  const [featureId, setFeatureId] = useState<string>("session-recovery");
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    src: true,
    "src-app": true,
    "src-app-sessions": true,
    "src-app-api": true,
    "src-app-api-sessions": true,
    "src-app-api-sessions-id": true,
    "src-core": true,
    "src-core-store": true,
    specs: true,
  });
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(["page-tsx", "session-store-ts"]);
  const [activeFileId, setActiveFileId] = useState<string>("page-tsx");
  const [selectedApiId, setSelectedApiId] = useState<string>("api-3");
  const [requestBody, setRequestBody] = useState("");
  const [responseBody, setResponseBody] = useState("");
  const [requestState, setRequestState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");

  const features = useMemo(() => getFeatureDefinitions(), []);
  const activeFeature = useMemo(
    () => features.find((feature) => feature.id === featureId) ?? features[0],
    [featureId, features],
  );
  const visibleTree = useMemo(() => buildVisibleTree(activeFeature, scope), [activeFeature, scope]);
  const flatMap = useMemo(() => flattenFiles(activeFeature.files), [activeFeature]);
  const activeFile = flatMap[activeFileId] ?? Object.values(flatMap).find((node) => node.kind === "file") ?? null;
  const selectedFiles = selectedFileIds.map((id) => flatMap[id]).filter(Boolean);
  const activeApiPreset = activeFeature.apis.find((api) => api.id === selectedApiId) ?? activeFeature.apis[0];
  const currentCodebase = codebases.find((item) => item.isDefault) ?? codebases[0];
  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId) ?? null;

  const filteredFeatureList = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return features;
    return features.filter((feature) => feature.name.toLowerCase().includes(normalized));
  }, [features, query]);

  const groupedFeatureList = useMemo(() => {
    const groups: Record<FeatureGroupId, { label: string; items: Array<FeatureDefinition & { code: string }> }> = {
      execution: { label: t.featureExplorer.groupExecution, items: [] },
      workflow: { label: t.featureExplorer.groupWorkflow, items: [] },
      governance: { label: t.featureExplorer.groupGovernance, items: [] },
    };

    for (const feature of filteredFeatureList) {
      const meta = getFeatureMeta(feature.id);
      groups[meta.group].items.push({ ...feature, code: meta.code });
    }

    return (["execution", "workflow", "governance"] as const)
      .map((groupId) => ({
        id: groupId,
        label: groups[groupId].label,
        items: groups[groupId].items,
      }))
      .filter((group) => group.items.length > 0);
  }, [
    filteredFeatureList,
    t.featureExplorer.groupExecution,
    t.featureExplorer.groupGovernance,
    t.featureExplorer.groupWorkflow,
  ]);

  const selectionSummary = useMemo(() => {
    return selectedFiles.reduce(
      (summary, file) => {
        summary.plus += file.metric?.plus ?? 0;
        summary.minus += file.metric?.minus ?? 0;
        return summary;
      },
      { plus: 0, minus: 0 },
    );
  }, [selectedFiles]);

  const handleWorkspaceSelect = (nextWorkspaceId: string) => {
    router.push(`/workspace/${encodeURIComponent(nextWorkspaceId)}/feature-explorer`);
  };

  const handleWorkspaceCreate = async (title: string) => {
    const created = await workspacesHook.createWorkspace(title);
    if (created?.id) {
      router.push(`/workspace/${encodeURIComponent(created.id)}/feature-explorer`);
    }
  };

  const handleToggleNode = (nodeId: string) => {
    setExpandedIds((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const handleToggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((item) => item !== fileId) : [...prev, fileId],
    );
    setActiveFileId(fileId);
  };

  const handleSelectFeature = (nextFeatureId: string) => {
    const nextFeature = features.find((item) => item.id === nextFeatureId) ?? features[0];
    const firstFile = Object.values(flattenFiles(nextFeature.files)).find((node) => node.kind === "file");

    setFeatureId(nextFeature.id);
    setScope("changed");
    setInspectorTab("context");
    setResponseBody("");
    setRequestState("idle");
    setSelectedApiId(nextFeature.apis[0]?.id ?? "");
    setRequestBody(nextFeature.apis[0]?.body ?? "");
    if (firstFile) {
      setActiveFileId(firstFile.id);
      setSelectedFileIds([firstFile.id]);
    } else {
      setSelectedFileIds([]);
    }
  };

  const handleApiPresetChange = (apiId: string) => {
    const preset = activeFeature.apis.find((item) => item.id === apiId);
    setSelectedApiId(apiId);
    setRequestBody(preset?.body ?? "");
    setResponseBody("");
    setRequestState("idle");
  };

  const handleMockRequest = async () => {
    if (!activeApiPreset) return;
    setRequestState("loading");
    setResponseBody("");
    await new Promise((resolve) => setTimeout(resolve, 650));
    setRequestState("done");
    setResponseBody(activeApiPreset.responseExample);
  };

  const handleLiveRequest = async () => {
    if (!activeApiPreset) return;
    try {
      setRequestState("loading");
      const init: RequestInit = {
        method: activeApiPreset.method,
        headers: {
          "Content-Type": "application/json",
        },
      };
      if (activeApiPreset.method !== "GET" && requestBody.trim()) {
        init.body = requestBody;
      }
      const response = await desktopAwareFetch(activeApiPreset.path, init);
      const text = await response.text();
      setResponseBody(text || `HTTP ${response.status}`);
      setRequestState(response.ok ? "done" : "error");
    } catch (error) {
      setRequestState("error");
      setResponseBody(
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : t.featureExplorer.requestFailed,
          },
          null,
          2,
        ),
      );
    }
  };

  const handleCopyContext = async () => {
    const payload = {
      featureId: activeFeature.id,
      selectedFiles: selectedFiles.map((file) => file.path),
      inspectorTab,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopyState("done");
    window.setTimeout(() => setCopyState("idle"), 1200);
  };

  const handleClearSelection = () => {
    setSelectedFileIds([]);
  };

  const handleContinue = () => {
    router.push(`/workspace/${encodeURIComponent(workspaceId)}/sessions`);
  };

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspace?.title ?? workspaceId}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspace?.title ?? workspaceId}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-desktop-bg-primary">
        <main className="flex min-w-0 flex-1">
          <section className="grid min-h-0 flex-1 xl:grid-cols-[240px_minmax(0,1fr)_340px]">
            <aside className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-secondary/20">
              <div className="border-b border-desktop-border px-3 py-2">
                <label className="flex items-center gap-2 rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1.5 text-xs text-desktop-text-secondary">
                  <Search className="h-3.5 w-3.5" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t.featureExplorer.searchPlaceholder}
                    className="w-full bg-transparent text-xs text-desktop-text-primary outline-none placeholder:text-desktop-text-secondary"
                  />
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {groupedFeatureList.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-desktop-text-secondary">
                    {t.featureExplorer.noFeatureMatches}
                  </div>
                ) : (
                  groupedFeatureList.map((group) => (
                    <div key={group.id} className="border-b border-desktop-border">
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                        {group.label}
                      </div>
                      <div className="px-2 pb-2">
                        {group.items.map((feature) => {
                          const isActive = feature.id === activeFeature.id;
                          return (
                            <button
                              key={feature.id}
                              onClick={() => handleSelectFeature(feature.id)}
                              className={`mb-1.5 w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${
                                isActive
                                  ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                                  : "border-transparent text-desktop-text-secondary hover:border-desktop-border hover:bg-desktop-bg-primary/70 hover:text-desktop-text-primary"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex h-5 w-7 items-center justify-center rounded-sm border text-[10px] font-semibold ${
                                  isActive
                                    ? "border-desktop-accent bg-desktop-bg-primary text-desktop-text-primary"
                                    : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                                }`}>
                                  {feature.code}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                                  {feature.name}
                                </span>
                                <span className="text-[10px] text-current/70">{feature.sessionCount}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-[10px] text-current/70">
                                <span>{feature.changedFiles}f</span>
                                <span>{feature.updatedAt}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>

            <section className="flex min-h-0 flex-col border-r border-desktop-border bg-desktop-bg-primary">
              <div className="border-b border-desktop-border px-3 py-2">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-5 w-7 items-center justify-center rounded-sm border border-desktop-accent bg-desktop-bg-active text-[10px] font-semibold text-desktop-text-primary">
                        {getFeatureMeta(activeFeature.id).code}
                      </span>
                      <h2 className="truncate text-[14px] font-semibold text-desktop-text-primary">
                        {activeFeature.name}
                      </h2>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-desktop-text-secondary">
                      <SummaryPill>{currentCodebase?.label ?? currentCodebase?.repoPath ?? t.featureExplorer.noCodebase}</SummaryPill>
                      <SummaryPill>{activeFeature.sessionCount} {t.featureExplorer.sessionsLabel}</SummaryPill>
                      <SummaryPill>{activeFeature.changedFiles} {t.featureExplorer.filesLabel}</SummaryPill>
                      <SummaryPill>{activeFeature.updatedAt}</SummaryPill>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { id: "changed", label: t.featureExplorer.changedScope },
                      { id: "related", label: t.featureExplorer.relatedScope },
                      { id: "all", label: t.featureExplorer.allScope },
                    ] as Array<{ id: ExplorerScope; label: string }>).map((mode) => (
                      <button
                        key={mode.id}
                        onClick={() => setScope(mode.id)}
                        className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          scope === mode.id
                            ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                            : "border-desktop-border bg-desktop-bg-secondary text-desktop-text-secondary hover:bg-desktop-bg-primary hover:text-desktop-text-primary"
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-[minmax(0,1fr)_72px_64px_92px] border-b border-desktop-border bg-desktop-bg-secondary/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
                  <div>{t.featureExplorer.nameColumn}</div>
                  <div>{t.featureExplorer.changeColumn}</div>
                  <div>{t.featureExplorer.sessionsColumn}</div>
                  <div>{t.featureExplorer.updatedColumn}</div>
                </div>
                <div className="divide-y divide-desktop-border">
                  {visibleTree.map((node) => (
                    <TreeNodeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      expandedIds={expandedIds}
                      activeFileId={activeFileId}
                      selectedFileIds={selectedFileIds}
                      onToggleNode={handleToggleNode}
                      onToggleFileSelection={handleToggleFileSelection}
                      onSetActiveFile={setActiveFileId}
                      folderLabel={t.featureExplorer.folderLabel}
                      selectedLabel={t.featureExplorer.selectedLabel}
                      dirtyLabel={t.featureExplorer.dirtyLabel}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-desktop-border bg-desktop-bg-secondary/20 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="truncate text-[11px] text-desktop-text-secondary">
                    {selectedFiles.length}f · +{selectionSummary.plus} · -{selectionSummary.minus}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleClearSelection}
                      className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                    >
                      {t.featureExplorer.clearSelection}
                    </button>
                    <button
                      onClick={handleContinue}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2.5 py-1 text-[11px] font-medium text-desktop-text-primary transition-colors hover:bg-desktop-bg-primary"
                    >
                      {t.featureExplorer.continueAction}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <aside className="flex min-h-0 flex-col bg-desktop-bg-secondary/10">
              <div className="border-b border-desktop-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {([
                    { id: "context", label: t.featureExplorer.contextTab, icon: FileText },
                    { id: "screenshot", label: t.featureExplorer.screenshotTab, icon: ImageIcon },
                    { id: "api", label: t.featureExplorer.apiTab, icon: FlaskConical },
                  ] as Array<{ id: InspectorTab; label: string; icon: typeof FileText }>).map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setInspectorTab(tab.id)}
                        className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          inspectorTab === tab.id
                            ? "border-desktop-accent bg-desktop-bg-active text-desktop-text-primary"
                            : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {inspectorTab === "context" && activeFile && (
                  <div className="space-y-2">
                    <ContextSection title={t.featureExplorer.activeFile}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-desktop-text-primary">
                            {activeFile.path.endsWith(".json") ? (
                              <FileJson2 className="h-4 w-4 text-amber-400" />
                            ) : activeFile.path.endsWith(".md") ? (
                              <FileText className="h-4 w-4 text-violet-400" />
                            ) : (
                              <FileCode2 className="h-4 w-4 text-sky-400" />
                            )}
                            <span className="truncate text-xs font-semibold">{activeFile.name}</span>
                          </div>
                          <div className="mt-1 truncate text-[10px] text-desktop-text-secondary">
                            {activeFile.path}
                          </div>
                        </div>
                        {activeFile.metric ? (
                          <div className="text-right text-[10px] text-desktop-text-secondary">
                            <div>{activeFile.metric.sessions}</div>
                            <div className="mt-1">
                              <span className="text-emerald-300">+{activeFile.metric.plus}</span>{" "}
                              <span className="text-rose-300">-{activeFile.metric.minus}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.recentChanges}>
                      <div className="space-y-1">
                        {activeFile.recentChanges?.map((item) => (
                          <div key={item} className="flex items-start gap-2 text-xs text-desktop-text-secondary">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.relatedFiles}>
                      <div className="space-y-1">
                        {activeFile.relatedPaths?.map((path) => (
                          <button
                            key={path}
                            className="flex w-full items-center justify-between rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-left text-[11px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                          >
                            <span className="truncate">{path}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.openGaps}>
                      <div className="space-y-1">
                        {activeFile.openGaps?.map((gap) => (
                          <div
                            key={gap}
                            className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-secondary"
                          >
                            {gap}
                          </div>
                        ))}
                      </div>
                    </ContextSection>
                  </div>
                )}

                {inspectorTab === "screenshot" && (
                  <div className="space-y-2">
                    {activeFeature.screenshots.map((screenshot) => (
                      <ContextSection key={screenshot.id} title={screenshot.title}>
                        <div className="space-y-1 text-[11px] text-desktop-text-secondary">
                          <div>{screenshot.route}</div>
                          <div>{screenshot.viewport} · {screenshot.updatedAt} · {screenshot.status}</div>
                          <div>{screenshot.note}</div>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            <button className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary">
                              {t.featureExplorer.captureBaseline}
                            </button>
                            <button className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary">
                              {t.featureExplorer.compareLatest}
                            </button>
                            <button className="inline-flex items-center gap-1 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[10px] text-desktop-text-primary">
                              <Play className="h-3 w-3" />
                              {t.featureExplorer.openRoute}
                            </button>
                          </div>
                        </div>
                      </ContextSection>
                    ))}
                  </div>
                )}

                {inspectorTab === "api" && activeApiPreset && (
                  <div className="space-y-2">
                    <ContextSection title={t.featureExplorer.apiPanel}>
                      <div className="space-y-2">
                        <select
                          value={selectedApiId}
                          onChange={(event) => handleApiPresetChange(event.target.value)}
                          className="w-full rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1.5 text-[11px] text-desktop-text-primary outline-none"
                        >
                          {activeFeature.apis.map((api) => (
                            <option key={api.id} value={api.id}>
                              {api.method} {api.path}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span className={`rounded-sm border px-2 py-0.5 font-semibold ${displayMethodTone(activeApiPreset.method)}`}>
                            {activeApiPreset.method}
                          </span>
                          <code className="truncate text-desktop-text-secondary">{activeApiPreset.path}</code>
                        </div>
                      </div>
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.requestBody}>
                      <textarea
                        value={requestBody || activeApiPreset.body || ""}
                        onChange={(event) => setRequestBody(event.target.value)}
                        rows={7}
                        className="w-full rounded-sm border border-desktop-border bg-desktop-bg-secondary p-2 font-mono text-[11px] leading-5 text-desktop-text-primary outline-none"
                        placeholder='{"featureId":"session-recovery"}'
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={handleMockRequest}
                          className="rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2 py-1 text-[10px] text-desktop-text-secondary hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                        >
                          {t.featureExplorer.runMock}
                        </button>
                        <button
                          onClick={handleLiveRequest}
                          className="inline-flex items-center gap-1 rounded-sm border border-desktop-accent bg-desktop-bg-active px-2 py-1 text-[10px] text-desktop-text-primary"
                        >
                          <Braces className="h-3 w-3" />
                          {t.featureExplorer.tryLiveRequest}
                        </button>
                        <div className="text-[10px] text-desktop-text-secondary">
                          {activeApiPreset.expectedStatus} · {requestState}
                        </div>
                      </div>
                    </ContextSection>

                    <ContextSection title={t.featureExplorer.response}>
                      <pre className="overflow-x-auto rounded-sm border border-desktop-border bg-desktop-bg-secondary p-2 text-[11px] leading-5 text-desktop-text-primary">
                        {responseBody || activeApiPreset.responseExample}
                      </pre>
                    </ContextSection>
                  </div>
                )}
              </div>

              <div className="border-t border-desktop-border bg-desktop-bg-secondary/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => router.push(`/workspace/${encodeURIComponent(workspaceId)}/sessions`)}
                    className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[11px] font-medium text-desktop-text-secondary transition-colors hover:bg-desktop-bg-active hover:text-desktop-text-primary"
                  >
                    {t.featureExplorer.openSessions}
                  </button>
                  <button
                    onClick={handleCopyContext}
                    className="rounded-sm border border-desktop-accent bg-desktop-bg-active px-2.5 py-1 text-[11px] font-medium text-desktop-text-primary transition-colors hover:bg-desktop-bg-primary"
                  >
                    {copyState === "done" ? t.featureExplorer.copied : t.featureExplorer.copyContext}
                  </button>
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </DesktopAppShell>
  );
}

function TreeNodeRow({
  node,
  depth,
  expandedIds,
  activeFileId,
  selectedFileIds,
  onToggleNode,
  onToggleFileSelection,
  onSetActiveFile,
  folderLabel,
  selectedLabel,
  dirtyLabel,
}: {
  node: FileNode;
  depth: number;
  expandedIds: Record<string, boolean>;
  activeFileId: string;
  selectedFileIds: string[];
  onToggleNode: (nodeId: string) => void;
  onToggleFileSelection: (fileId: string) => void;
  onSetActiveFile: (fileId: string) => void;
  folderLabel: string;
  selectedLabel: string;
  dirtyLabel: string;
}) {
  const paddingLeft = 16 + depth * 18;

  if (node.kind === "folder") {
    const isExpanded = expandedIds[node.id] ?? true;
    const leafIds = collectLeafIds(node);
    const selectedLeafCount = leafIds.filter((id) => selectedFileIds.includes(id)).length;

    return (
      <>
        <div className="grid grid-cols-[minmax(0,1fr)_72px_64px_92px] items-center px-3 py-1.5 text-xs text-desktop-text-primary">
          <button
            onClick={() => onToggleNode(node.id)}
            className="flex items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-desktop-bg-active"
            style={{ paddingLeft }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-desktop-text-secondary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-desktop-text-secondary" />
            )}
            <Folder className="h-4 w-4 text-amber-400" />
            <span>{node.name}</span>
          </button>
          <div className="text-xs text-desktop-text-secondary">-</div>
          <div className="text-xs text-desktop-text-secondary">
            {selectedLeafCount > 0 ? `${selectedLeafCount} ${selectedLabel}` : "-"}
          </div>
          <div className="inline-flex items-center gap-1 text-xs text-desktop-text-secondary">
            <Clock3 className="h-3.5 w-3.5" />
            {folderLabel}
          </div>
        </div>

        {isExpanded &&
          node.children?.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              activeFileId={activeFileId}
              selectedFileIds={selectedFileIds}
              onToggleNode={onToggleNode}
              onToggleFileSelection={onToggleFileSelection}
              onSetActiveFile={onSetActiveFile}
              folderLabel={folderLabel}
              selectedLabel={selectedLabel}
              dirtyLabel={dirtyLabel}
            />
          ))}
      </>
    );
  }

  const isActive = activeFileId === node.id;
  const isSelected = selectedFileIds.includes(node.id);

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_72px_64px_92px] items-center px-3 py-1.5 text-xs transition-colors ${
        isActive
          ? "bg-desktop-bg-active"
          : "hover:bg-desktop-bg-secondary/40"
      }`}
    >
      <div className="flex items-center gap-2" style={{ paddingLeft }}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleFileSelection(node.id)}
          className="h-3.5 w-3.5 rounded border-black/15 bg-transparent dark:border-white/20"
        />
        <button onClick={() => onSetActiveFile(node.id)} className="flex min-w-0 items-center gap-2 text-left">
          {node.path.endsWith(".json") ? (
            <FileJson2 className="h-4 w-4 shrink-0 text-amber-400" />
          ) : node.path.endsWith(".md") ? (
            <FileText className="h-4 w-4 shrink-0 text-violet-400" />
          ) : (
            <FileCode2 className="h-4 w-4 shrink-0 text-sky-400" />
          )}
          <span className="truncate text-desktop-text-primary">{node.name}</span>
          {node.metric?.dirty ? (
            <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              {dirtyLabel}
            </span>
          ) : null}
        </button>
      </div>

      <div className="text-xs">
        {node.metric ? (
          <>
            <span className="text-emerald-300">+{node.metric.plus}</span>{" "}
            <span className="text-rose-300">-{node.metric.minus}</span>
          </>
        ) : (
          <span className="text-desktop-text-secondary">-</span>
        )}
      </div>
      <div className="text-xs text-desktop-text-secondary">{node.metric?.sessions ?? "-"}</div>
      <div className="text-xs text-desktop-text-secondary">{node.metric?.updatedAt ?? "-"}</div>
    </div>
  );
}

function ContextSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-sm border border-desktop-border bg-desktop-bg-primary p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">
        {title}
      </div>
      {children}
    </section>
  );
}

function SummaryPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-desktop-border bg-desktop-bg-secondary px-2.5 py-1 text-[11px] font-medium text-desktop-text-secondary">
      {children}
    </span>
  );
}
