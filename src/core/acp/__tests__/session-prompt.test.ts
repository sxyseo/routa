import { describe, expect, it } from "vitest";

import { isSessionPromptTimeoutError } from "../session-prompt";

describe("isSessionPromptTimeoutError", () => {
  it("detects session/prompt timeout errors", () => {
    expect(isSessionPromptTimeoutError(new Error("Timeout waiting for session/prompt (id=3)"))).toBe(true);
  });

  it("ignores non-timeout prompt errors", () => {
    expect(isSessionPromptTimeoutError(new Error("Permission denied"))).toBe(false);
    expect(isSessionPromptTimeoutError("Timeout waiting for session/prompt (id=3)")).toBe(false);
  });
});
