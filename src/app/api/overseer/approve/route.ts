/**
 * Overseer Approval API — handles ESCALATE decision approval/rejection.
 *
 * GET  /api/overseer/approve?d={decisionId}&t={approve|reject}&token={hmacToken}
 * POST /api/overseer/approve  body: { decisionId, action, token }
 *
 * Token security:
 *   - HMAC-SHA256 signed
 *   - 30-minute validity
 *   - Single-use (token invalidated after approval/rejection)
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface ApprovalParams {
  decisionId: string;
  action: "approve" | "reject";
  token: string;
}

function extractParams(request: NextRequest): ApprovalParams | null {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const decisionId = url.searchParams.get("d");
    const action = url.searchParams.get("t") as "approve" | "reject" | null;
    const token = url.searchParams.get("token");

    if (!decisionId || !action || !token) return null;
    if (action !== "approve" && action !== "reject") return null;

    return { decisionId, action, token };
  }

  return null; // POST handled separately
}

async function handleApproval(params: ApprovalParams): Promise<NextResponse> {
  const { verifyApprovalToken } = require("@/core/overseer") as typeof import("@/core/overseer");
  const { getOverseerContext } = require("@/core/overseer") as typeof import("@/core/overseer");

  // Verify token
  const verification = verifyApprovalToken(params.decisionId, params.action, params.token);
  if (!verification.valid) {
    return NextResponse.json(
      { error: `Token verification failed: ${verification.error}` },
      { status: 403 },
    );
  }

  // Get context
  const ctx = getOverseerContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Overseer subsystem not initialized" },
      { status: 503 },
    );
  }

  // Get decision
  const decision = await ctx.stateStore.getDecision(params.decisionId);
  if (!decision) {
    return NextResponse.json(
      { error: "Decision not found" },
      { status: 404 },
    );
  }

  // Check if already resolved (single-use)
  if (decision.status !== "pending") {
    return NextResponse.json(
      { error: `Decision already ${decision.status}`, status: decision.status },
      { status: 409 },
    );
  }

  // Update decision status
  const newStatus = params.action === "approve" ? "approved" : "rejected";
  await ctx.stateStore.updateDecisionStatus(params.decisionId, newStatus, Date.now());

  // For approvals, log the action (actual execution would be task-specific)
  if (params.action === "approve") {
    console.log(`[Overseer] ESCALATE decision ${params.decisionId} APPROVED by human: ${decision.pattern} (task ${decision.taskId})`);
  } else {
    console.log(`[Overseer] ESCALATE decision ${params.decisionId} REJECTED by human: ${decision.pattern} (task ${decision.taskId})`);
  }

  return NextResponse.json({
    success: true,
    decisionId: params.decisionId,
    action: params.action,
    pattern: decision.pattern,
    taskId: decision.taskId,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const params = extractParams(request);
    if (!params) {
      return NextResponse.json(
        { error: "Missing required parameters: d (decisionId), t (action), token" },
        { status: 400 },
      );
    }

    const result = await handleApproval(params);

    // Return HTML for browser one-click approval
    if (result.status === 200) {
      const body = await result.json();
      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Overseer Approval</title>
<style>body{font-family:system-ui,sans-serif;max-width:500px;margin:60px auto;padding:20px;color:#333}
.success{color:#16a34a;font-size:24px}.rejected{color:#dc2626;font-size:24px}
.info{margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px}</style></head>
<body>
<h1 class="${body.action === "approve" ? "success" : "rejected"}">${body.action === "approve" ? "Approved" : "Rejected"}</h1>
<div class="info">
<p><strong>Decision:</strong> ${body.pattern}</p>
<p><strong>Task:</strong> ${body.taskId}</p>
<p><strong>Time:</strong> ${new Date().toISOString()}</p>
</div></body></html>`;
      return new NextResponse(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    return result;
  } catch (error) {
    console.error("[API] Overseer approval failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      decisionId?: string;
      action?: string;
      token?: string;
    };

    if (!body.decisionId || !body.action || !body.token) {
      return NextResponse.json(
        { error: "Missing required fields: decisionId, action, token" },
        { status: 400 },
      );
    }

    if (body.action !== "approve" && body.action !== "reject") {
      return NextResponse.json(
        { error: "Action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    }

    return handleApproval({
      decisionId: body.decisionId,
      action: body.action as "approve" | "reject",
      token: body.token,
    });
  } catch (error) {
    console.error("[API] Overseer approval (POST) failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
