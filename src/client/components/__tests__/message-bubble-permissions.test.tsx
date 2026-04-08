import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/core/chat-message";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      common: {
        save: "Save",
        cancel: "Cancel",
      },
      messageBubble: {
        requestPermissions: "Request permissions",
        permissionReason: "Reason",
        permissionApproved: "Approved",
        permissionDenied: "Denied",
        permissionScopeTurn: "This turn only",
        permissionScopeSession: "Entire session",
        permissionScopeHint: "Scope hint",
        failedToSubmit: "Failed to submit",
      },
    },
  }),
}));

import { PermissionRequestBubble } from "../message-bubble";

describe("PermissionRequestBubble", () => {
  it("renders nested ACP permission request details instead of a generic label", () => {
    const message = {
      id: "request-permission-3",
      role: "tool",
      content: "RequestPermissions",
      timestamp: "2026-04-08T11:26:56.640Z",
      toolName: "RequestPermissions",
      toolStatus: "waiting",
      toolCallId: "request-permission-3",
      toolKind: "request-permissions",
      toolRawInput: {
        sessionId: "019d6c8e-24ec-72a3-a5fb-a5aa25d943d6",
        toolCall: {
          toolCallId: "call_Z0tz4oeHVn0v0LFNUXmACXUR",
          kind: "execute",
          status: "pending",
          title: "Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?\nProposed Amendment: gh\napi",
              },
            },
          ],
          rawInput: {
            reason: "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?",
            command: [
              "/bin/zsh",
              "-lc",
              "gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
            ],
            proposed_execpolicy_amendment: ["gh", "api"],
          },
        },
        options: [
          {
            optionId: "approved-for-session",
            name: "Always",
            kind: "allow_always",
          },
          {
            optionId: "approved",
            name: "Yes",
            kind: "allow_once",
          },
          {
            optionId: "abort",
            name: "No, provide feedback",
            kind: "reject_once",
          },
        ],
      },
    } as unknown as ChatMessage;

    render(<PermissionRequestBubble message={message} onSubmit={vi.fn()} />);

    expect(screen.getByText("Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open")).not.toBeNull();
    expect(screen.getByText("Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Yes" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "No, provide feedback" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Always" })).not.toBeNull();
    expect(screen.getByText("command_prefix")).not.toBeNull();
    expect(screen.getByText(/"gh"/)).not.toBeNull();
    expect(screen.getByText(/"api"/)).not.toBeNull();
  });
});
