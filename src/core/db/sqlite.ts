/**
 * SQLite Database Connection — for the local Node.js backend.
 *
 * Uses better-sqlite3 via drizzle-orm for local database storage.
 * The database file defaults to the project-local `routa.db`.
 *
 * Connection is lazy-initialized and cached for the lifetime of the process.
 */

import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import BetterSqlite3 from "better-sqlite3";
import * as schema from "./sqlite-schema";
import { createWorkspace } from "../models/workspace";
import { withSqliteTiming } from "../http/db-timing-middleware";

export type SqliteDatabase = BetterSQLite3Database<typeof schema>;

const GLOBAL_KEY = "__routa_sqlite_db__";
const GLOBAL_RAW_KEY = "__routa_sqlite_raw__";
const WORKTREES_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS worktrees (
    id TEXT PRIMARY KEY,
    codebase_id TEXT NOT NULL REFERENCES codebases(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    worktree_path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'creating',
    session_id TEXT,
    label TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_worktrees_codebase_branch
  ON worktrees (codebase_id, branch)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_worktrees_path
  ON worktrees (worktree_path)`,
  `CREATE INDEX IF NOT EXISTS idx_worktrees_workspace_id
  ON worktrees (workspace_id)`,
] as const;

function applyWorktreesTableDdl(execute: (statement: string) => void): void {
  for (const statement of WORKTREES_DDL_STATEMENTS) {
    execute(statement);
  }
}

function hasSqliteTable(sqlite: BetterSqlite3.Database, tableName: string): boolean {
  return Boolean(
    sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(tableName),
  );
}

function ensureWorktreesTable(sqlite: BetterSqlite3.Database): void {
  if (hasSqliteTable(sqlite, "worktrees")) {
    return;
  }

  console.warn("[SQLite] worktrees table missing, creating it now");
  applyWorktreesTableDdl((statement) => sqlite.exec(statement));

  if (!hasSqliteTable(sqlite, "worktrees")) {
    throw new Error("[SQLite] Failed to create missing worktrees table");
  }
}

/**
 * Get or create a SQLite database instance.
 *
 * @param dbPath - Path to the SQLite database file.
 *                 Defaults to ROUTA_DB_PATH env var, or "routa.db" in the
 *                 current directory.
 */
export function getSqliteDatabase(dbPath?: string): SqliteDatabase {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    const resolvedPath = dbPath ?? process.env.ROUTA_DB_PATH ?? "routa.db";
    console.log(`[SQLite] Opening database at: ${resolvedPath}`);
    const sqlite = new BetterSqlite3(resolvedPath);

    // Enable WAL mode for better concurrent read performance
    sqlite.pragma("journal_mode = WAL");
    // Enable foreign keys
    sqlite.pragma("foreign_keys = ON");
    // Busy timeout: wait up to 5s for locks instead of immediate SQLITE_BUSY.
    // Critical when MCP SSE handlers do concurrent writes while REST endpoints read.
    sqlite.pragma("busy_timeout = 5000");
    // Performance PRAGMAs: reduce fsync overhead and use memory for temp tables.
    // NOTE: synchronous=NORMAL trades durability for speed — in WAL mode, a power
    // loss or OS crash on Windows may lose the last ~1s of transactions. Acceptable
    // for a local dev tool; set ROUTA_SQLITE_SYNCHRONOUS=FULL to override.
    sqlite.pragma("synchronous = NORMAL");
    sqlite.pragma("temp_store = MEMORY");
    sqlite.pragma("mmap_size = 268435456");    // 256 MB memory-mapped I/O
    sqlite.pragma("cache_size = -20000");       // 20 MB page cache

    // Wrap raw sqlite with timing before passing to Drizzle
    const timedSqlite = withSqliteTiming(sqlite);
    const db = drizzle(timedSqlite, { schema });

    // Run migrations / create tables on first use
    initializeSqliteTables(db);

    try {
      ensureWorktreesTable(sqlite);
    } catch (error) {
      console.error("[SQLite] Failed to ensure worktrees table exists:", error);
      throw error;
    }

    // Store both the drizzle wrapper and the raw connection
    g[GLOBAL_KEY] = db;
    g[GLOBAL_RAW_KEY] = sqlite;
  }
  return g[GLOBAL_KEY] as SqliteDatabase;
}

function getRawSqliteDatabase(): BetterSqlite3.Database {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_RAW_KEY]) {
    getSqliteDatabase();
  }
  return g[GLOBAL_RAW_KEY] as BetterSqlite3.Database;
}

export function ensureSqliteDefaultWorkspace(rawDb?: BetterSqlite3.Database): void {
  const sqlite = rawDb ?? getRawSqliteDatabase();
  const existing = sqlite.prepare("SELECT 1 FROM workspaces WHERE id = ? LIMIT 1").get("default");
  if (existing) {
    return;
  }

  const workspace = createWorkspace({
    id: "default",
    title: "Default Workspace",
  });

  sqlite.prepare(`
    INSERT INTO workspaces (id, title, status, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    workspace.id,
    workspace.title,
    workspace.status,
    JSON.stringify(workspace.metadata),
    workspace.createdAt.getTime(),
    workspace.updatedAt.getTime(),
  );
}

/**
 * Create all tables if they don't exist.
 * Uses raw SQL for CREATE TABLE IF NOT EXISTS.
 */
function initializeSqliteTables(db: SqliteDatabase): void {
  function runAddColumn(sqlStatement: ReturnType<typeof sql>) {
    try {
      db.run(sqlStatement);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const causeMessage = error instanceof Error && error.cause instanceof Error
        ? error.cause.message.toLowerCase() : "";
      if (!message.includes("duplicate column name") && !causeMessage.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      repo_path TEXT,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model_tier TEXT NOT NULL DEFAULT 'SMART',
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      comment TEXT,
      comments TEXT DEFAULT '[]',
      scope TEXT,
      acceptance_criteria TEXT,
      verification_commands TEXT,
      test_cases TEXT,
      assigned_to TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      board_id TEXT,
      column_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      priority TEXT,
      labels TEXT DEFAULT '[]',
      assignee TEXT,
      assigned_provider TEXT,
      assigned_role TEXT,
      assigned_specialist_id TEXT,
      assigned_specialist_name TEXT,
      fallback_agent_chain TEXT,
      enable_automatic_fallback INTEGER,
      max_fallback_attempts INTEGER,
      trigger_session_id TEXT,
      session_ids TEXT DEFAULT '[]',
      lane_sessions TEXT DEFAULT '[]',
      lane_handoffs TEXT DEFAULT '[]',
      vcs_id TEXT,
      vcs_number INTEGER,
      vcs_url TEXT,
      vcs_repo TEXT,
      vcs_state TEXT,
      vcs_synced_at INTEGER,
      last_sync_error TEXT,
      is_pull_request INTEGER,
      dependencies TEXT DEFAULT '[]',
      parallel_group TEXT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT,
      delivery_snapshot TEXT,
      pull_request_url TEXT,
      pull_request_merged_at INTEGER,
      completion_summary TEXT,
      verification_verdict TEXT,
      verification_report TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN comment TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN comments TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN board_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN column_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN priority TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN labels TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN assignee TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN assigned_provider TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN assigned_role TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN assigned_specialist_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN assigned_specialist_name TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN fallback_agent_chain TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN enable_automatic_fallback INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN max_fallback_attempts INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN trigger_session_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_number INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_url TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_repo TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_state TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN vcs_synced_at INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN last_sync_error TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN is_pull_request INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN test_cases TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN session_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN creation_source TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN codebase_ids TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN worktree_id TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN delivery_snapshot TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN session_ids TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN lane_sessions TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN lane_handoffs TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN pull_request_url TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN pull_request_merged_at INTEGER`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN blocking TEXT DEFAULT '[]'`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN dependency_status TEXT`);
  runAddColumn(sql`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`);

  // Critical index: tasks.listByWorkspace is the hottest query path.
  // Without this, 360 MB database does a full table scan per request.
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks (workspace_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_board_id ON tasks (board_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      session_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'general',
      task_status TEXT,
      assigned_agent_ids TEXT,
      parent_note_id TEXT,
      linked_task_id TEXT,
      custom_metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (workspace_id, id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      tool_name TEXT,
      tool_args TEXT,
      turn INTEGER
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS custom_mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      headers TEXT,
      env TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      workspace_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      event_types TEXT NOT NULL,
      exclude_self INTEGER NOT NULL DEFAULT 1,
      one_shot INTEGER NOT NULL DEFAULT 0,
      wait_group_id TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS pending_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      data TEXT DEFAULT '{}',
      timestamp INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS acp_sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      cwd TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      routa_agent_id TEXT,
      provider TEXT,
      role TEXT,
      mode_id TEXT,
      model TEXT,
      first_prompt_sent INTEGER DEFAULT 0,
      message_history TEXT DEFAULT '[]',
      parent_session_id TEXT,
      specialist_id TEXT,
      execution_mode TEXT,
      owner_instance_id TEXT,
      lease_expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // Add branch column to existing acp_sessions tables
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN branch TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN model TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN parent_session_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN specialist_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN execution_mode TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN owner_instance_id TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE acp_sessions ADD COLUMN lease_expires_at INTEGER`); } catch { /* column already exists */ }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES acp_sessions(id) ON DELETE CASCADE,
      message_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
    ON session_messages (session_id, message_index)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS codebases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      repo_path TEXT NOT NULL,
      branch TEXT,
      label TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      source_type TEXT,
      source_url TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // Add source_type/source_url to existing codebases tables that predate this migration
  try { db.run(sql`ALTER TABLE codebases ADD COLUMN source_type TEXT`); } catch { /* column already exists */ }
  try { db.run(sql`ALTER TABLE codebases ADD COLUMN source_url TEXT`); } catch { /* column already exists */ }

  applyWorktreesTableDdl((statement) => {
    db.run(sql.raw(statement));
  });

  try { db.run(sql`ALTER TABLE worktrees ADD COLUMN base_commit_sha TEXT`); } catch { /* column already exists */ }

  db.run(sql`
    CREATE TABLE IF NOT EXISTS kanban_boards (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      github_token TEXT,
      columns TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      provided_by_agent_id TEXT,
      requested_by_agent_id TEXT,
      request_id TEXT,
      content TEXT,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS artifact_requests (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      context TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      artifact_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  try { db.run(sql`ALTER TABLE kanban_boards ADD COLUMN github_token TEXT`); } catch { /* column already exists */ }
  db.run(sql`DROP INDEX IF EXISTS kanban_boards_workspace_default_idx`);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      catalog_type TEXT NOT NULL DEFAULT 'skillssh',
      files TEXT NOT NULL DEFAULT '[]',
      license TEXT,
      metadata TEXT DEFAULT '{}',
      installs INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS workspace_skills (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      installed_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (workspace_id, skill_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      triggered_by TEXT NOT NULL DEFAULT 'user',
      trigger_source TEXT NOT NULL DEFAULT 'manual',
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      result_session_id TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      last_activity INTEGER,
      current_activity TEXT,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      workflow_run_id TEXT,
      workflow_step_name TEXT,
      depends_on_task_ids TEXT,
      task_output TEXT
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_background_tasks_result_session_id
    ON background_tasks (result_session_id)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_background_tasks_status
    ON background_tasks (status)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_background_tasks_workspace_id
    ON background_tasks (workspace_id)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS github_webhook_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo TEXT NOT NULL,
      github_token TEXT NOT NULL,
      webhook_secret TEXT NOT NULL DEFAULT '',
      event_types TEXT NOT NULL DEFAULT '[]',
      label_filter TEXT DEFAULT '[]',
      trigger_agent_id TEXT NOT NULL,
      workflow_id TEXT,
      workspace_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt_template TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      task_prompt TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      last_task_id TEXT,
      prompt_template TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS webhook_trigger_logs (
      id TEXT PRIMARY KEY,
      config_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_action TEXT,
      payload TEXT DEFAULT '{}',
      background_task_id TEXT,
      signature_valid INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'triggered',
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // ─── VCS column rename migration (github_* → vcs_*) ──────────────────
  // SQLite 3.25.0+ supports ALTER TABLE RENAME COLUMN.
  // Each rename is idempotent: if the old column no longer exists (already
  // renamed) the statement errors and is silently swallowed by the try/catch.
  const vcsColumnRenames: [string, string][] = [
    ["github_id", "vcs_id"],
    ["github_number", "vcs_number"],
    ["github_url", "vcs_url"],
    ["github_repo", "vcs_repo"],
    ["github_state", "vcs_state"],
    ["github_synced_at", "vcs_synced_at"],
  ];
  for (const [oldCol, newCol] of vcsColumnRenames) {
    try {
      db.run(sql.raw(`ALTER TABLE tasks RENAME COLUMN "${oldCol}" TO "${newCol}"`));
    } catch {
      // Column already renamed or doesn't exist — safe to ignore
    }
  }

  // ─── Notification Preferences ──────────────────────────────────────────

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      sender_email TEXT NOT NULL DEFAULT '',
      recipients TEXT NOT NULL DEFAULT '[]',
      enabled_events TEXT NOT NULL DEFAULT '[]',
      throttle_seconds INTEGER NOT NULL DEFAULT 300,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  // ─── Notification Logs ──────────────────────────────────────────────────

  db.run(sql`
    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      recipients TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_notification_logs_workspace_id
    ON notification_logs (workspace_id)
  `);

  // ─── Overseer (smart monitoring agent) ───────────────────────────────

  db.run(sql`
    CREATE TABLE IF NOT EXISTS overseer_decisions (
      id TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      task_id TEXT,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      token TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      resolved_at INTEGER
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_overseer_decisions_pattern_task
    ON overseer_decisions (pattern, task_id, created_at DESC)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS overseer_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    )
  `);

  console.log("[SQLite] Tables initialized");
}

/**
 * Check if SQLite is configured as the database.
 * Always true when the local Node.js backend selects SQLite.
 */
export function isSqliteConfigured(): boolean {
  return true;
}

/**
 * Close the SQLite database connection.
 * Used primarily for tests to release file locks on Windows.
 */
export function closeSqliteDatabase(): void {
  const g = globalThis as Record<string, unknown>;
  const rawDb = g[GLOBAL_RAW_KEY] as BetterSqlite3.Database | undefined;
  if (rawDb) {
    try {
      rawDb.close();
    } catch {
      // Ignore close errors
    }
    delete g[GLOBAL_RAW_KEY];
  }
  delete g[GLOBAL_KEY];
}
