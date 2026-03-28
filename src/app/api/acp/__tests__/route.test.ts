import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHttpSessionStore,
  httpSessionStore,
  getSessionRoutingRecord,
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
  loadHistorySinceEventIdFromDb,
  updateSessionExecutionBindingInDb,
} = vi.hoisted(() => {
  const store = {
    attachSse: vi.fn(),
    pushConnected: vi.fn(),
    detachSse: vi.fn(),
    flushAgentBuffer: vi.fn(),
    getSession: vi.fn(),
    upsertSession: vi.fn(),
  };

  return {
    getHttpSessionStore: vi.fn(() => store),
    httpSessionStore: store,
    getSessionRoutingRecord: vi.fn(),
    getRequiredRunnerUrl: vi.fn(),
    isForwardedAcpRequest: vi.fn(),
    proxyRequestToRunner: vi.fn(),
    runnerUnavailableResponse: vi.fn(),
    loadHistorySinceEventIdFromDb: vi.fn(),
    updateSessionExecutionBindingInDb: vi.fn(),
  };
});

vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore,
}));

vi.mock("@/core/acp/runner-routing", () => ({
  getSessionRoutingRecord,
  getRequiredRunnerUrl,
  isForwardedAcpRequest,
  proxyRequestToRunner,
  runnerUnavailableResponse,
}));

vi.mock("@/core/acp/session-db-persister", async () => {
  const actual = await vi.importActual<typeof import("@/core/acp/session-db-persister")>(
    "@/core/acp/session-db-persister",
  );
  return {
    ...actual,
    loadHistorySinceEventIdFromDb,
    updateSessionExecutionBindingInDb,
  };
});

import { GET, POST } from "../route";

async function readStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let result = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    result += decoder.decode(chunk.value, { stream: true });
    if (result.includes("data: ")) {
      break;
    }
  }

  reader.cancel().catch(() => {});
  return result;
}

describe("/api/acp GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isForwardedAcpRequest.mockReturnValue(false);
    getSessionRoutingRecord.mockResolvedValue(undefined);
    getRequiredRunnerUrl.mockReturnValue(null);
    runnerUnavailableResponse.mockReturnValue(new Response("runner unavailable", { status: 503 }));
    proxyRequestToRunner.mockResolvedValue(new Response("proxied", { status: 200 }));
    loadHistorySinceEventIdFromDb.mockResolvedValue([]);
    updateSessionExecutionBindingInDb.mockResolvedValue(undefined);

    httpSessionStore.attachSse.mockReset();
    httpSessionStore.pushConnected.mockReset();
    httpSessionStore.detachSse.mockReset();
    httpSessionStore.flushAgentBuffer.mockReset();
    httpSessionStore.getSession.mockReset();
    httpSessionStore.upsertSession.mockReset();
    httpSessionStore.getSession.mockReturnValue({ cwd: "/tmp/session" });
  });

  it("replays events after lastEventId before attaching the live SSE stream", async () => {
    loadHistorySinceEventIdFromDb.mockResolvedValue([
      {
        sessionId: "session-1",
        eventId: "evt-2",
        update: { sessionUpdate: "agent_message", content: { type: "text", text: "replayed" } },
      },
    ]);

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1&lastEventId=evt-1"),
    );
    const body = await readStream(response);

    expect(loadHistorySinceEventIdFromDb).toHaveBeenCalledWith("session-1", "evt-1", "/tmp/session");
    expect(body).toContain("id: evt-2");
    expect(body).toContain("\"sessionUpdate\":\"agent_message\"");
    expect(httpSessionStore.attachSse).toHaveBeenCalledWith(
      "session-1",
      expect.anything(),
      { skipPending: true },
    );
    expect(httpSessionStore.pushConnected).toHaveBeenCalledWith("session-1");
  });

  it("falls back to normal SSE attach when no replay tail exists", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(httpSessionStore.attachSse).toHaveBeenCalledWith(
      "session-1",
      expect.anything(),
      { skipPending: false },
    );
  });

  it("refreshes the embedded lease when the current instance attaches SSE", async () => {
    getSessionRoutingRecord.mockResolvedValue({
      sessionId: "session-1",
      executionMode: "embedded",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: "2026-03-28T00:00:00.000Z",
      cwd: "/tmp/session",
      workspaceId: "default",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(httpSessionStore.attachSse).toHaveBeenCalled();
    expect(httpSessionStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
    expect(updateSessionExecutionBindingInDb).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
  });

  it("rejects SSE attach when an embedded session is owned by another instance", async () => {
    getSessionRoutingRecord.mockResolvedValue({
      executionMode: "embedded",
      ownerInstanceId: "web-2",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/acp?sessionId=session-1"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("owned by instance web-2"),
      ownerInstanceId: "web-2",
    });
    expect(httpSessionStore.attachSse).not.toHaveBeenCalled();
  });
});

describe("/api/acp POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isForwardedAcpRequest.mockReturnValue(false);
    getRequiredRunnerUrl.mockReturnValue(null);
    updateSessionExecutionBindingInDb.mockResolvedValue(undefined);
    httpSessionStore.upsertSession.mockReset();
  });

  it("returns ACP capabilities for initialize before any process exists", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
        },
        agentInfo: {
          name: "routa-acp",
          version: "0.1.0",
        },
      },
    });
  });

  it("rejects session/new when workspaceId is missing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "session/new",
          params: {
            provider: "opencode",
            cwd: "/tmp/project",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        message: "workspaceId is required",
      },
    });
  });

  it("rejects prompt methods when an embedded session is owned by another instance", async () => {
    getRequiredRunnerUrl.mockReturnValue("http://runner.internal");
    getSessionRoutingRecord.mockResolvedValue({
      executionMode: "embedded",
      ownerInstanceId: "web-2",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "session/prompt",
          params: {
            sessionId: "session-1",
            prompt: {
              role: "user",
              content: [{ type: "text", text: "hello" }],
            },
          },
        }),
      }),
    );

    expect(proxyRequestToRunner).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      error: {
        code: -32010,
        message: expect.stringContaining("owned by instance web-2"),
      },
    });
  });

  it("refreshes the embedded lease before handling session methods on the owner instance", async () => {
    getRequiredRunnerUrl.mockReturnValue("http://runner.internal");
    getSessionRoutingRecord.mockResolvedValue({
      sessionId: "session-1",
      executionMode: "embedded",
      ownerInstanceId: `next-${process.pid}`,
      leaseExpiresAt: "2000-01-01T00:00:00.000Z",
      createdAt: "2026-03-28T00:00:00.000Z",
      cwd: "/tmp/session",
      workspaceId: "default",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/acp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "session/cancel",
          params: { sessionId: "session-1" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(httpSessionStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
    expect(updateSessionExecutionBindingInDb).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        executionMode: "embedded",
        ownerInstanceId: `next-${process.pid}`,
        leaseExpiresAt: expect.any(String),
      }),
    );
  });
});
