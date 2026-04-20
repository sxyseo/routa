import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../acp/agent-port-pool", () => ({
  getAgentPortPool: vi.fn(() => ({
    allocate: vi.fn(),
    release: vi.fn(),
    getPort: vi.fn(),
    releaseAll: vi.fn(),
  })),
}));

vi.mock("net", () => ({
  default: {
    Socket: vi.fn(() => ({
      setTimeout: vi.fn(),
      once: vi.fn(),
      connect: vi.fn(),
      destroy: vi.fn(),
    })),
  },
}));

import { getTaskDevServerRegistry } from "../task-dev-server-registry";
import { getAgentPortPool } from "../../acp/agent-port-pool";

const mockPortPool = {
  allocate: vi.fn(),
  release: vi.fn(),
  getPort: vi.fn(),
  releaseAll: vi.fn(),
};

vi.mocked(getAgentPortPool).mockReturnValue(mockPortPool as never);

describe("TaskDevServerRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const registry = getTaskDevServerRegistry();
    registry.releaseAll();
  });

  it("allocates a port for a new task", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    const result = await registry.ensureForTask("task-1", "dev", "session-1");

    expect(result.port).toBe(49152);
    expect(result.url).toBe("http://localhost:49152");
    expect(mockPortPool.allocate).toHaveBeenCalledWith("task:task-1");
  });

  it("returns same port on repeated ensureForTask for same task", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    const r1 = await registry.ensureForTask("task-1", "dev", "session-1");
    const r2 = await registry.ensureForTask("task-1", "review", "session-2");

    expect(r1.port).toBe(r2.port);
    expect(mockPortPool.allocate).toHaveBeenCalledOnce();
  });

  it("allocates different ports for different tasks", async () => {
    mockPortPool.allocate
      .mockResolvedValueOnce(49152)
      .mockResolvedValueOnce(49153);

    const registry = getTaskDevServerRegistry();
    const r1 = await registry.ensureForTask("task-1", "dev", "s1");
    const r2 = await registry.ensureForTask("task-2", "dev", "s2");

    expect(r1.port).not.toBe(r2.port);
  });

  it("getForTask returns record after allocation", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "session-1");

    const record = registry.getForTask("task-1");
    expect(record).toBeDefined();
    expect(record!.port).toBe(49152);
    expect(record!.startedByColumnId).toBe("dev");
    expect(record!.startedBySessionId).toBe("session-1");
  });

  it("getUrlForTask returns correct URL", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "session-1");

    expect(registry.getUrlForTask("task-1")).toBe("http://localhost:49152");
  });

  it("getPortForTask returns port number", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "session-1");

    expect(registry.getPortForTask("task-1")).toBe(49152);
  });

  it("releaseForTask clears record and releases port", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "session-1");
    registry.releaseForTask("task-1");

    expect(registry.getForTask("task-1")).toBeUndefined();
    expect(mockPortPool.release).toHaveBeenCalledWith("task:task-1");
  });

  it("releaseAll clears all records and releases all ports", async () => {
    mockPortPool.allocate
      .mockResolvedValueOnce(49152)
      .mockResolvedValueOnce(49153);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "s1");
    await registry.ensureForTask("task-2", "dev", "s2");
    registry.releaseAll();

    expect(registry.getForTask("task-1")).toBeUndefined();
    expect(registry.getForTask("task-2")).toBeUndefined();
    expect(mockPortPool.release).toHaveBeenCalledTimes(2);
  });

  it("getActiveTaskIds returns all allocated task IDs", async () => {
    mockPortPool.allocate
      .mockResolvedValueOnce(49152)
      .mockResolvedValueOnce(49153);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "s1");
    await registry.ensureForTask("task-2", "dev", "s2");

    const ids = registry.getActiveTaskIds();
    expect(ids).toContain("task-1");
    expect(ids).toContain("task-2");
  });

  it("shouldRelease returns false for healthy fresh record", async () => {
    mockPortPool.allocate.mockResolvedValue(49152);

    const registry = getTaskDevServerRegistry();
    await registry.ensureForTask("task-1", "dev", "s1");

    expect(registry.shouldRelease("task-1")).toBe(false);
  });

  it("shouldRelease returns true for unknown task", () => {
    const registry = getTaskDevServerRegistry();
    expect(registry.shouldRelease("nonexistent")).toBe(false);
  });

  it("releaseForTask is no-op for unknown task", () => {
    const registry = getTaskDevServerRegistry();
    expect(() => registry.releaseForTask("nonexistent")).not.toThrow();
  });
});
