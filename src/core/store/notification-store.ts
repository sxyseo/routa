/**
 * NotificationStore — Storage for notification preferences and delivery logs.
 *
 * Supports per-workspace notification preferences and audit logs for
 * every notification attempt (sent, failed, throttled).
 */

/** Events that can trigger email notifications */
export type NotificationEventType =
  | "TASK_COMPLETED"
  | "TASK_FAILED"
  | "AGENT_ERROR"
  | "PR_MERGED";

/** Notification preference per workspace */
export interface NotificationPreferences {
  workspaceId: string;
  /** Whether the entire notification system is enabled */
  enabled: boolean;
  /** SMTP sender address */
  senderEmail: string;
  /** List of recipient email addresses */
  recipients: string[];
  /** Which event types to listen to */
  enabledEvents: NotificationEventType[];
  /** Minimum seconds between identical event-type notifications (throttle) */
  throttleSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Notification delivery log entry */
export interface NotificationLog {
  id: string;
  workspaceId: string;
  eventType: NotificationEventType;
  recipients: string[];
  subject: string;
  /** sent | failed | throttled */
  status: string;
  /** Error message when status = failed */
  errorMessage?: string;
  /** How many times we retried (0–3) */
  retryCount: number;
  createdAt: Date;
}

export interface NotificationStore {
  // ─── Preferences ──────────────────────────────────────────────────
  getPreferences(workspaceId: string): Promise<NotificationPreferences | undefined>;
  upsertPreferences(prefs: NotificationPreferences): Promise<void>;

  // ─── Logs ─────────────────────────────────────────────────────────
  appendLog(log: NotificationLog): Promise<void>;
  /** Return logs ordered by createdAt descending */
  listLogs(workspaceId: string, limit?: number): Promise<NotificationLog[]>;
  /** Find the most recent log for an event type in a workspace (for throttle check) */
  findLatestLog(workspaceId: string, eventType: NotificationEventType): Promise<NotificationLog | undefined>;
  /** Update a log entry (used for retry status updates) */
  updateLog(logId: string, updates: Partial<Pick<NotificationLog, "status" | "errorMessage" | "retryCount">>): Promise<void>;
}

// ─── InMemory implementation ─────────────────────────────────────────

export class InMemoryNotificationStore implements NotificationStore {
  private preferences = new Map<string, NotificationPreferences>();
  private logs: NotificationLog[] = [];

  async getPreferences(workspaceId: string): Promise<NotificationPreferences | undefined> {
    return this.preferences.get(workspaceId);
  }

  async upsertPreferences(prefs: NotificationPreferences): Promise<void> {
    this.preferences.set(prefs.workspaceId, prefs);
  }

  async appendLog(log: NotificationLog): Promise<void> {
    this.logs.unshift(log);
  }

  async listLogs(workspaceId: string, limit = 100): Promise<NotificationLog[]> {
    return this.logs
      .filter((l) => l.workspaceId === workspaceId)
      .slice(0, limit);
  }

  async findLatestLog(workspaceId: string, eventType: NotificationEventType): Promise<NotificationLog | undefined> {
    return this.logs.find(
      (l) => l.workspaceId === workspaceId && l.eventType === eventType,
    );
  }

  async updateLog(logId: string, updates: Partial<Pick<NotificationLog, "status" | "errorMessage" | "retryCount">>): Promise<void> {
    const idx = this.logs.findIndex((l) => l.id === logId);
    if (idx !== -1) {
      this.logs[idx] = { ...this.logs[idx], ...updates };
    }
  }
}
