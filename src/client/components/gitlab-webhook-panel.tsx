"use client";

/**
 * GitLab Webhook Configuration Panel
 *
 * Allows users to:
 * - View and manage GitLab webhook trigger configurations
 * - Create configs (project, events, trigger agent, token, secret)
 * - View trigger logs
 *
 * Modeled after GitHubWebhookPanel with GitLab-specific adaptations.
 */

import { useState, useEffect, useCallback } from "react";
import { Select } from "./select";
import { useTranslation } from "@/i18n";
import type { TranslationDictionary } from "@/i18n/types";
import { desktopAwareFetch, getDesktopApiBaseUrl } from "@/client/utils/diagnostics";
import { Plus, RefreshCw, SquarePen, Trash2, Link2, Circle, CircleOff } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitLabWebhookConfig {
  id: string;
  name: string;
  repo: string;
  gitlabToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string[];
  triggerAgentId: string;
  workspaceId?: string;
  enabled: boolean;
  promptTemplate?: string;
  gitlabServerUrl: string;
  gitlabProjectId: string;
  createdAt: string;
  updatedAt: string;
}

interface TriggerLog {
  id: string;
  configId: string;
  eventType: string;
  eventAction?: string;
  backgroundTaskId?: string;
  signatureValid: boolean;
  outcome: "triggered" | "skipped" | "error";
  errorMessage?: string;
  createdAt: string;
}

interface GitLabFormState {
  name: string;
  repo: string;
  gitlabToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string;
  triggerAgentId: string;
  enabled: boolean;
  promptTemplate: string;
  gitlabServerUrl: string;
  gitlabProjectId: string;
}

interface SpecialistOption {
  id: string;
  name: string;
  description?: string;
}

const GITLAB_EVENTS = [
  { value: "push_events", labelKey: "pushEvents", descriptionKey: "pushEventsDesc" },
  { value: "merge_requests_events", labelKey: "mergeRequestEvents", descriptionKey: "mergeRequestEventsDesc" },
  { value: "issues_events", labelKey: "issueEvents", descriptionKey: "issueEventsDesc" },
  { value: "note_events", labelKey: "noteEvents", descriptionKey: "noteEventsDesc" },
  { value: "pipeline_events", labelKey: "pipelineEvents", descriptionKey: "pipelineEventsDesc" },
  { value: "tag_push_events", labelKey: "tagPushEvents", descriptionKey: "tagPushEventsDesc" },
  { value: "wiki_page_events", labelKey: "wikiPageEvents", descriptionKey: "wikiPageEventsDesc" },
];

const EMPTY_FORM: GitLabFormState = {
  name: "",
  repo: "",
  gitlabToken: "",
  webhookSecret: "",
  eventTypes: ["push_events", "merge_requests_events"],
  labelFilter: "",
  triggerAgentId: "claude-code",
  enabled: true,
  promptTemplate: "",
  gitlabServerUrl: "https://gitlab.com",
  gitlabProjectId: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function GitLabWebhookPanel() {
  const { t } = useTranslation();
  const wt = t.webhook;
  const [configs, setConfigs] = useState<GitLabWebhookConfig[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<GitLabFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"configs" | "logs">("configs");

  useEffect(() => {
    const backendBase = getDesktopApiBaseUrl();
    setServerUrl(backendBase || window.location.origin);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cfgRes, logRes, specRes] = await Promise.all([
        desktopAwareFetch("/api/webhooks/gitlab/configs"),
        desktopAwareFetch("/api/webhooks/webhook-logs?limit=50&platform=gitlab"),
        desktopAwareFetch("/api/specialists"),
      ]);
      if (cfgRes.ok) {
        const data = await cfgRes.json();
        setConfigs(data.configs ?? []);
      }
      if (logRes.ok) {
        const data = await logRes.json();
        setLogs(data.logs ?? []);
      }
      if (specRes.ok) {
        const data = await specRes.json();
        setSpecialists((data.specialists ?? []).filter((s: SpecialistOption & { enabled: boolean }) => s.enabled !== false));
      }
    } catch (err) {
      console.error("Failed to load GitLab webhook data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(true);
    setError(null);
  }

  function openEdit(config: GitLabWebhookConfig) {
    setForm({
      name: config.name,
      repo: config.repo,
      gitlabToken: "",
      webhookSecret: config.webhookSecret,
      eventTypes: config.eventTypes,
      labelFilter: (config.labelFilter ?? []).join(", "),
      triggerAgentId: config.triggerAgentId,
      enabled: config.enabled,
      promptTemplate: config.promptTemplate ?? "",
      gitlabServerUrl: config.gitlabServerUrl || "https://gitlab.com",
      gitlabProjectId: config.gitlabProjectId || config.repo,
    });
    setEditId(config.id);
    setShowForm(true);
    setError(null);
  }

  function toggleEvent(ev: string) {
    setForm((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(ev)
        ? prev.eventTypes.filter((e) => e !== ev)
        : [...prev.eventTypes, ev],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.repo || !form.triggerAgentId || form.eventTypes.length === 0) {
      setError(wt.requiredFieldsError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name,
        repo: form.repo,
        ...(form.gitlabToken ? { gitlabToken: form.gitlabToken } : {}),
        webhookSecret: form.webhookSecret,
        eventTypes: form.eventTypes,
        labelFilter: form.labelFilter
          ? form.labelFilter.split(",").map((l) => l.trim()).filter(Boolean)
          : [],
        triggerAgentId: form.triggerAgentId,
        enabled: form.enabled,
        promptTemplate: form.promptTemplate || undefined,
        gitlabServerUrl: form.gitlabServerUrl || "https://gitlab.com",
        gitlabProjectId: form.gitlabProjectId || form.repo,
      };

      const res = await desktopAwareFetch("/api/webhooks/gitlab/configs", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setSuccess(editId ? wt.configUpdated : wt.configCreated);
      setShowForm(false);
      setEditId(null);
      await loadData();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(wt.deleteConfirm)) return;
    try {
      const res = await desktopAwareFetch(`/api/webhooks/gitlab/configs?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess(wt.configDeleted);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleToggleEnabled(config: GitLabWebhookConfig) {
    try {
      const res = await desktopAwareFetch("/api/webhooks/gitlab/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: config.id, enabled: !config.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Alerts */}
      {error && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}
      {success && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">✓</span>
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto shrink-0 text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      )}

      {/* Header actions */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
          {(["configs", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {tab === "configs" ? wt.tabs.configurations : wt.tabs.triggerLogs}
            </button>
          ))}
        </div>

        {activeTab === "configs" && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {wt.addTrigger}
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "configs" && (
          <>
            {/* GitLab server info */}
            <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/10 rounded-lg border border-orange-200 dark:border-orange-800/50">
              <p className="text-xs text-orange-700 dark:text-orange-300">
                <span className="font-semibold">{wt.gitlabWebhookUrl}:</span>{" "}
                <code className="font-mono bg-orange-100 dark:bg-orange-900/30 px-1 rounded">
                  {serverUrl}/api/webhooks/gitlab
                </code>
              </p>
              <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                {wt.gitlabServerUrl}: <code className="font-mono bg-orange-100 dark:bg-orange-900/30 px-1 rounded">{form.gitlabServerUrl || "https://gitlab.com"}</code>
              </p>
            </div>

            {showForm && (
              <GitLabConfigForm
                form={form}
                setForm={setForm}
                editId={editId}
                saving={saving}
                specialists={specialists}
                onSubmit={handleSubmit}
                onCancel={() => { setShowForm(false); setEditId(null); setError(null); }}
                toggleEvent={toggleEvent}
              />
            )}

            {!showForm && (
              <>
                {loading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    <div className="w-5 h-5 border-2 border-slate-300 dark:border-slate-600 border-t-orange-500 rounded-full animate-spin mr-2" />
                    {wt.loading}
                  </div>
                ) : configs.length === 0 ? (
                  <GitLabEmptyState onAdd={openCreate} t={wt} />
                ) : (
                  <div className="space-y-3 mt-2">
                    {configs.map((config) => (
                      <GitLabConfigCard
                        key={config.id}
                        config={config}
                        onEdit={() => openEdit(config)}
                        onDelete={() => handleDelete(config.id)}
                        onToggle={() => handleToggleEnabled(config)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "logs" && (
          <TriggerLogsTable logs={logs} configs={configs} onRefresh={loadData} />
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function GitLabEmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationDictionary["webhook"] }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/20 rounded-2xl flex items-center justify-center mb-4">
        <Link2 className="w-8 h-8 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
      </div>
      <h3 className="text-base font-medium text-slate-900 dark:text-slate-100 mb-1">{t.gitlabEmptyTitle}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-4">
        {t.gitlabEmptyDescription}
      </p>
      <button
        onClick={onAdd}
        className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg transition-colors"
      >
        {t.addFirstTrigger}
      </button>
    </div>
  );
}

interface GitLabConfigFormProps {
  form: GitLabFormState;
  setForm: React.Dispatch<React.SetStateAction<GitLabFormState>>;
  editId: string | null;
  saving: boolean;
  specialists: SpecialistOption[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  toggleEvent: (ev: string) => void;
}

function GitLabConfigForm({ form, setForm, editId, saving, specialists, onSubmit, onCancel, toggleEvent }: GitLabConfigFormProps) {
  const { t } = useTranslation();
  const wt = t.webhook;
  return (
    <form onSubmit={onSubmit} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-5 mt-2 space-y-4">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {editId ? wt.editWebhookTrigger : wt.newWebhookTrigger}
      </h3>

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.nameLabel} <span className="text-red-500">*</span>
        </label>
        <input
          data-testid="gitlab-webhook-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder={wt.namePlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
          required
        />
      </div>

      {/* GitLab Server URL */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.gitlabServerUrl}
          <span className="ml-1 text-slate-400 font-normal">{wt.gitlabServerUrlHint}</span>
        </label>
        <input
          data-testid="gitlab-server-url"
          type="text"
          value={form.gitlabServerUrl}
          onChange={(e) => setForm((p) => ({ ...p, gitlabServerUrl: e.target.value }))}
          placeholder="https://gitlab.com"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
        />
      </div>

      {/* GitLab Project ID */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.gitlabProjectId} <span className="text-red-500">*</span>
          <span className="ml-1 text-slate-400 font-normal">{wt.gitlabProjectIdHint}</span>
        </label>
        <input
          data-testid="gitlab-project-id"
          type="text"
          value={form.gitlabProjectId || form.repo}
          onChange={(e) => setForm((p) => ({ ...p, gitlabProjectId: e.target.value, repo: e.target.value }))}
          placeholder="namespace/project or 12345"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
          required
        />
      </div>

      {/* GitLab Token */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.gitlabToken} <span className="text-red-500">{editId ? "" : "*"}</span>
          {editId && <span className="ml-1 text-slate-400 font-normal">{wt.tokenKeepHint}</span>}
        </label>
        <input
          data-testid="gitlab-token"
          type="password"
          value={form.gitlabToken}
          onChange={(e) => setForm((p) => ({ ...p, gitlabToken: e.target.value }))}
          placeholder={editId ? wt.tokenEditPlaceholder : "glpat-..."}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
          required={!editId}
        />
      </div>

      {/* Webhook Secret */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.gitlabWebhookSecret}
          <span className="ml-1 text-slate-400 font-normal">{wt.secretHint}</span>
        </label>
        <input
          data-testid="gitlab-webhook-secret"
          type="text"
          value={form.webhookSecret}
          onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
          placeholder="gitlab-webhook-secret-2026"
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
        />
      </div>

      {/* Events */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
          {wt.eventsToSubscribe} <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {GITLAB_EVENTS.map((ev) => (
            <label
              key={ev.value}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                form.eventTypes.includes(ev.value)
                  ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-500"
                  : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
              }`}
            >
              <input
                type="checkbox"
                data-testid={`gitlab-event-${ev.value}`}
                checked={form.eventTypes.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="mt-0.5 accent-orange-600"
              />
              <div>
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100">
                  {wt.gitlabTriggerTypes[ev.labelKey as keyof typeof wt.gitlabTriggerTypes]}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {wt.gitlabTriggerTypes[ev.descriptionKey as keyof typeof wt.gitlabTriggerTypes]}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Label filter */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.labelFilter}
          <span className="ml-1 text-slate-400 font-normal">{wt.labelFilterHint}</span>
        </label>
        <input
          data-testid="gitlab-label-filter"
          type="text"
          value={form.labelFilter}
          onChange={(e) => setForm((p) => ({ ...p, labelFilter: e.target.value }))}
          placeholder={wt.labelFilterPlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
        />
      </div>

      {/* Trigger Agent */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.triggerAgent} <span className="text-red-500">*</span>
        </label>
        <Select
          data-testid="gitlab-webhook-agent"
          value={form.triggerAgentId}
          onChange={(e) => setForm((p) => ({ ...p, triggerAgentId: e.target.value }))}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100"
          required
        >
          <option value="">{wt.selectAgent}</option>
          {specialists.length > 0 ? (
            specialists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>
            ))
          ) : (
            <>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
              <option value="developer">Developer</option>
            </>
          )}
        </Select>
      </div>

      {/* Prompt Template */}
      <div>
        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
          {wt.promptTemplate}
          <span className="ml-1 text-slate-400 font-normal">{wt.promptTemplateHint}</span>
        </label>
        <textarea
          data-testid="gitlab-webhook-prompt"
          value={form.promptTemplate}
          onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
          rows={3}
          placeholder={wt.promptTemplatePlaceholder}
          className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 dark:text-slate-100 resize-none"
        />
      </div>

      {/* Enabled */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          data-testid="gitlab-webhook-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          className="accent-orange-600"
        />
        <span className="text-sm text-slate-700 dark:text-slate-300">{wt.enabled}</span>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          data-testid="gitlab-webhook-submit"
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {saving ? `${t.common.loading}…` : editId ? t.common.update : t.common.create}
        </button>
      </div>
    </form>
  );
}

interface GitLabConfigCardProps {
  config: GitLabWebhookConfig;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

function GitLabConfigCard({ config, onEdit, onDelete, onToggle }: GitLabConfigCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`bg-white dark:bg-slate-800/50 border rounded-xl p-4 transition-colors ${
      config.enabled
        ? "border-slate-200 dark:border-slate-700"
        : "border-slate-100 dark:border-slate-800 opacity-60"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${config.enabled ? "bg-orange-500" : "bg-slate-400"}`} />
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{config.name}</h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 ml-4">
            <span className="font-medium text-slate-700 dark:text-slate-300">{config.gitlabProjectId || config.repo}</span>
            <span className="mx-1 text-slate-400">|</span>
            <span className="text-slate-500 dark:text-slate-400">{config.gitlabServerUrl}</span>
            {" → "}
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 inline-block">🤖</span>
              {config.triggerAgentId}
            </span>
          </p>
          <div className="ml-4 flex flex-wrap gap-1">
            {config.eventTypes.map((ev) => (
              <span key={ev} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border border-orange-100 dark:border-orange-800">
                {ev}
              </span>
            ))}
            {(config.labelFilter ?? []).length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-900/30 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                labels: {config.labelFilter.join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Enabled toggle */}
        <button
          onClick={onToggle}
          title={config.enabled ? t.webhook.disable : t.webhook.enable}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        >
          {config.enabled ? (
            <CircleOff className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          ) : (
            <Circle className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          )}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
        >
          <SquarePen className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.edit}
        </button>

        <button
          onClick={onDelete}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors ml-auto"
        >
          <Trash2 className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.delete}
        </button>
      </div>
    </div>
  );
}

interface TriggerLogsTableProps {
  logs: TriggerLog[];
  configs: GitLabWebhookConfig[];
  onRefresh: () => void;
}

function TriggerLogsTable({ logs, configs, onRefresh }: TriggerLogsTableProps) {
  const { t } = useTranslation();
  const wt = t.webhook;
  const configMap = Object.fromEntries(configs.map((c) => [c.id, c.name]));

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">{logs.length} {wt.recentEvents}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <RefreshCw className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {wt.refresh}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">{wt.noEventsYet}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{wt.noEventsHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                log.outcome === "triggered" ? "bg-emerald-500" :
                log.outcome === "skipped" ? "bg-amber-400" : "bg-red-500"
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                  {log.eventType}{log.eventAction ? ` · ${log.eventAction}` : ""}
                  <span className="ml-1.5 text-slate-400 font-normal">
                    {configMap[log.configId] ?? log.configId}
                  </span>
                </p>
                {log.errorMessage && (
                  <p className="text-xs text-red-500 truncate">{log.errorMessage}</p>
                )}
                {log.backgroundTaskId && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{wt.taskLabel}: {log.backgroundTaskId}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-slate-400">
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
