/**
 * @vitest-environment node
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/store/custom-mcp-server-store", () => ({
  getCustomMcpServerStore: () => null,
  mergeCustomMcpServers: (builtIn: Record<string, unknown>) => builtIn,
}));

describe("mcp-setup file-based providers", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalQoderBin: string | undefined;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-setup-home-"));
    originalHome = process.env.HOME;
    originalQoderBin = process.env.QODER_BIN;
    process.env.HOME = tmpHome;
    vi.resetModules();
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalQoderBin === undefined) {
      delete process.env.QODER_BIN;
    } else {
      process.env.QODER_BIN = originalQoderBin;
    }
    vi.resetModules();
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("reports provider support and status for registry aliases", async () => {
    const { providerSupportsMcp, getMcpStatus, ensureMcpForProvider } = await import("../mcp-setup");

    expect(providerSupportsMcp("claude-registry")).toBe(true);
    expect(providerSupportsMcp("qoder")).toBe(true);
    expect(providerSupportsMcp("unknown-provider")).toBe(false);
    expect(getMcpStatus("claude-registry", ["{}"])).toEqual({
      supported: true,
      configured: true,
      configCount: 1,
    });

    await expect(ensureMcpForProvider("unknown-provider")).resolves.toEqual({
      mcpConfigs: [],
      summary: "unknown-provider: MCP not supported",
    });
  });

  it("writes Auggie MCP config to the default file", async () => {
    const { ensureMcpForProvider } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("auggie", {
      routaServerUrl: "http://127.0.0.1:3000",
      workspaceId: "ws-auggie",
      includeCustomServers: false,
    });

    expect(result.mcpConfigs).toHaveLength(1);
    const configPath = result.mcpConfigs[0];
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { type: string; url: string; env?: Record<string, string> }>;
    };

    expect(parsed.mcpServers["routa-coordination"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:3000/api/mcp",
      env: { ROUTA_WORKSPACE_ID: "ws-auggie" },
    });
    expect(result.summary).toContain("--mcp-config");
  });

  it("writes Codex MCP config in TOML format", async () => {
    const { ensureMcpForProvider } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("codex", {
      routaServerUrl: "http://127.0.0.1:3210",
      includeCustomServers: false,
    });

    expect(result.mcpConfigs).toEqual([]);
    const configPath = path.join(tmpHome, ".codex", "config.toml");
    const raw = await fs.readFile(configPath, "utf-8");

    expect(raw).toContain("[mcp_servers.routa-coordination]");
    expect(raw).toContain('url = "http://127.0.0.1:3210/api/mcp"');
    expect(raw).toContain("enabled = true");
    expect(result.summary).toContain("codex: wrote");
  });

  it("adds and removes qoder MCP servers through the qodercli lifecycle", async () => {
    const qoderBinPath = path.join(tmpHome, "qodercli");
    const qoderLogPath = path.join(tmpHome, "qoder.log");
    const projectDir = path.join(tmpHome, "qoder-project");
    await fs.mkdir(projectDir, { recursive: true });
    const realProjectDir = await fs.realpath(projectDir);
    const mcpEndpoint = "http://127.0.0.1:3210/api/mcp?wsId=ws-qoder&sid=session-qoder";
    await fs.writeFile(
      qoderBinPath,
      `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> "${qoderLogPath}"\n`,
      "utf-8",
    );
    await fs.chmod(qoderBinPath, 0o755);
    process.env.QODER_BIN = qoderBinPath;
    vi.resetModules();

    const { cleanupMcpForProvider, ensureMcpForProvider } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("qoder", {
      routaServerUrl: "http://127.0.0.1:3210",
      mcpEndpoint,
      workspaceId: "ws-qoder",
      sessionId: "session-qoder",
      includeCustomServers: false,
      cwd: projectDir,
    });

    expect(result.mcpConfigs).toEqual([]);
    expect(result.summary).toContain("qoder: added");
    expect(result.cleanup).toEqual({
      action: "qoder-remove",
      providerId: "qoder",
      serverName: "routa-coordination",
      scope: "local",
      cwd: projectDir,
    });

    const cleanupSummary = await cleanupMcpForProvider(result.cleanup!);
    expect(cleanupSummary).toContain("qoder: removed");

    const logLines = (await fs.readFile(qoderLogPath, "utf-8"))
      .trim()
      .split("\n");
    expect(logLines).toEqual([
      `${realProjectDir}|mcp add routa-coordination ${mcpEndpoint} -t streamable-http -s local`,
      `${realProjectDir}|mcp remove routa-coordination -s local`,
    ]);
  });

  it("merges inline Claude-style JSON and ignores unreadable config entries", async () => {
    const { parseMcpServersFromConfigs } = await import("../mcp-setup");

    const parsed = parseMcpServersFromConfigs([
      "not-json",
      JSON.stringify({
        mcpServers: {
          alpha: { type: "http", url: "http://alpha.local" },
        },
      }),
      JSON.stringify({
        mcpServers: {
          beta: { type: "http", url: "http://beta.local" },
        },
      }),
    ]);

    expect(parsed).toEqual({
      alpha: { type: "http", url: "http://alpha.local" },
      beta: { type: "http", url: "http://beta.local" },
    });
  });
});
