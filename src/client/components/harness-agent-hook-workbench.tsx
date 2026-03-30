"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch } from "react";
import { CodeViewer } from "@/client/components/codemirror/code-viewer";
import { HarnessUnsupportedState } from "@/client/components/harness-support-state";
import type { AgentHooksResponse } from "@/client/hooks/use-harness-settings-data";
import {
  buildAgentHookWorkbenchEntries,
  buildAgentHookConfigSource,
  getDefaultAgentHookEntry,
  groupAgentHookEntries,
  type AgentHookWorkbenchEntry,
} from "./harness-agent-hook-workbench-model";

type AgentHookWorkbenchProps = {
  data: AgentHooksResponse;
  unsupportedMessage?: string | null;
};

type WorkbenchState = {
  contextKey: string;
  selectedEvent: string;
};

type WorkbenchAction =
  | { type: "sync"; contextKey: string; events: string[]; defaultEvent: string }
  | { type: "select-event"; event: string };

type WorkbenchContextValue = {
  state: WorkbenchState;
  dispatch: Dispatch<WorkbenchAction>;
  activeEntry: AgentHookWorkbenchEntry | null;
  groupedEntries: ReturnType<typeof groupAgentHookEntries>;
  data: AgentHooksResponse;
};

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function createInitialState(contextKey: string, defaultEvent: string): WorkbenchState {
  return {
    contextKey,
    selectedEvent: defaultEvent,
  };
}

function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case "sync": {
      const selectedStillExists = action.events.includes(state.selectedEvent);
      if (state.contextKey !== action.contextKey) {
        return createInitialState(action.contextKey, action.defaultEvent);
      }
      if (selectedStillExists) {
        return state;
      }
      return { ...state, selectedEvent: action.defaultEvent };
    }
    case "select-event":
      return { ...state, selectedEvent: action.event };
    default:
      return state;
  }
}

function useWorkbenchContext() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error("HarnessAgentHookWorkbench context is missing");
  }
  return context;
}

function AgentHookLifecycleRail() {
  const { activeEntry, dispatch, groupedEntries } = useWorkbenchContext();

  return (
    <aside className="rounded-[28px] border border-desktop-border bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.78)_24%,rgba(240,246,255,0.82)_100%)] p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Lifecycle</div>
          <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">Agent hook map</h3>
        </div>
        <div className="rounded-full border border-desktop-border bg-white/80 px-2.5 py-1 text-[10px] text-desktop-text-secondary">
          {groupedEntries.reduce((sum, group) => sum + group.entries.length, 0)} events
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {groupedEntries.map((group) => (
          <section key={group.group}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold text-desktop-text-primary">{group.label}</div>
              <div className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                {group.entries.length}
              </div>
            </div>

            <div className="mt-1.5 space-y-1.5">
              {group.entries.map((entry) => {
                const selected = activeEntry?.event === entry.event;
                return (
                  <button
                    key={entry.event}
                    type="button"
                    onClick={() => dispatch({ type: "select-event", event: entry.event })}
                    className={`w-full rounded-xl border px-2.5 py-2 text-left transition ${
                      selected
                        ? "border-sky-300 bg-sky-50/80 shadow-sm"
                        : "border-desktop-border bg-white/85 hover:bg-desktop-bg-primary"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 truncate text-[11px] font-semibold text-desktop-text-primary">{entry.event}</div>
                      <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${
                        entry.stats.hookCount > 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}>
                        {entry.stats.hookCount > 0 ? `${entry.stats.hookCount}` : "–"}
                      </span>
                    </div>
                    {entry.stats.hookCount > 0 && entry.stats.blockingCount > 0 ? (
                      <div className="mt-1 flex gap-1">
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                          {entry.stats.blockingCount} blocking
                        </span>
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

function AgentHookInspector() {
  const { activeEntry, data } = useWorkbenchContext();

  const configSource = useMemo(() => {
    if (!activeEntry) return "";
    return buildAgentHookConfigSource(activeEntry);
  }, [activeEntry]);

  return (
    <aside className="rounded-[28px] border border-desktop-border bg-[radial-gradient(circle_at_top,#ffffff,rgba(255,255,255,0.78)_24%,rgba(240,246,255,0.82)_100%)] p-4 shadow-sm">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-desktop-text-secondary">Inspector</div>
        <h3 className="mt-1 text-sm font-semibold text-desktop-text-primary">
          {activeEntry?.event ?? "Event details"}
        </h3>
      </div>

      <div className="mt-4 space-y-2">
        {data.warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Warnings</div>
            <ul className="mt-1 space-y-1">
              {data.warnings.map((warning) => (
                <li key={warning} className="text-[11px] text-amber-700">• {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {activeEntry ? (
          activeEntry.hooks.length === 0 ? (
            <div className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3 text-[11px] text-desktop-text-secondary">
              No hooks configured for this event.
            </div>
          ) : (
            activeEntry.hooks.map((hook, index) => (
              <div key={`${hook.event}:${index}`} className="rounded-xl border border-desktop-border bg-desktop-bg-primary/80 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-desktop-text-primary">
                      {hook.description || `${hook.type} hook`}
                    </div>
                    {hook.matcher ? (
                      <div className="mt-0.5 text-[10px] text-desktop-text-secondary">
                        matcher: <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{hook.matcher}</code>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {hook.blocking ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-800">blocking</span>
                    ) : null}
                    <span className="rounded-full border border-desktop-border bg-desktop-bg-secondary px-2 py-0.5 text-[10px] text-desktop-text-secondary">
                      {hook.type}
                    </span>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5 text-[10px] text-desktop-text-secondary">
                  {hook.command ? <div>command: <code className="break-all rounded bg-slate-100 px-1 py-0.5">{hook.command}</code></div> : null}
                  {hook.url ? <div>url: <code className="rounded bg-slate-100 px-1 py-0.5">{hook.url}</code></div> : null}
                  {hook.prompt ? <div>prompt: <code className="rounded bg-slate-100 px-1 py-0.5">{hook.prompt}</code></div> : null}
                  <div>timeout: {hook.timeout}s</div>
                  {hook.source ? (
                    <div>source: <span className="font-medium text-sky-600">{hook.source}</span></div>
                  ) : null}
                </div>
              </div>
            ))
          )
        ) : null}

        {activeEntry && configSource ? (
          <div className="overflow-hidden rounded-xl border border-desktop-border">
            <CodeViewer
              code={configSource}
              language="yaml"
              maxHeight="320px"
              showHeader={false}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function HarnessAgentHookWorkbench({
  data,
  unsupportedMessage,
}: AgentHookWorkbenchProps) {
  const entries = useMemo(() => buildAgentHookWorkbenchEntries(data), [data]);
  const groupedEntries = useMemo(() => groupAgentHookEntries(entries), [entries]);
  const defaultEntry = useMemo(() => getDefaultAgentHookEntry(entries), [entries]);
  const contextKey = data.generatedAt ?? "";

  const [state, dispatch] = useReducer(
    workbenchReducer,
    createInitialState(contextKey, defaultEntry?.event ?? ""),
  );

  useEffect(() => {
    dispatch({
      type: "sync",
      contextKey,
      events: entries.map((entry) => entry.event),
      defaultEvent: defaultEntry?.event ?? "",
    });
  }, [contextKey, defaultEntry?.event, entries]);

  const activeEntry = useMemo(
    () => entries.find((entry) => entry.event === state.selectedEvent) ?? null,
    [entries, state.selectedEvent],
  );

  const contextValue = useMemo<WorkbenchContextValue>(() => ({
    state,
    dispatch,
    activeEntry,
    groupedEntries,
    data,
  }), [activeEntry, data, groupedEntries, state]);

  if (unsupportedMessage) {
    return <HarnessUnsupportedState />;
  }

  return (
    <WorkbenchContext.Provider value={contextValue}>
      <section className="rounded-2xl border border-desktop-border bg-desktop-bg-secondary/55 p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-desktop-text-secondary">Agent hook system</div>
            <h3 className="mt-0.5 text-sm font-semibold text-desktop-text-primary">Agent Hook Workbench</h3>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {entries.reduce((sum, entry) => sum + entry.stats.hookCount, 0)} hooks
            </span>
            <span className="rounded-full border border-desktop-border bg-desktop-bg-primary px-2.5 py-1 text-[10px] text-desktop-text-secondary">
              {entries.filter((entry) => entry.stats.hookCount > 0).length} / {entries.length} events
            </span>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
          <AgentHookLifecycleRail />
          <AgentHookInspector />
        </div>
      </section>
    </WorkbenchContext.Provider>
  );
}
