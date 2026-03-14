"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { HomeInput } from "@/client/components/home-input";
import {
  ConnectionDot,
  HomeTodoPreview,
  OnboardingCard,
  StoryGuideRail,
  WorkspaceCards,
} from "@/client/components/home-page-sections";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { useAcp } from "@/client/hooks/use-acp";
import { useSkills } from "@/client/hooks/use-skills";
import { SettingsPanel } from "@/client/components/settings-panel";
import { NotificationBell, NotificationProvider } from "@/client/components/notification-center";

export default function HomePage() {
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const skillsHook = useSkills();

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"agents" | undefined>(undefined);
  const [showIntegrationsMenu, setShowIntegrationsMenu] = useState(false);
  const [showWorkspacesMenu, setShowWorkspacesMenu] = useState(false);
  const integrationsRef = useRef<HTMLDivElement>(null);
  const workspacesMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showIntegrationsMenu) return;
    const handler = (event: MouseEvent) => {
      if (integrationsRef.current && !integrationsRef.current.contains(event.target as Node)) {
        setShowIntegrationsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showIntegrationsMenu]);

  useEffect(() => {
    if (!showWorkspacesMenu) return;
    const handler = (event: MouseEvent) => {
      if (workspacesMenuRef.current && !workspacesMenuRef.current.contains(event.target as Node)) {
        setShowWorkspacesMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWorkspacesMenu]);

  useEffect(() => {
    if (!activeWorkspaceId && workspacesHook.workspaces.length > 0) {
      setActiveWorkspaceId(workspacesHook.workspaces[0].id);
    }
  }, [activeWorkspaceId, workspacesHook.workspaces]);

  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  const handleWorkspaceSelect = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setRefreshKey((value) => value + 1);
  }, []);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      handleWorkspaceSelect(workspace.id);
    }
  }, [handleWorkspaceSelect, workspacesHook]);

  const handleSessionClick = useCallback((sessionId: string) => {
    if (activeWorkspaceId) {
      router.push(`/workspace/${activeWorkspaceId}/sessions/${sessionId}`);
      return;
    }
    router.push(`/workspace/${sessionId}`);
  }, [activeWorkspaceId, router]);

  const activeWorkspace = workspacesHook.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const workspaceCount = workspacesHook.workspaces.length;
  const activeWorkspaceHref = activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/workspaces";
  const activeKanbanHref = activeWorkspaceId ? `/workspace/${activeWorkspaceId}/kanban` : "/workspaces";
  const featuredSkills = skillsHook.allSkills.slice(0, 4);
  const displaySkills = skillsHook.allSkills.slice(0, 6);
  const workspaceCounter = workspaceCount.toString().padStart(2, "0");

  return (
    <NotificationProvider>
      <div className="relative flex h-screen flex-col overflow-hidden bg-[#e8eef8] text-[#081120] dark:bg-[#040913] dark:text-gray-100">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(245,249,255,0.96),rgba(232,238,248,0.84))] dark:bg-[linear-gradient(180deg,rgba(5,10,18,0.96),rgba(4,9,19,1))]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(14,90,160,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(14,90,160,0.06)_1px,transparent_1px)] bg-[size:112px_112px] opacity-40 dark:bg-[linear-gradient(rgba(125,211,252,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(125,211,252,0.07)_1px,transparent_1px)] dark:opacity-20" />
          <div className="home-float-slow absolute -left-24 top-8 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,_rgba(56,189,248,0.2),_transparent_68%)] blur-3xl dark:bg-[radial-gradient(circle,_rgba(56,189,248,0.14),_transparent_72%)]" />
          <div className="home-float-delay absolute right-[-10rem] top-[-5rem] h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,_rgba(37,99,235,0.18),_transparent_72%)] blur-3xl dark:bg-[radial-gradient(circle,_rgba(59,130,246,0.2),_transparent_74%)]" />
        </div>

        <header className="relative z-10 flex h-14 shrink-0 items-center border-b border-sky-200/55 bg-white/55 px-3 backdrop-blur-xl sm:px-5 dark:border-white/6 dark:bg-[#040913]/76">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="rounded-xl border border-sky-200/70 bg-white/80 p-1.5 shadow-[0_10px_30px_-18px_rgba(37,99,235,0.45)] dark:border-white/10 dark:bg-white/5">
              <Image src="/logo.svg" alt="Routa" width={22} height={22} className="rounded-md" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold tracking-[0.02em] text-[#081120] dark:text-gray-100">
                Routa
              </div>
              <div className="hidden text-[10px] uppercase tracking-[0.28em] text-[#4c7ec3] sm:block dark:text-sky-400/70">
                Agent Control Grid
              </div>
            </div>
          </div>

          <div className="flex-1" />

          <nav className="flex items-center gap-0.5 sm:gap-1">
            {activeWorkspaceId && (
              <Link
                href={`/workspace/${activeWorkspaceId}/kanban`}
                className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[#46638b] transition-colors hover:bg-sky-100/70 hover:text-[#081120] dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
                title="Open Kanban Board"
              >
                Kanban
              </Link>
            )}

            <div className="relative hidden sm:block" ref={integrationsRef}>
              <button
                onClick={() => setShowIntegrationsMenu((value) => !value)}
                className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${showIntegrationsMenu ? "bg-sky-100/80 text-[#081120] dark:bg-white/6 dark:text-gray-100" : "text-[#46638b] hover:bg-sky-100/70 hover:text-[#081120] dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"}`}
              >
                Integrations
                <svg className="h-2.5 w-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showIntegrationsMenu && (
                <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-sky-200/70 bg-white/95 py-1 shadow-[0_24px_60px_-32px_rgba(37,99,235,0.3)] backdrop-blur dark:border-[#1c1f2e] dark:bg-[#12141c]/95">
                  <Link
                    href="/mcp-tools"
                    onClick={() => setShowIntegrationsMenu(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#1a1d2c]"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
                      M
                    </span>
                    MCP Tools
                  </Link>
                  <Link
                    href="/a2a"
                    onClick={() => setShowIntegrationsMenu(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-[#1a1d2c]"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-100 text-[9px] font-bold text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                      A
                    </span>
                    A2A Protocol
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/settings/webhooks"
              className="hidden rounded-full px-3 py-1.5 text-[11px] font-medium text-[#46638b] transition-colors hover:bg-sky-100/70 hover:text-[#081120] sm:inline-flex dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
            >
              Webhooks
            </Link>
            <Link
              href="/settings/schedules"
              className="hidden rounded-full px-3 py-1.5 text-[11px] font-medium text-[#46638b] transition-colors hover:bg-sky-100/70 hover:text-[#081120] sm:inline-flex dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-100"
            >
              Schedules
            </Link>

            <NotificationBell />

            <button
              onClick={() => {
                setSettingsInitialTab(undefined);
                setShowSettingsPanel(true);
              }}
              className="rounded-full p-2 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/5 dark:hover:text-gray-300"
              title="Settings"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <div className="ml-1 hidden border-l border-black/8 pl-3 sm:ml-2 sm:block dark:border-white/8">
              <ConnectionDot connected={acp.connected} />
            </div>
          </nav>
        </header>

        <main className="relative z-10 flex-1 overflow-y-auto">
          {!workspacesHook.loading && workspacesHook.workspaces.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <OnboardingCard onCreateWorkspace={handleWorkspaceCreate} />
            </div>
          ) : (
            <div className="min-h-full px-3 py-4 sm:px-6 sm:py-8">
              <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-8 lg:gap-10">
                <section className="relative overflow-hidden rounded-[34px] border border-sky-200/75 shadow-[0_60px_160px_-100px_rgba(37,99,235,0.45)] dark:border-[#223049]">
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(250,253,255,0.92),rgba(233,241,252,0.82))] dark:bg-[linear-gradient(180deg,rgba(7,12,21,0.92),rgba(6,11,21,0.98))]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_32%),radial-gradient(circle_at_84%_0%,_rgba(37,99,235,0.14),_transparent_28%),linear-gradient(135deg,_rgba(255,255,255,0.72),_transparent_54%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.14),_transparent_34%),radial-gradient(circle_at_84%_0%,_rgba(59,130,246,0.18),_transparent_30%),linear-gradient(135deg,_rgba(255,255,255,0.04),_transparent_56%)]" />
                  <div className="relative grid gap-0 lg:grid-cols-[minmax(0,1.14fr)_340px]">
                    <div className="relative border-b border-sky-200/80 px-5 py-6 sm:px-8 sm:py-9 lg:border-b-0 lg:border-r lg:px-10 lg:py-11 dark:border-white/8">
                      <div className="mb-6 flex flex-wrap items-center gap-2.5">
                        <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/65 bg-white/78 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#1d6fd6] shadow-sm backdrop-blur dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200">
                          Live Agent Surface
                        </span>
                        <span className="text-xs leading-5 text-[#56739d] dark:text-slate-400">
                          Factory-style pacing, but grounded in the actual product flow.
                        </span>
                      </div>

                      <div className="max-w-5xl">
                        <div className="mb-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.3em] text-[#5b77a0] dark:text-slate-500">
                          <span>Brief</span>
                          <span className="h-px w-10 bg-sky-400/30 dark:bg-white/10" />
                          <span>Route</span>
                          <span className="hidden h-px w-10 bg-sky-400/30 dark:bg-white/10 sm:block" />
                          <span className="hidden sm:inline">Inspect</span>
                        </div>
                        <h1 className="max-w-5xl font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[3rem] font-semibold leading-[0.9] tracking-[-0.06em] text-[#081120] dark:text-white sm:text-[4.1rem] lg:text-[5.6rem]">
                          Brief once.
                          <span className="mt-2 block text-[#1d6fd6] dark:text-[#7dd3fc]">
                            Route many. Inspect the run while it moves.
                          </span>
                        </h1>
                        <p className="mt-6 max-w-3xl text-[15px] leading-8 text-[#4a5f82] dark:text-slate-300 sm:text-[16px]">
                          The homepage now opens with intent, then uses scroll to reveal how Routa expands that intent into orchestration, operations, and traceability.
                        </p>
                      </div>

                      <div className="mt-7 grid gap-3 sm:grid-cols-3">
                        <HeroMetric
                          label="Active Workspaces"
                          value={workspaceCounter}
                          detail={activeWorkspace ? `Current lane: ${activeWorkspace.title}` : "Pick the workspace before sending the next brief"}
                        />
                        <HeroMetric
                          label="Installed Skills"
                          value={skillsHook.allSkills.length.toString().padStart(2, "0")}
                          detail="Inline modules stay close to the composer instead of becoming their own section."
                        />
                        <HeroMetric
                          label="Runtime"
                          value={acp.connected ? "Armed" : "Offline"}
                          detail={acp.connected ? "ACP is connected and ready for launch" : "Reconnect ACP before opening the next run"}
                        />
                      </div>

                      <div className="mt-8 rounded-[32px] border border-sky-200/80 bg-white/70 p-3 shadow-[0_30px_100px_-54px_rgba(37,99,235,0.25)] backdrop-blur-xl dark:border-white/10 dark:bg-[#0a1322]/66 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-100 px-2 pb-3 dark:border-white/8">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#356fb0] dark:text-slate-400">
                              Launch Brief
                            </div>
                            <div className="mt-1 text-sm text-[#4a5f82] dark:text-slate-300">
                              Prompt, provider, workspace, repo scope, and specialist routing in one surface.
                            </div>
                          </div>
                          <div className="rounded-full border border-sky-200/70 bg-sky-50/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[#2b6fc8] dark:border-white/8 dark:bg-white/[0.03] dark:text-slate-400">
                            Scroll below for system flow
                          </div>
                        </div>
                        <div className="pt-4">
                          <HomeInput
                            variant="hero"
                            workspaceId={activeWorkspaceId ?? undefined}
                            onWorkspaceChange={(workspaceId) => {
                              setActiveWorkspaceId(workspaceId);
                              setRefreshKey((value) => value + 1);
                            }}
                            onSessionCreated={() => {
                              setRefreshKey((value) => value + 1);
                            }}
                            displaySkills={displaySkills}
                          />
                        </div>
                      </div>
                    </div>

                    <aside className="relative overflow-hidden bg-[linear-gradient(180deg,#07111f,#09192f)] px-5 py-6 text-white sm:px-8 sm:py-8 lg:px-8 lg:py-10">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(56,189,248,0.24),_transparent_34%),radial-gradient(circle_at_18%_0%,_rgba(37,99,235,0.18),_transparent_28%)]" />
                      <div className="relative">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200/70">
                          Surface Index
                        </div>
                        <div className="mt-4 space-y-3">
                          <SurfaceStage index="01" title="Brief" detail="Start in the composer" />
                          <SurfaceStage index="02" title="Route" detail="Fan out specialists" />
                          <SurfaceStage index="03" title="Operate" detail="Boards as telemetry" />
                          <SurfaceStage index="04" title="Inspect" detail="Logs and artifacts" />
                        </div>

                        <div className="mt-5 rounded-[26px] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                                Current lane
                              </div>
                              <div className="mt-2 text-[1.45rem] font-semibold tracking-tight text-white">
                                {activeWorkspace?.title ?? "No workspace selected"}
                              </div>
                            </div>
                            <span className={`mt-1 inline-flex h-2.5 w-2.5 rounded-full ${activeWorkspace ? "bg-emerald-400" : "bg-amber-300"}`} />
                          </div>
                          <div className="mt-4 rounded-[20px] border border-dashed border-white/10 px-3 py-3 text-sm leading-6 text-slate-300">
                            The next section uses scroll to explain where the user lands after the launch moment.
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3">
                          <Link
                            href={activeKanbanHref}
                            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#5ee5ff] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#04111d] transition-colors hover:bg-[#87edff]"
                          >
                            Open Kanban
                          </Link>
                          <Link
                            href={activeWorkspaceHref}
                            className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.02] px-4 py-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-200 transition-colors hover:bg-white/[0.06]"
                          >
                            Open Workspace
                          </Link>
                        </div>

                        <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                            Featured Modules
                          </div>
                          <div className="mt-3 space-y-2">
                            {featuredSkills.length > 0 ? (
                              featuredSkills.slice(0, 3).map((skill, index) => (
                                <div key={skill.name} className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-3">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sky-400/20 bg-sky-400/10 text-[10px] font-semibold text-sky-300">
                                    0{index + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium text-white">
                                      /{skill.name}
                                    </div>
                                    <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400">
                                      {skill.description}
                                    </div>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm leading-6 text-slate-400">
                                Install or connect skills to make the launch surface more context-aware.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>
                </section>

                <StoryGuideRail
                  activeKanbanHref={activeKanbanHref}
                  activeWorkspaceHref={activeWorkspaceHref}
                  activeWorkspaceTitle={activeWorkspace?.title ?? null}
                  connected={acp.connected}
                  featuredSkills={featuredSkills}
                  skillCount={skillsHook.allSkills.length}
                  workspaceCounter={workspaceCounter}
                />

                <section className="rounded-[34px] border border-sky-200/70 bg-[linear-gradient(180deg,rgba(250,253,255,0.94),rgba(237,245,255,0.9))] p-4 shadow-[0_52px_120px_-80px_rgba(8,34,78,0.24)] dark:border-[#1b2b44] dark:bg-[linear-gradient(180deg,rgba(6,11,21,0.96),rgba(8,13,24,0.98))] sm:p-6">
                  <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-2xl">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#3868aa] dark:text-sky-300/80">
                        Operational Surface
                      </div>
                      <h2 className="mt-3 font-['Avenir_Next_Condensed','Avenir_Next','Segoe_UI','Helvetica_Neue',sans-serif] text-[2.2rem] font-semibold leading-[0.94] tracking-[-0.05em] text-[#081120] dark:text-white sm:text-[3rem]">
                        Keep the real data below the narrative.
                      </h2>
                      <p className="mt-3 text-sm leading-7 text-[#4d6689] dark:text-slate-300">
                        After the scroll explanation, active tasks and workspace lanes stay visible here as the operational layer of the homepage.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={activeKanbanHref}
                        className="inline-flex items-center justify-center rounded-full border border-sky-200/70 bg-white/70 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#2b6fc8] transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.06]"
                      >
                        Open board
                      </Link>
                      <Link
                        href={activeWorkspaceHref}
                        className="inline-flex items-center justify-center rounded-full border border-sky-200/70 bg-white/70 px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[#2b6fc8] transition-colors hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.06]"
                      >
                        Open workspace
                      </Link>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_360px] lg:items-start">
                    <HomeTodoPreview
                      workspaceId={activeWorkspaceId}
                      workspaceTitle={activeWorkspace?.title ?? null}
                      refreshKey={refreshKey}
                    />
                    <WorkspaceCards
                      workspaceId={activeWorkspaceId}
                      refreshKey={refreshKey}
                      onWorkspaceSelect={handleWorkspaceSelect}
                      onWorkspaceCreate={handleWorkspaceCreate}
                      onSessionClick={handleSessionClick}
                      showWorkspacesMenu={showWorkspacesMenu}
                      setShowWorkspacesMenu={setShowWorkspacesMenu}
                      workspacesMenuRef={workspacesMenuRef}
                    />
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>

        <SettingsPanel
          open={showSettingsPanel}
          onClose={() => setShowSettingsPanel(false)}
          providers={acp.providers}
          initialTab={settingsInitialTab}
        />
      </div>
    </NotificationProvider>
  );
}

function HeroMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[24px] border border-sky-200/80 bg-white/66 px-4 py-4 shadow-[0_18px_50px_-34px_rgba(37,99,235,0.22)] backdrop-blur dark:border-white/8 dark:bg-white/[0.05]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#45678f] dark:text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-[1.75rem] font-semibold tracking-tight text-[#081120] dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-[#577090] dark:text-slate-400">
        {detail}
      </div>
    </div>
  );
}

function SurfaceStage({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.035] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-[11px] font-semibold text-sky-200">
          {index}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">
            {title}
          </div>
          <div className="mt-1 text-[11px] leading-5 text-slate-400">
            {detail}
          </div>
        </div>
      </div>
    </div>
  );
}
