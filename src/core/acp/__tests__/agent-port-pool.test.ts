import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../docker/utils", () => ({
  findAvailablePort: vi.fn(),
  DOCKER_EPHEMERAL_PORT_START: 49152,
  DOCKER_EPHEMERAL_PORT_END: 65535,
  DEFAULT_DOCKER_AGENT_IMAGE: "test",
  generateContainerName: vi.fn(),
  sanitizeEnvForLogging: vi.fn(),
  shellEscape: vi.fn(),
}));

import { getAgentPortPool } from "../agent-port-pool";
import { findAvailablePort } from "../docker/utils";

const mockFindAvailablePort = vi.mocked(findAvailablePort);

describe("AgentPortPool", () => {
  beforeEach(() => {
    mockFindAvailablePort.mockReset();
    // Reset singleton between tests
    const pool = getAgentPortPool();
    pool.releaseAll();
  });

  it("allocates a port for a new session", async () => {
    mockFindAvailablePort.mockResolvedValue(54321);

    const pool = getAgentPortPool();
    const port = await pool.allocate("session-1");

    expect(port).toBe(54321);
    expect(mockFindAvailablePort).toHaveBeenCalledOnce();
  });

  it("returns same port on repeated allocate for same session", async () => {
    mockFindAvailablePort.mockResolvedValue(54321);

    const pool = getAgentPortPool();
    const port1 = await pool.allocate("session-1");
    const port2 = await pool.allocate("session-1");

    expect(port1).toBe(port2);
    expect(mockFindAvailablePort).toHaveBeenCalledOnce();
  });

  it("allocates different ports for different sessions", async () => {
    mockFindAvailablePort
      .mockResolvedValueOnce(54321)
      .mockResolvedValueOnce(54322);

    const pool = getAgentPortPool();
    const port1 = await pool.allocate("session-1");
    const port2 = await pool.allocate("session-2");

    expect(port1).not.toBe(port2);
    expect(mockFindAvailablePort).toHaveBeenCalledTimes(2);
  });

  it("releases port and allows reuse", async () => {
    mockFindAvailablePort
      .mockResolvedValueOnce(54321)
      .mockResolvedValueOnce(54321);

    const pool = getAgentPortPool();
    await pool.allocate("session-1");
    pool.release("session-1");

    expect(pool.getPort("session-1")).toBeUndefined();

    // After release, a new session can get the same port
    const port2 = await pool.allocate("session-2");
    expect(port2).toBe(54321);
  });

  it("releaseAll clears all allocations", async () => {
    mockFindAvailablePort
      .mockResolvedValueOnce(54321)
      .mockResolvedValueOnce(54322);

    const pool = getAgentPortPool();
    await pool.allocate("session-1");
    await pool.allocate("session-2");
    pool.releaseAll();

    expect(pool.getPort("session-1")).toBeUndefined();
    expect(pool.getPort("session-2")).toBeUndefined();
  });

  it("getPort returns undefined for unknown session", () => {
    const pool = getAgentPortPool();
    expect(pool.getPort("nonexistent")).toBeUndefined();
  });

  it("release is a no-op for unknown session", () => {
    const pool = getAgentPortPool();
    expect(() => pool.release("nonexistent")).not.toThrow();
  });
});
