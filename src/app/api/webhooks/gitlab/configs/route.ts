/**
 * /api/webhooks/gitlab/configs — CRUD API for GitLab webhook trigger configurations.
 *
 * GET    /api/webhooks/gitlab/configs                  → List all GitLab configs
 * GET    /api/webhooks/gitlab/configs?id=<id>          → Get a single config
 * POST   /api/webhooks/gitlab/configs                  → Create a new config
 * PUT    /api/webhooks/gitlab/configs                  → Update an existing config
 * DELETE /api/webhooks/gitlab/configs?id=<id>          → Delete a config
 *
 * Uses the dedicated GitLabWebhookStore for all operations.
 */

import { NextRequest, NextResponse } from "next/server";
import { getGitLabWebhookStore } from "@/core/webhooks/gitlab-webhook-store-factory";

export const dynamic = "force-dynamic";

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const store = getGitLabWebhookStore();

    if (id) {
      const config = await store.getConfig(id);
      if (!config) {
        return NextResponse.json({ error: "GitLab webhook config not found" }, { status: 404 });
      }
      return NextResponse.json({ config: maskToken(config) });
    }

    const allConfigs = await store.listConfigs(undefined);
    return NextResponse.json({ configs: allConfigs.map(maskToken) });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] GET error:", err);
    return NextResponse.json({ error: "Failed to load GitLab webhook configs", details: String(err) }, { status: 500 });
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      name, repo, gitlabToken, webhookSecret, eventTypes, labelFilter,
      triggerAgentId, workflowId, workspaceId, enabled, promptTemplate,
    } = body;

    if (!name || !repo || !gitlabToken || !triggerAgentId || !Array.isArray(eventTypes) || eventTypes.length === 0) {
      return NextResponse.json(
        { error: "Required: name, repo, gitlabToken, triggerAgentId, eventTypes (non-empty array)" },
        { status: 400 },
      );
    }

    const store = getGitLabWebhookStore();
    const config = await store.createConfig({
      name,
      repo,
      gitlabToken,
      webhookSecret: webhookSecret ?? "",
      eventTypes,
      labelFilter: labelFilter ?? [],
      triggerAgentId,
      workflowId,
      workspaceId,
      enabled: enabled !== false,
      promptTemplate: promptTemplate || `GitLab event: {{event}} {{action}} on {{repo}}\n\n{{context}}`,
    });

    return NextResponse.json({
      config: maskToken(config),
    }, { status: 201 });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] POST error:", err);
    return NextResponse.json({ error: "Failed to create GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.id) {
      return NextResponse.json({ error: "Request body must include id" }, { status: 400 });
    }

    const store = getGitLabWebhookStore();
    const updated = await store.updateConfig(body);
    if (!updated) {
      return NextResponse.json({ error: "GitLab webhook config not found" }, { status: 404 });
    }

    return NextResponse.json({ config: maskToken(updated) });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] PUT error:", err);
    return NextResponse.json({ error: "Failed to update GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing required query param: id" }, { status: 400 });
    }

    const store = getGitLabWebhookStore();
    await store.deleteConfig(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[GitLabWebhookConfigs] DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete GitLab webhook config", details: String(err) }, { status: 500 });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskToken<T extends { gitlabToken?: string }>(config: T): T {
  if (!config.gitlabToken) return config;
  return {
    ...config,
    gitlabToken: config.gitlabToken.length > 8
      ? `${config.gitlabToken.slice(0, 4)}...${config.gitlabToken.slice(-4)}`
      : "***",
  };
}
