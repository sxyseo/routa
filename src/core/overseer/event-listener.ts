/**
 * EventListener — handles OVERSEER_ALERT events from the EventBus.
 *
 * For ESCALATE decisions:
 *   - Generates HMAC-SHA256 signed approval token
 *   - Sends approval URL via WeChat Work webhook
 *   - Token is valid for 30 minutes, single-use
 */

import type { EventBus, AgentEvent } from "../events/event-bus";
import { AgentEventType } from "../events/event-bus";
import type { OverseerStateStore } from "./overseer-state-store";
import { getWeChatWorkChannel } from "../notifications/wechat-work-channel";
import crypto from "crypto";

// ─── Constants ──────────────────────────────────────────────────────

const TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_SEPARATOR = ":";

// ─── HMAC Token Generation ─────────────────────────────────────────

function getSigningSecret(): string {
  return process.env.OVERSEER_HMAC_SECRET ?? process.env.ROUTA_DB_PATH ?? "routa-overseer-default-secret";
}

/**
 * Generate an HMAC-SHA256 approval token for a decision.
 *
 * Token format: `{timestamp}:{hmac}`
 * HMAC input: `{decisionId}:{timestamp}:{action}`
 */
export function generateApprovalToken(
  decisionId: string,
  action: "approve" | "reject",
): string {
  const timestamp = Date.now();
  const payload = `${decisionId}${TOKEN_SEPARATOR}${timestamp}${TOKEN_SEPARATOR}${action}`;
  const hmac = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("hex");
  return `${timestamp}${TOKEN_SEPARATOR}${hmac}`;
}

/**
 * Verify an approval token.
 *
 * Returns true if:
 *   - Token is well-formed
 *   - HMAC signature matches
 *   - Token is within 30-minute validity window
 */
export function verifyApprovalToken(
  decisionId: string,
  action: "approve" | "reject",
  token: string,
): { valid: boolean; error?: string } {
  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 2) {
    return { valid: false, error: "Invalid token format" };
  }

  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) {
    return { valid: false, error: "Invalid token timestamp" };
  }

  // Check expiry
  if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
    return { valid: false, error: "Token expired (>30min)" };
  }

  // Verify HMAC
  const payload = `${decisionId}${TOKEN_SEPARATOR}${timestamp}${TOKEN_SEPARATOR}${action}`;
  const expectedHmac = crypto
    .createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("hex");

  if (parts[1] !== expectedHmac) {
    return { valid: false, error: "Invalid token signature" };
  }

  return { valid: true };
}

// ─── Event Listener ────────────────────────────────────────────────

export function registerOverseerEventListener(
  eventBus: EventBus,
  stateStore: OverseerStateStore,
): void {
  eventBus.on("overseer-event-listener", async (event: AgentEvent) => {
    if (event.type !== AgentEventType.OVERSEER_ALERT) return;

    const data = event.data;
    const decisionId = data.decisionId as string;
    const pattern = data.pattern as string;
    const taskId = data.taskId as string;
    const description = data.description as string;

    // Generate approval token
    const approveToken = generateApprovalToken(decisionId, "approve");

    // Persist the token on the decision
    const decision = await stateStore.getDecision(decisionId);
    if (decision) {
      decision.token = approveToken;
      await stateStore.saveDecision(decision);
    }

    // Send escalation notification
    const channel = getWeChatWorkChannel();
    await channel.sendEscalation({
      decisionId,
      pattern,
      taskId,
      description,
      approveToken,
    });

    console.log(`[Overseer] ESCALATE sent for ${pattern} (task ${taskId}), decision ${decisionId}`);
  });

  console.log("[Overseer] Event listener registered on EventBus");
}
