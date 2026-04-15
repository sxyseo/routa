/**
 * ACP Utility functions
 *
 * Uses the platform bridge for process execution and file system access.
 */

import type { IProcessHandle } from "@/core/platform/interfaces";
import { getServerBridge } from "@/core/platform";

const WINDOWS_SPAWNABLE_EXTENSIONS = [".cmd", ".bat", ".exe", ".com"];

/**
 * Search standard Windows install directories for a command binary.
 *
 * npm-installed global CLIs go to %LOCALAPPDATA%\npm on Windows, which is
 * NOT in the default PATH — so `where <cmd>` returns nothing even when the
 * tool is installed and works fine from the terminal.
 *
 * Checks the most common npm global prefix, Claude Code's own install dir,
 * and a few other well-known locations.
 */
function findCommandOnWindows(command: string): string | null {
  const bridge = getServerBridge();
  if (bridge.env.osPlatform() !== "win32") return null;

  const path = require("path");

  const bases: string[] = [];

  // npm global install (most common for CLI tools)
  const localAppData = bridge.env.getEnv("LOCALAPPDATA");
  const appData = bridge.env.getEnv("APPDATA");
  const userProfile = bridge.env.getEnv("USERPROFILE") ?? bridge.env.getEnv("HOME");
  const programFiles = bridge.env.getEnv("ProgramFiles") ?? "C:\\Program Files";

  if (localAppData) bases.push(path.join(localAppData, "npm"));
  if (appData) bases.push(path.join(appData, "npm"));
  if (userProfile) {
    bases.push(path.join(userProfile, "AppData", "Local", "npm"));
    bases.push(path.join(userProfile, "AppData", "Roaming", "npm"));
  }
  // Claude Code own install dir
  if (localAppData) bases.push(path.join(localAppData, "claude", "code"));
  if (userProfile) bases.push(path.join(userProfile, ".claude"));
  // GitHub CLI (comes with copilot sometimes)
  if (programFiles) bases.push(path.join(programFiles, "GitHub CLI"));

  const extensions = [".cmd", ".bat", ".exe", ""];

  for (const base of bases) {
    for (const ext of extensions) {
      const candidate = path.join(base, ext ? `${command}${ext}` : command);
      try {
        const stat = bridge.fs.statSync(candidate);
        if (stat.isFile) return candidate;
      } catch {
        // Not found, try next
      }
    }
  }

  return null;
}

/**
 * Search standard Unix (macOS/Linux) install directories for a command binary.
 *
 * Node version managers and custom npm prefixes install tools to non-standard
 * paths that may not be in the inherited PATH of service-managed processes
 * (systemd, PM2, etc.).  Checking these directories avoids false "unavailable"
 * reports for tools that work fine from an interactive terminal.
 *
 * Checks in this order:
 * - nvm:        ~/.nvm/versions/node/<version>/bin/
 * - fnm:        ~/.fnm/node-versions/<version>/bin/
 * - volta:      ~/.volta/bin/
 * - npm prefix: $(npm config get prefix)/bin  (falls back to /usr/local/bin)
 * - pipx:       ~/.local/bin/
 * - cargo:      ~/.cargo/bin/
 * - homebrew:   /opt/homebrew/bin  (Apple Silicon macOS)
 */
function findCommandOnUnix(command: string): string | null {
  const bridge = getServerBridge();
  const platform = bridge.env.osPlatform();
  if (platform === "win32") return null;

  const path = require("path");

  const bases: string[] = [];

  // ── Node version managers ──────────────────────────────────────────────
  const home = bridge.env.getEnv("HOME") ?? "";
  const npmConfigPrefix = (() => {
    try {
      // Synchronous exec for config is fine here — called once per tool check
      const { execSync } = require("child_process");
      return execSync("npm config get prefix", { encoding: "utf-8", timeout: 3000 }).trim();
    } catch {
      return platform === "darwin" ? "/usr/local" : "/usr";
    }
  })();

  if (home) {
    // nvm — scan all installed node versions
    const nvmBase = path.join(home, ".nvm", "versions", "node");
    try {
      const versions = bridge.fs.readDirSync(nvmBase);
      for (const ver of versions) {
        bases.push(path.join(nvmBase, ver.name, "bin"));
      }
    } catch {
      // nvm not installed
    }

    // fnm
    const fnmBase = path.join(home, ".fnm", "node-versions");
    try {
      const versions = bridge.fs.readDirSync(fnmBase);
      for (const ver of versions) {
        bases.push(path.join(fnmBase, ver.name, "installation", "bin"));
      }
    } catch {
      // fnm not installed
    }

    // volta shims
    bases.push(path.join(home, ".volta", "bin"));

    // pipx / pip user install
    bases.push(path.join(home, ".local", "bin"));

    // Rust cargo
    bases.push(path.join(home, ".cargo", "bin"));

    // npm prefix (covers custom global installs)
    if (npmConfigPrefix && npmConfigPrefix !== "/usr") {
      bases.push(path.join(npmConfigPrefix, "bin"));
    }
  }

  // npm default (covers cases where npm prefix is /usr/local or /usr)
  if (npmConfigPrefix) {
    bases.push(path.join(npmConfigPrefix, "bin"));
  }

  // Homebrew on Apple Silicon macOS
  if (platform === "darwin") {
    bases.push("/opt/homebrew/bin");
    bases.push("/usr/local/bin"); // Intel macOS
  }

  for (const base of bases) {
    const candidate = path.join(base, command);
    try {
      const stat = bridge.fs.statSync(candidate);
      if (stat.isFile) return candidate;
    } catch {
      // Not found, try next
    }
  }

  return null;
}

function getCandidateDirectory(candidate: string): string {
  const normalized = candidate.trim().replace(/[\\/]+$/, "");
  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (lastSeparator < 0) return "";
  return normalized.slice(0, lastSeparator).toLowerCase();
}

/**
 * Whether a command path requires the shell to be invoked (Windows only).
 *
 * On Windows, batch files (`.cmd`, `.bat`) cannot be spawned directly by
 * Node.js's `child_process.spawn` — they must be executed through `cmd.exe`.
 * Passing `shell: true` to `spawn()` handles this transparently.
 */
export function needsShell(command: string): boolean {
  const lower = command.toLowerCase();

  // Explicit .cmd/.bat extension
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return true;
  }

  // On Windows, npm-installed CLI tools without extensions might be .cmd files
  // We need shell to properly resolve and execute them
  if (process.platform === "win32") {
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(command);
    const isPath = command.includes("/") || command.includes("\\");
    if (!hasExtension && !isPath) {
      return true;
    }
  }

  return false;
}

/**
 * Quote Windows wrapper paths before handing them to `spawn(..., { shell: true })`.
 *
 * Without the extra quotes, cmd.exe treats special characters as operators:
 * - `C:\Program Files\nodejs\npx.cmd` splits at the space
 * - `C:\Users\R&D\AppData\npx.cmd` treats `&` as a command separator
 * - `C:\Program Files (x86)\Tool\script.cmd` treats `(` and `)` as grouping operators
 * - Other special chars: `^`, `|`, `<`, `>`, `%`
 *
 * This function quotes all shell wrapper paths (`.cmd`, `.bat`) to handle all
 * Windows shell special characters, not just whitespace.
 */
export function quoteShellCommandPath(command: string): string {
  // Only quote paths that need shell execution (.cmd, .bat files)
  if (!needsShell(command)) {
    return command;
  }

  // Already quoted - don't double-quote
  if (command.startsWith('"') && command.endsWith('"')) {
    return command;
  }

  // Quote all shell wrapper paths to handle all special characters
  return `"${command}"`;
}

/**
 * Await async process backends (for example Tauri) until pid/stdio are wired.
 *
 * The timeout is explicitly cleared so successful spawns do not leave a
 * dangling timer behind for the full timeout duration.
 */
export async function awaitProcessReady(
  processHandle: IProcessHandle,
  timeoutMs = 30_000,
): Promise<void> {
  if (!processHandle.ready) {
    return;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      processHandle.ready,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timed out waiting for process spawn after ${timeoutMs / 1000}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function preferSpawnableWindowsPath(candidates: string[]): string | null {
  const normalized = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const firstCandidate = normalized[0];
  if (!firstCandidate) return null;

  const firstDirectory = getCandidateDirectory(firstCandidate);
  const sameDirectoryCandidates = normalized.filter(
    (candidate) => getCandidateDirectory(candidate) === firstDirectory
  );

  for (const ext of WINDOWS_SPAWNABLE_EXTENSIONS) {
    const match = sameDirectoryCandidates.find((candidate) =>
      candidate.toLowerCase().endsWith(ext)
    );
    if (match) return match;
  }

  return firstCandidate;
}

/**
 * Find an executable in PATH or node_modules/.bin.
 * Returns the resolved path if found, null otherwise.
 *
 * Checks in this order:
 * 1. Absolute path (if provided)
 * 2. node_modules/.bin (for locally installed packages)
 * 3. Standard platform install directories (Windows: npm global / Claude Code dirs;
 *    Unix: nvm / volta / fnm / npm prefix dirs)
 * 4. System PATH (using bridge.process.which)
 *
 * On Windows, npm creates a bash wrapper (no extension) alongside a `.cmd`
 * batch file in node_modules/.bin. We prefer the `.cmd` version because
 * the extensionless wrapper cannot be spawned directly by Node.js on Windows.
 */
export async function which(command: string): Promise<string | null> {
  const path = await import("path");
  const bridge = getServerBridge();
  const isWindows = bridge.env.osPlatform() === "win32";

  // 1. If command is already an absolute path, check if it exists
  if (command.startsWith("/") || command.startsWith("\\") || path.isAbsolute(command)) {
    try {
      const stat = bridge.fs.statSync(command);
      if (stat.isFile) return command;
    } catch {
      return null;
    }
  }

  // 2. Check node_modules/.bin (for locally installed packages)
  try {
    const localBinBase = path.join(bridge.env.currentDir(), "node_modules", ".bin", command);
    if (isWindows) {
      // On Windows prefer the .cmd batch file — the extensionless file is a
      // bash wrapper that cannot be spawned directly by Node.js on Windows.
      const cmdPath = localBinBase + ".cmd";
      if (bridge.fs.existsSync(cmdPath)) {
        const stat = bridge.fs.statSync(cmdPath);
        if (stat.isFile) return cmdPath;
      }
    } else {
      if (bridge.fs.existsSync(localBinBase)) {
        const stat = bridge.fs.statSync(localBinBase);
        if (stat.isFile) return localBinBase;
      }
    }
  } catch {
    // Ignore errors, continue to PATH check
  }

  // 3. Search standard Windows install directories (npm global, Claude Code, etc.)
  if (isWindows) {
    const windowsFound = findCommandOnWindows(command);
    if (windowsFound) return windowsFound;
  }

  // 4. Search standard Unix install directories (nvm, volta, fnm, etc.)
  if (!isWindows) {
    const unixFound = findCommandOnUnix(command);
    if (unixFound) return unixFound;
  }

  // 5. Check system PATH using bridge.process.which
  const resolved = await bridge.process.which(command);
  if (!resolved) return null;

  if (!isWindows) {
    return resolved;
  }

  return preferSpawnableWindowsPath(resolved.split(/\r?\n/));
}
