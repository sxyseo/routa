import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSessionEventBroadcaster } from "../event-broadcaster";
import {
  SharedSessionError,
  SharedSessionNotificationHub,
  SharedSessionService,
} from "../service";

class FakeSessionHub implements SharedSessionNotificationHub {
  private readonly sessions = new Map<string, { sessionId: string; workspaceId: string }>();
  private readonly interceptors = new Map<string, Set<(notification: Record<string, unknown>) => void>>();

  addSession(sessionId: string, workspaceId = "default"): void {
    this.sessions.set(sessionId, { sessionId, workspaceId });
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  addNotificationInterceptor(sessionId: string, handler: (notification: Record<string, unknown>) => void): void {
    let handlers = this.interceptors.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.interceptors.set(sessionId, handlers);
    }
    handlers.add(handler);
  }

  removeNotificationInterceptor(sessionId: string, handler: (notification: Record<string, unknown>) => void): void {
    const handlers = this.interceptors.get(sessionId);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.interceptors.delete(sessionId);
    }
  }

  emit(sessionId: string, notification: Record<string, unknown>): void {
    const handlers = this.interceptors.get(sessionId);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(notification);
    }
  }
}

describe("SharedSessionService", () => {
  let hub: FakeSessionHub;
  let broadcaster: SharedSessionEventBroadcaster;
  let promptDispatcher: ReturnType<typeof vi.fn>;
  let service: SharedSessionService;

  beforeEach(() => {
    hub = new FakeSessionHub();
    hub.addSession("host-session-1", "workspace-1");
    broadcaster = new SharedSessionEventBroadcaster();
    promptDispatcher = vi.fn(async () => {});
    service = new SharedSessionService(hub, promptDispatcher, broadcaster);
  });

  it("fans out host session updates to shared-session subscribers", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "view_only",
    });

    const events: Array<{ type: string }> = [];
    const unsubscribe = broadcaster.subscribe(session.id, (event) => {
      events.push({ type: event.type });
    });

    hub.emit("host-session-1", {
      sessionId: "host-session-1",
      update: { sessionUpdate: "agent_message_chunk", content: { text: "hello" } },
    });

    unsubscribe();
    expect(events.some((event) => event.type === "host_session_update")).toBe(true);
  });

  it("creates pending approvals and dispatches after host approval", async () => {
    const { session, hostParticipant } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_with_approval",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "collaborator",
    });

    const pending = service.sendPrompt({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
      prompt: "Please review this failing test.",
    });

    expect(pending.status).toBe("pending");
    expect(promptDispatcher).not.toHaveBeenCalled();

    const approved = service.respondToApproval({
      sharedSessionId: session.id,
      approvalId: pending.approval!.id,
      participantId: hostParticipant.id,
      participantToken: hostParticipant.accessToken,
      action: "approve",
    });

    expect(approved.status).toBe("approved");
    expect(promptDispatcher).toHaveBeenCalledTimes(1);
    expect(promptDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedSessionId: session.id,
        hostSessionId: "host-session-1",
        participantId: participant.id,
        prompt: "Please review this failing test.",
      }),
    );
    await Promise.resolve();
  });

  it("dispatches collaborator prompts directly in prompt_direct mode", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "prompt_direct",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "guest-user",
      role: "collaborator",
    });

    const result = service.sendPrompt({
      sharedSessionId: session.id,
      participantId: participant.id,
      participantToken: participant.accessToken,
      prompt: "Run full verification for this task.",
    });

    expect(result.status).toBe("approved");
    expect(promptDispatcher).toHaveBeenCalledTimes(1);
  });

  it("enforces mode permissions for message and prompt actions", () => {
    const { session } = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "view_only",
    });

    const { participant } = service.joinSession({
      sharedSessionId: session.id,
      inviteToken: session.inviteToken,
      userId: "viewer-user",
      role: "viewer",
    });

    expect(() =>
      service.sendMessage({
        sharedSessionId: session.id,
        participantId: participant.id,
        participantToken: participant.accessToken,
        text: "Can I comment?",
      }),
    ).toThrowError(SharedSessionError);

    const another = service.createSession({
      hostSessionId: "host-session-1",
      hostUserId: "host-user",
      mode: "comment_only",
    });
    const collaborator = service.joinSession({
      sharedSessionId: another.session.id,
      inviteToken: another.session.inviteToken,
      userId: "collab-user",
      role: "collaborator",
    });

    expect(() =>
      service.sendPrompt({
        sharedSessionId: another.session.id,
        participantId: collaborator.participant.id,
        participantToken: collaborator.participant.accessToken,
        prompt: "Try prompt in comment mode.",
      }),
    ).toThrowError(SharedSessionError);
  });
});

