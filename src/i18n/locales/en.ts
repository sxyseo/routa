import type { TranslationDictionary } from "../types";

const en: TranslationDictionary = {
  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    remove: "Remove",
    refresh: "Refresh",
    loading: "Loading…",
    search: "Search",
    confirm: "Confirm",
    back: "Back",
    next: "Next",
    submit: "Submit",
    retry: "Retry",
    dismiss: "Dismiss",
    upload: "Upload",
    download: "Download",
    export: "Export",
    import: "Import",
    clone: "Clone",
    send: "Send",
    auto: "Auto",
    none: "None",
    active: "Active",
    enter: "Enter",
    unavailable: "Unavailable",
    viewAll: "View all",
  },

  home: {
    subtitle: "Kanban-First Control Surface",
    minimalHome: "Minimal Home",
    workspaceCount: "workspaces",
    runtimeReady: "Runtime ready",
    runtimeOffline: "Runtime offline",
    heroTitle: "Start with a requirement.",
    heroDescription:
      "Pick a workspace, describe the task, and route it. Everything else can happen after you enter the flow.",
    composer: "Composer",
    currentWorkspace: "Current workspace",
    switchWorkspace: "Switch workspace",
    workspaceOverview: "Workspace overview",
    openKanban: "Open Kanban",
    newWorkspace: "+ New workspace",
    loadingWorkspaces: "Loading workspaces...",
    inputPlaceholder: "What are you working on? (@ files, / skills)",
    sendHint: "⏎ send",
    multiAgent: "Multi-Agent",
    direct: "Direct",
    multiAgentDesc:
      "Suited for complex tasks · Automatically decompose requirements and assign to multiple specialized agents",
    directDesc: "Suited for quick tasks · Single agent direct execution",
    customSpecialist: "Custom Specialist",
    specialistMode: "Specialist mode",
    repoPath: "Repo path",
  },

  nav: {
    kanban: "Kanban",
    settings: "Settings",
    notifications: "Notifications",
    connected: "Connected",
    offline: "Offline",
    openSidebar: "Open sidebar",
    closeSidebar: "Close sidebar",
  },

  settings: {
    title: "Settings",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    providers: "Providers",
    roles: "Roles",
    specialists: "Specialists",
    models: "Models",
    mcpServers: "MCP Servers",
    webhooks: "Webhooks",
    schedules: "Schedules",
    workflows: "Workflows",
    roleDefaults: "Role Defaults",
    roleDefaultsDesc:
      "Configure default provider and model override per Routa role. ROUTA-specific settings live here instead of the Providers tab.",
    provider: "Provider",
    modelOverride: "Model Override",
    builtIn: "Built-in",
    custom: "Custom",
    registry: "Registry",
    systemInfo: "System Info",
    memory: "Memory",
    sessions: "Sessions",
    refreshSystemInfo: "Refresh system info",
    language: "Language",
  },

  roles: {
    routa: "Coordinator – plans & delegates",
    crafter: "Implementation – writes code",
    gate: "Verification – reviews code",
    developer: "Solo – plans, implements & verifies",
  },

  workspace: {
    selectWorkspace: "Select workspace",
    select: "Select",
    noWorkspacesYet: "No workspaces yet",
    newWorkspace: "New Workspace",
    workspaceName: "Workspace name...",
    workspaces: "Workspaces",
    currentLabel: "Current",
    recentActivity: "Recent session activity",
    noRecentSessions: "No recent sessions yet",
  },

  notifications: {
    title: "Notifications",
    markAllRead: "Mark all read",
    viewAll: "View all →",
    empty: "No notifications",
  },

  story: {
    productFlow: "Product Flow",
    scrollSurfaces: "Scroll the surfaces in order.",
    intentCapture: "Intent Capture",
    intentCaptureTitle: "Start with the requirement, not a dashboard.",
    intentCaptureBody:
      "The composer stays first. Repo scope, workspace context, and agent selection stay attached to the prompt so the task begins where the thinking happens.",
    parallelRouting: "Parallel Routing",
    parallelRoutingTitle:
      "Let orchestration fan out without changing surfaces.",
    parallelRoutingBody:
      "Routa can spin specialized agents, keep the execution graph visible, and turn a single brief into coordinated work without forcing the user into setup screens.",
    operationalView: "Operational View",
    operationalViewTitle: "Boards become live operations, not the homepage.",
    operationalViewBody:
      "Once the run is moving, Kanban and workspace views act like telemetry layers. They show pressure, ownership, and throughput after launch instead of before it.",
    traceReview: "Trace Review",
    traceReviewTitle: "End in evidence, not in silence.",
    traceReviewBody:
      "Every session writes an observable trace. Token flow, tool calls, and cost show up after the task completes so the user can see what happened and trust the result.",
    runtimeOnline: "Runtime Online",
    runtimeOffline: "Runtime Offline",
    activeModules: "Active Modules",
    skills: "skills",
    liveTasks: "Live Tasks",
    noActiveTasks: "No active tasks yet",
  },

  onboarding: {
    createWorkspace: "Create a workspace",
    description:
      "Organize sessions, boards, and traces under a single workspace. Get started by creating your first one.",
    getStarted: "Get Started",
  },

  skills: {
    searchPlaceholder: "Search skills… (e.g. react, supabase, testing)",
    catalog: "Catalog",
    cloneSkills: "Clone",
    uploadSkill: "Upload",
    reload: "Reload",
    browseCatalog: "Browse skill catalog",
    cloneFromGithub: "Clone skills from GitHub",
    uploadZip: "Upload skill zip",
    cloneFailed: "Failed to clone skills",
    uploadFailed: "Upload failed",
  },

  agents: {
    loadingFromRegistry: "Loading agents from registry…",
    failedToLoad: "Failed to load agents",
    installFailed: "Installation failed",
    uninstallFailed: "Uninstallation failed",
    failedToFetchRegistry: "Failed to fetch registry",
  },

  tasks: {
    objective: "Objective",
    scope: "Scope",
    definitionOfDone: "Definition of Done",
    title: "Title",
  },

  workflows: {
    newWorkflow: "New Workflow",
    editLabel: "Edit:",
    saving: "Saving…",
    executionFailed: "Execution failed",
    selectWorkspaceFirst: "Select a workspace before running this workflow",
  },

  traces: {
    title: "Traces",
    chat: "Chat",
    eventBridge: "EventBridge",
  },

  errors: {
    generic: "Something went wrong",
    saveFailed: "Save failed",
    loadFailed: "Failed to load",
  },
};

export default en;
