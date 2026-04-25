/**
 * PgNotificationStore — Postgres-backed notification preferences and logs.
 */

import { eq, desc } from "drizzle-orm";
import type { Database } from "./index";
import { notificationPreferences, notificationLogs } from "./schema";
import type {
  NotificationStore,
  NotificationPreferences,
  NotificationLog,
  NotificationEventType,
} from "../store/notification-store";

export class PgNotificationStore implements NotificationStore {
  constructor(private db: Database) {}

  async getPreferences(workspaceId: string): Promise<NotificationPreferences | undefined> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.workspaceId, workspaceId))
      .limit(1);
    if (!rows[0]) return undefined;
    return this.toPrefs(rows[0]);
  }

  async upsertPreferences(prefs: NotificationPreferences): Promise<void> {
    await this.db
      .insert(notificationPreferences)
      .values({
        workspaceId: prefs.workspaceId,
        enabled: prefs.enabled,
        senderEmail: prefs.senderEmail,
        recipients: prefs.recipients,
        enabledEvents: prefs.enabledEvents,
        throttleSeconds: prefs.throttleSeconds,
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.workspaceId,
        set: {
          enabled: prefs.enabled,
          senderEmail: prefs.senderEmail,
          recipients: prefs.recipients,
          enabledEvents: prefs.enabledEvents,
          throttleSeconds: prefs.throttleSeconds,
          updatedAt: new Date(),
        },
      });
  }

  async appendLog(log: NotificationLog): Promise<void> {
    await this.db.insert(notificationLogs).values({
      id: log.id,
      workspaceId: log.workspaceId,
      eventType: log.eventType,
      recipients: log.recipients,
      subject: log.subject,
      status: log.status,
      errorMessage: log.errorMessage,
      retryCount: log.retryCount,
      createdAt: log.createdAt,
    });
  }

  async listLogs(workspaceId: string, limit = 100): Promise<NotificationLog[]> {
    const rows = await this.db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.workspaceId, workspaceId))
      .orderBy(desc(notificationLogs.createdAt))
      .limit(limit);
    return rows.map((r) => this.toLog(r));
  }

  async findLatestLog(workspaceId: string, eventType: NotificationEventType): Promise<NotificationLog | undefined> {
    const rows = await this.db
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.workspaceId, workspaceId))
      .orderBy(desc(notificationLogs.createdAt))
      .limit(50);
    const match = rows.find((r) => r.eventType === eventType);
    return match ? this.toLog(match) : undefined;
  }

  async updateLog(logId: string, updates: Partial<Pick<NotificationLog, "status" | "errorMessage" | "retryCount">>): Promise<void> {
    const setValues: Record<string, unknown> = {};
    if (updates.status !== undefined) setValues.status = updates.status;
    if (updates.errorMessage !== undefined) setValues.errorMessage = updates.errorMessage;
    if (updates.retryCount !== undefined) setValues.retryCount = updates.retryCount;

    await this.db
      .update(notificationLogs)
      .set(setValues)
      .where(eq(notificationLogs.id, logId));
  }

  private toPrefs(row: typeof notificationPreferences.$inferSelect): NotificationPreferences {
    return {
      workspaceId: row.workspaceId,
      enabled: row.enabled,
      senderEmail: row.senderEmail,
      recipients: row.recipients ?? [],
      enabledEvents: row.enabledEvents ?? [],
      throttleSeconds: row.throttleSeconds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toLog(row: typeof notificationLogs.$inferSelect): NotificationLog {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      eventType: row.eventType as NotificationEventType,
      recipients: row.recipients ?? [],
      subject: row.subject,
      status: row.status,
      errorMessage: row.errorMessage ?? undefined,
      retryCount: row.retryCount,
      createdAt: row.createdAt,
    };
  }
}
