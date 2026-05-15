/**
 * WeChatWorkChannel — Enterprise WeChat (企业微信) group robot webhook channel.
 *
 * Sends markdown messages to a group chat via webhook URL.
 * Gracefully degrades when WECHAT_WORK_WEBHOOK_URL is not configured:
 * all send calls become no-ops with log output only.
 */

export interface WeChatWorkMessageResult {
  success: boolean;
  error?: string;
}

export class WeChatWorkChannel {
  private webhookUrl: string | undefined;
  private publicUrl: string;
  private mentionedList: string[];

  constructor() {
    this.webhookUrl = process.env.WECHAT_WORK_WEBHOOK_URL;
    this.publicUrl = process.env.ROUTA_PUBLIC_URL ?? "http://localhost:3000";
    this.mentionedList = (process.env.WECHAT_WORK_MENTIONED_LIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Whether the webhook is configured and ready */
  isConfigured(): boolean {
    return typeof this.webhookUrl === "string" && this.webhookUrl.length > 0;
  }

  /**
   * Send a markdown message to the configured WeChat Work group.
   * When not configured, logs the message instead.
   */
  async sendMarkdown(
    title: string,
    content: string,
    mentionedList?: string[],
  ): Promise<WeChatWorkMessageResult> {
    if (!this.isConfigured()) {
      console.log(`[WeChatWork] (not configured) [${title}] ${content}`);
      return { success: true };
    }

    const mentioned =
      mentionedList ?? this.mentionedList;

    try {
      const payload: Record<string, unknown> = {
        msgtype: "markdown",
        markdown: {
          content: `### ${title}\n${content}`,
          mentioned_mobile_list: mentioned.length > 0 ? mentioned : undefined,
        },
      };

      const response = await fetch(this.webhookUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${text}` };
      }

      const result = (await response.json()) as { errcode?: number; errmsg?: string };
      if (result.errcode && result.errcode !== 0) {
        return { success: false, error: `WeChat API error ${result.errcode}: ${result.errmsg}` };
      }

      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WeChatWork] Send failed for "${title}":`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Send an overseer escalation notification with approval links.
   */
  async sendEscalation(params: {
    decisionId: string;
    pattern: string;
    taskId: string;
    description: string;
    approveToken: string;
  }): Promise<WeChatWorkMessageResult> {
    const { decisionId, pattern, taskId, description, approveToken } = params;

    const approveUrl = `${this.publicUrl}/api/overseer/approve?d=${encodeURIComponent(decisionId)}&t=approve&token=${encodeURIComponent(approveToken)}`;
    const rejectUrl = `${this.publicUrl}/api/overseer/approve?d=${encodeURIComponent(decisionId)}&t=reject&token=${encodeURIComponent(approveToken)}`;

    const content = [
      `**模式**: ${pattern}`,
      `**任务**: ${taskId}`,
      `**描述**: ${description}`,
      "",
      `[点击审批](${approveUrl})`,
      `[点击拒绝](${rejectUrl})`,
    ].join("\n");

    return this.sendMarkdown(
      `[Overseer] 需要人工审批: ${pattern}`,
      content,
    );
  }

  /**
   * Send a post-action notification (NOTIFY category).
   */
  async sendNotification(params: {
    pattern: string;
    taskId: string;
    description: string;
  }): Promise<WeChatWorkMessageResult> {
    const { pattern, taskId, description } = params;

    const content = [
      `**模式**: ${pattern}`,
      `**任务**: ${taskId}`,
      `**描述**: ${description}`,
      "",
      "> 此操作已自动执行，仅作事后通知。",
    ].join("\n");

    return this.sendMarkdown(
      `[Overseer] 自动处理通知: ${pattern}`,
      content,
    );
  }
}

// ─── Singleton ────────────────────────────────────────────────────

const GLOBAL_KEY = "__routa_wechat_work_channel__";

export function getWeChatWorkChannel(): WeChatWorkChannel {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new WeChatWorkChannel();
  }
  return g[GLOBAL_KEY] as WeChatWorkChannel;
}
