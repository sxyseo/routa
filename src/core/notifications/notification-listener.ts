/**
 * NotificationListener — EventBus listener that sends email notifications
 * on key events (task completed, task failed, agent error, PR merged).
 *
 * Features:
 *   - Throttle: same event type won't re-send within throttleSeconds
 *   - Retry: up to 3 retries on send failure
 *   - Graceful degradation: if SMTP not configured, logs and skips
 */

import { AgentEventType, type AgentEvent } from "../events/event-bus";
import type { NotificationStore, NotificationEventType, NotificationLog } from "../store/notification-store";
import type { NotificationPreferences } from "../store/notification-store";
import { createTransport, type Transporter } from "nodemailer";

const MAX_RETRIES = 3;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  senderEmail: string;
}

/**
 * Build an SMTP config from environment variables.
 * Returns undefined when SMTP is not configured (graceful degradation).
 */
export function getSmtpConfigFromEnv(): SmtpConfig | undefined {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASS ?? "";
  const senderEmail = process.env.SMTP_SENDER ?? "";

  if (!host) return undefined;

  return {
    host,
    port: isNaN(port) ? 587 : port,
    secure: port === 465,
    user,
    pass,
    senderEmail: senderEmail || user,
  };
}

/** Map EventBus event types to notification event types */
const EVENT_MAP: Partial<Record<AgentEventType, NotificationEventType>> = {
  [AgentEventType.TASK_COMPLETED]: "TASK_COMPLETED",
  [AgentEventType.TASK_FAILED]: "TASK_FAILED",
  [AgentEventType.AGENT_ERROR]: "AGENT_ERROR",
  [AgentEventType.PR_MERGED]: "PR_MERGED",
};

export class NotificationListener {
  private transporter: Transporter | null = null;
  private smtpConfig: SmtpConfig | undefined;
  private ready = false;

  constructor(
    private store: NotificationStore,
    smtpConfig?: SmtpConfig,
  ) {
    this.smtpConfig = smtpConfig ?? getSmtpConfigFromEnv();
  }

  /**
   * Initialize the SMTP transporter. Safe to call multiple times.
   * Returns true if email is ready, false if SMTP not configured (graceful degradation).
   */
  async initialize(): Promise<boolean> {
    if (!this.smtpConfig) {
      console.warn("[NotificationListener] SMTP not configured — email notifications disabled");
      this.ready = false;
      return false;
    }

    try {
      this.transporter = createTransport({
        host: this.smtpConfig.host,
        port: this.smtpConfig.port,
        secure: this.smtpConfig.secure,
        auth: {
          user: this.smtpConfig.user,
          pass: this.smtpConfig.pass,
        },
      });

      const verified = await this.transporter.verify();
      console.log("[NotificationListener] SMTP transporter verified:", verified);
      this.ready = true;
      return true;
    } catch (err) {
      console.error("[NotificationListener] SMTP verification failed:", err);
      this.ready = false;
      return false;
    }
  }

  /**
   * Register this listener on the EventBus.
   */
  register(eventBus: { on: (key: string, handler: (event: AgentEvent) => void) => void }): void {
    eventBus.on("notification-listener", (event: AgentEvent) => {
      this.handleEvent(event).catch((err) => {
        console.error("[NotificationListener] Error handling event:", err);
      });
    });
    console.log("[NotificationListener] Registered on EventBus");
  }

  /** Whether the SMTP transporter is ready */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Handle an incoming EventBus event.
   */
  async handleEvent(event: AgentEvent): Promise<void> {
    const notificationEventType = EVENT_MAP[event.type];
    if (!notificationEventType) return;

    const prefs = await this.store.getPreferences(event.workspaceId);
    if (!prefs || !prefs.enabled) return;
    if (!prefs.enabledEvents.includes(notificationEventType)) return;
    if (!prefs.recipients.length) return;

    // Throttle check
    const lastLog = await this.store.findLatestLog(event.workspaceId, notificationEventType);
    if (lastLog && lastLog.status !== "failed") {
      const elapsed = (Date.now() - lastLog.createdAt.getTime()) / 1000;
      if (elapsed < prefs.throttleSeconds) {
        // Throttled — log and skip
        await this.store.appendLog({
          id: crypto.randomUUID(),
          workspaceId: event.workspaceId,
          eventType: notificationEventType,
          recipients: prefs.recipients,
          subject: `[Throttled] ${notificationEventType}`,
          status: "throttled",
          retryCount: 0,
          createdAt: new Date(),
        });
        return;
      }
    }

    const subject = this.buildSubject(notificationEventType, event);
    const html = this.buildHtml(notificationEventType, event);

    const log: NotificationLog = {
      id: crypto.randomUUID(),
      workspaceId: event.workspaceId,
      eventType: notificationEventType,
      recipients: [...prefs.recipients],
      subject,
      status: "sent",
      retryCount: 0,
      createdAt: new Date(),
    };

    await this.sendWithRetry(log, html, prefs);
  }

  /**
   * Send a test email to the configured recipients.
   */
  async sendTestEmail(prefs: NotificationPreferences): Promise<{ success: boolean; error?: string }> {
    if (!this.ready || !this.transporter) {
      return { success: false, error: "SMTP not configured or not ready" };
    }

    try {
      await this.transporter.sendMail({
        from: this.smtpConfig?.senderEmail || prefs.senderEmail,
        to: prefs.recipients.join(", "),
        subject: "[Routa] Test Notification",
        html: "<p>This is a test notification from Routa platform.</p>",
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private async sendWithRetry(log: NotificationLog, html: string, prefs: NotificationPreferences): Promise<void> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (!this.transporter || !this.ready) {
          throw new Error("SMTP transporter not ready");
        }

        await this.transporter.sendMail({
          from: this.smtpConfig?.senderEmail || prefs.senderEmail,
          to: prefs.recipients.join(", "),
          subject: log.subject,
          html,
        });

        log.status = "sent";
        log.retryCount = attempt;
        await this.store.appendLog(log);
        return;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log.retryCount = attempt;

        if (attempt < MAX_RETRIES) {
          console.warn(`[NotificationListener] Send failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, errorMsg);
          // Brief wait before retry
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          log.status = "failed";
          log.errorMessage = errorMsg;
          await this.store.appendLog(log);
          console.error(`[NotificationListener] All ${MAX_RETRIES} retries exhausted for ${log.eventType}:`, errorMsg);
        }
      }
    }
  }

  private buildSubject(eventType: NotificationEventType, event: AgentEvent): string {
    const taskTitle = typeof event.data?.taskTitle === "string" ? event.data.taskTitle : "Task";
    const agentName = typeof event.data?.agentName === "string" ? event.data.agentName : "Agent";

    switch (eventType) {
      case "TASK_COMPLETED":
        return `[Routa] Task Completed: ${taskTitle}`;
      case "TASK_FAILED":
        return `[Routa] Task Failed: ${taskTitle}`;
      case "AGENT_ERROR":
        return `[Routa] Agent Error: ${agentName}`;
      case "PR_MERGED":
        return `[Routa] PR Merged: ${taskTitle}`;
      default:
        return `[Routa] ${eventType}`;
    }
  }

  private buildHtml(eventType: NotificationEventType, event: AgentEvent): string {
    const taskTitle = typeof event.data?.taskTitle === "string" ? event.data.taskTitle : "Unknown Task";
    const agentName = typeof event.data?.agentName === "string" ? event.data.agentName : "Unknown Agent";
    const reason = typeof event.data?.reason === "string" ? event.data.reason : "";
    const duration = typeof event.data?.duration === "string" ? event.data.duration : "";
    const prUrl = typeof event.data?.prUrl === "string" ? event.data.prUrl : "";

    const rows: string[] = [];
    rows.push(`<tr><td><strong>Task</strong></td><td>${escapeHtml(taskTitle)}</td></tr>`);
    rows.push(`<tr><td><strong>Agent</strong></td><td>${escapeHtml(agentName)}</td></tr>`);

    switch (eventType) {
      case "TASK_COMPLETED":
        if (duration) rows.push(`<tr><td><strong>Duration</strong></td><td>${escapeHtml(duration)}</td></tr>`);
        return emailTemplate("Task Completed", rows.join("\n"));
      case "TASK_FAILED":
        if (reason) rows.push(`<tr><td><strong>Reason</strong></td><td>${escapeHtml(reason)}</td></tr>`);
        return emailTemplate("Task Failed", rows.join("\n"));
      case "AGENT_ERROR":
        if (reason) rows.push(`<tr><td><strong>Error</strong></td><td>${escapeHtml(reason)}</td></tr>`);
        return emailTemplate("Agent Error", rows.join("\n"));
      case "PR_MERGED":
        if (prUrl) rows.push(`<tr><td><strong>PR URL</strong></td><td><a href="${escapeHtml(prUrl)}">${escapeHtml(prUrl)}</a></td></tr>`);
        return emailTemplate("PR Merged", rows.join("\n"));
      default:
        return emailTemplate(eventType, rows.join("\n"));
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailTemplate(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1a1a1a;border-bottom:2px solid #e5e7eb;padding-bottom:8px;">${title}</h2>
<table style="width:100%;border-collapse:collapse;">${bodyRows}</table>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
<p style="font-size:12px;color:#9ca3af;">Sent by Routa Notification System</p>
</body></html>`;
}
