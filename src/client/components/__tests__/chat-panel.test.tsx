import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "../chat-panel";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chat: {
        typeMessage: "Type a message...",
        typeCreateSession: "Type to create session...",
        connectFirst: "Connect first",
        authRequiredTitle: "Authentication required",
        availableAuthMethods: "Available auth methods",
        viewToggle: {
          chat: "Chat",
          trace: "Trace",
        },
      },
      sessions: {
        placeholder: "Send a message to start.",
        repoPath: "Repo path",
        sessionInfo: "Session info",
      },
      common: {
        tasks: "Tasks",
        dismiss: "Dismiss",
        copyToClipboard: "Copy to clipboard",
      },
    },
  }),
}));

vi.mock("../tiptap-input", () => ({
  TiptapInput: ({ onSend }: { onSend: (text: string, context: Record<string, unknown>) => Promise<void> }) => (
    <button type="button" onClick={() => void onSend("continue", {})}>
      Send mock prompt
    </button>
  ),
}));

vi.mock("../chat-panel/hooks", () => ({
  useChatMessages: () => ({
    visibleMessages: [],
    sessions: [],
    sessionModeById: {},
    isSessionRunning: false,
    checklistItems: [],
    fileChangesState: { files: new Map(), totalAdded: 0, totalRemoved: 0 },
    usageInfo: null,
    setMessagesBySession: vi.fn(),
    setIsSessionRunning: vi.fn(),
    fetchSessions: vi.fn(),
    resetStreamingRefs: vi.fn(),
  }),
}));

describe("ChatPanel session targeting", () => {
  it("sends prompts to the ensured active session even when ACP has not selected it yet", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const onSelectSession = vi.fn(async () => {});
    const onEnsureSession = vi.fn(async () => "session-123");
    const acp = {
      connected: true,
      sessionId: null,
      updates: [],
      providers: [],
      selectedProvider: "codex",
      loading: false,
      error: null,
      authError: null,
      dockerConfigError: null,
      connect: vi.fn(),
      createSession: vi.fn(),
      selectSession: vi.fn(),
      setProvider: vi.fn(),
      setMode: vi.fn(),
      prompt: vi.fn(),
      promptSession: vi.fn(async () => {}),
      respondToUserInput: vi.fn(),
      respondToUserInputForSession: vi.fn(),
      writeTerminal: vi.fn(),
      resizeTerminal: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(),
      clearAuthError: vi.fn(),
      clearDockerConfigError: vi.fn(),
      listProviderModels: vi.fn(),
    } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;

    render(
      <ChatPanel
        acp={acp}
        activeSessionId="session-123"
        onEnsureSession={onEnsureSession}
        onSelectSession={onSelectSession}
        repoSelection={null}
        onRepoChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send mock prompt" }));

    await waitFor(() => {
      expect(onSelectSession).toHaveBeenCalledWith("session-123");
      expect(acp.promptSession).toHaveBeenCalledWith("session-123", "continue", undefined);
    });
  });
});
