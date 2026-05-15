/**
 * WeChat Work Channel unit tests.
 */
import { describe, it, expect, vi } from "vitest";
import { WeChatWorkChannel } from "../wechat-work-channel";

describe("WeChatWorkChannel", () => {
  it("should be not configured when env var is missing", () => {
    const original = process.env.WECHAT_WORK_WEBHOOK_URL;
    delete process.env.WECHAT_WORK_WEBHOOK_URL;
    const channel = new WeChatWorkChannel();
    expect(channel.isConfigured()).toBe(false);
    process.env.WECHAT_WORK_WEBHOOK_URL = original;
  });

  it("should return success when not configured (graceful degradation)", async () => {
    const original = process.env.WECHAT_WORK_WEBHOOK_URL;
    delete process.env.WECHAT_WORK_WEBHOOK_URL;
    const channel = new WeChatWorkChannel();
    const result = await channel.sendMarkdown("Test", "Hello");
    expect(result.success).toBe(true);
    process.env.WECHAT_WORK_WEBHOOK_URL = original;
  });

  it("should send markdown when configured", async () => {
    process.env.WECHAT_WORK_WEBHOOK_URL = "https://example.com/webhook";
    const channel = new WeChatWorkChannel();
    expect(channel.isConfigured()).toBe(true);

    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await channel.sendMarkdown("Test Title", "Test Content");
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
    delete process.env.WECHAT_WORK_WEBHOOK_URL;
  });

  it("should send escalation with approval URLs", async () => {
    process.env.WECHAT_WORK_WEBHOOK_URL = "https://example.com/webhook";
    process.env.ROUTA_PUBLIC_URL = "http://localhost:3000";
    const channel = new WeChatWorkChannel();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errcode: 0 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await channel.sendEscalation({
      decisionId: "od-123",
      pattern: "test-pattern",
      taskId: "task-1",
      description: "Test escalation",
      approveToken: "1234:abc",
    });

    expect(result.success).toBe(true);
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.msgtype).toBe("markdown");
    expect(body.markdown.content).toContain("test-pattern");
    expect(body.markdown.content).toContain("approve");
    expect(body.markdown.content).toContain("reject");

    vi.restoreAllMocks();
    delete process.env.WECHAT_WORK_WEBHOOK_URL;
    delete process.env.ROUTA_PUBLIC_URL;
  });
});
