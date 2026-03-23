"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { desktopAwareFetch } from "../utils/diagnostics";
import {
  SPECIALIST_CATEGORY_OPTIONS,
  getSpecialistCategory,
  type SpecialistCategory,
} from "../utils/specialist-categories";
import type { AgentRole, SpecialistConfig } from "./specialist-manager";
import type { ModelTier } from "./specialist-manager";
import {
  EMPTY_SPECIALIST_FORM,
  ROLE_CHIP,
  SETTINGS_PANEL_BODY_MAX_HEIGHT,
  TIER_LABELS,
  inputCls,
  labelCls,
  sectionHeadCls,
  type ModelDefinition,
  type SpecialistForm,
} from "./settings-panel-shared";

type SpecialistsTabProps = {
  modelDefs: ModelDefinition[];
};

export function SpecialistsTab({ modelDefs }: SpecialistsTabProps) {
  const [specialists, setSpecialists] = useState<SpecialistConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SpecialistForm>(EMPTY_SPECIALIST_FORM);
  const datalistId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists");
      if (!response.ok) {
        setError(
          response.status === 501
            ? "Specialist editing requires Postgres; local SQLite uses bundled/file-based specialists"
            : "Failed to load specialists",
        );
        return;
      }
      const data = await response.json();
      setSpecialists(data.specialists ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await desktopAwareFetch("/api/specialists", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, model: form.model || undefined }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Save failed");
      }
      await load();
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_SPECIALIST_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete specialist "${name}"?`)) return;
    setLoading(true);
    try {
      await desktopAwareFetch(`/api/specialists?id=${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (specialist: SpecialistConfig) => {
    setEditingId(specialist.id);
    setForm({
      id: specialist.id,
      name: specialist.name,
      description: specialist.description ?? "",
      role: specialist.role,
      defaultModelTier: specialist.defaultModelTier,
      systemPrompt: specialist.systemPrompt,
      roleReminder: specialist.roleReminder,
      model: specialist.model ?? "",
    });
    setShowForm(true);
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      await desktopAwareFetch("/api/specialists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  };

  const groupedSpecialists: Array<{
    category: Exclude<SpecialistCategory, "all">;
    label: string;
    specialists: SpecialistConfig[];
  }> = SPECIALIST_CATEGORY_OPTIONS
    .filter((option) => option.id !== "all")
    .map((option) => ({
      category: option.id as Exclude<SpecialistCategory, "all">,
      label: option.label,
      specialists: specialists.filter((specialist) => getSpecialistCategory(specialist.id) === option.id),
    }))
    .filter((group) => group.specialists.length > 0);

  if (showForm) {
    return (
      <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
        <div className="flex items-center gap-2 mb-1">
          <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_SPECIALIST_FORM); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className={sectionHeadCls}>{editingId ? "Edit Specialist" : "New Specialist"}</p>
        </div>
        {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>ID *</label>
              <input type="text" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })}
                disabled={!!editingId} placeholder="my-specialist" className={`${inputCls} disabled:opacity-50`} />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Name *</label>
              <input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="My Custom Specialist" className={inputCls} />
            </div>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Description</label>
            <input type="text" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Brief description" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelCls}>Role *</label>
              <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AgentRole })} className={inputCls}>
                {(["ROUTA", "CRAFTER", "GATE", "DEVELOPER"] as AgentRole[]).map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Model Tier *</label>
              <select value={form.defaultModelTier} onChange={(event) => setForm({ ...form, defaultModelTier: event.target.value as ModelTier })} className={inputCls}>
                {(["FAST", "BALANCED", "SMART"] as ModelTier[]).map((tier) => (
                  <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Model Override</label>
            <input type="text" list={datalistId} value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder="alias or model ID (optional)" className={`${inputCls} font-mono`} />
            <datalist id={datalistId}>
              {modelDefs.map((definition) => <option key={definition.alias} value={definition.alias} label={`${definition.alias} → ${definition.modelName}`} />)}
            </datalist>
            <p className="text-[10px] text-gray-400 dark:text-gray-500">Select a model alias from the Models tab, or enter a raw model ID.</p>
          </div>
          <div className="space-y-1">
            <label className={labelCls}>System Prompt *</label>
            <textarea value={form.systemPrompt} onChange={(event) => setForm({ ...form, systemPrompt: event.target.value })}
              placeholder="Enter the system prompt for this specialist..." rows={7} className={`${inputCls} font-mono`} />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Role Reminder</label>
            <input type="text" value={form.roleReminder} onChange={(event) => setForm({ ...form, roleReminder: event.target.value })}
              placeholder="Short reminder shown to the agent" className={inputCls} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={loading || !form.id || !form.name || !form.systemPrompt}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {loading ? "Saving…" : editingId ? "Update" : "Create"}
            </button>
            <button onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_SPECIALIST_FORM); }}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-3 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
      <div className="flex items-center justify-between">
        <div>
          <p className={sectionHeadCls}>Specialists ({specialists.length})</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Custom agent configurations with tailored prompts and models.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleSync} disabled={loading}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {loading ? "…" : "Sync Bundled"}
          </button>
          <button onClick={() => { setForm(EMPTY_SPECIALIST_FORM); setEditingId(null); setShowForm(true); }}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
        </div>
      </div>
      {error && <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">{error}</div>}
      {loading && specialists.length === 0 && <p className="text-center text-xs text-gray-400 py-6">Loading…</p>}
      <div className="space-y-4">
        {groupedSpecialists.map((group) => (
          <div key={group.category} className="space-y-2">
            <div className="flex items-center gap-2">
              <p className={sectionHeadCls}>{group.label}</p>
              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {group.specialists.length}
              </span>
            </div>
            <div className="space-y-2">
              {group.specialists.map((specialist) => (
                <div key={specialist.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{specialist.name}</span>
                        <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${ROLE_CHIP[specialist.role]}`}>{specialist.role}</span>
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${specialist.source === "user" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"}`}>
                          {specialist.source}
                        </span>
                        {specialist.model && <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-mono truncate max-w-[120px]">{specialist.model}</span>}
                      </div>
                      {specialist.description && <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{specialist.description}</p>}
                      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                        Tier: {TIER_LABELS[specialist.defaultModelTier]} · ID: <span className="font-mono">{specialist.id}</span>
                      </p>
                    </div>
                    {specialist.source === "user" && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => handleEdit(specialist)}
                          className="p-1.5 rounded text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" title="Edit">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(specialist.id, specialist.name)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {specialists.length === 0 && !loading && !error && (
        <div className="text-center py-8">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No specialists yet.</p>
          <button onClick={handleSync} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
            Sync bundled specialists to get started
          </button>
        </div>
      )}
    </div>
  );
}
