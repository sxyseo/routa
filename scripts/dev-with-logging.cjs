#!/usr/bin/env node

/**
 * Dev launcher with file logging.
 *
 * Spawns `next dev` as a child process and tees all stdout/stderr
 * to both the terminal and a per-day log file under `log/`.
 *
 * Usage:  node scripts/dev-with-logging.js [any next dev args]
 */

const { spawn } = require("node:child_process");
const { createWriteStream, mkdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { platform } = require("node:os");

const LOG_DIR = join(process.cwd(), "log");
const MAX_AGE_DAYS = 7;

// ---------- helpers ----------

function dateStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTs(d = new Date()) {
  return `${dateStamp(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function cleanOldLogs() {
  const { readdirSync, statSync, unlinkSync } = require("node:fs");
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  try {
    for (const f of readdirSync(LOG_DIR)) {
      if (!f.endsWith(".log")) continue;
      const fp = join(LOG_DIR, f);
      try {
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      } catch { /* ignore */ }
    }
  } catch { /* dir may not exist yet */ }
}

// ---------- main ----------

// Windows TEMP \r fix: sanitize once at startup before any tmpdir usage.
// Some Windows machines have process.env.TEMP with a trailing \r,
// which causes os.tmpdir() → mkdtemp → ENOENT in all child processes.
if (process.platform === "win32") {
  const clean = (v) => typeof v === "string" ? v.replace(/[\r\n]+$/g, "") : v;
  process.env.TEMP = clean(process.env.TEMP);
  process.env.TMP  = clean(process.env.TMP);
}

ensureLogDir();
cleanOldLogs();

let currentDate = dateStamp();
let logStream = createWriteStream(join(LOG_DIR, `${currentDate}.log`), { flags: "a" });

logStream.write(`[${localTs()}] === dev server starting ===\n`);

console.log(`[dev-logger] Teeing output to ${join(LOG_DIR, `${currentDate}.log`)}`);

function rotateIfNeeded() {
  const today = dateStamp();
  if (today === currentDate) return;
  const ts = localTs();
  logStream.write(`[${ts}] === rotating log to ${today} ===\n`);
  logStream.end();
  currentDate = today;
  ensureLogDir();
  cleanOldLogs();
  logStream = createWriteStream(join(LOG_DIR, `${currentDate}.log`), { flags: "a" });
  logStream.write(`[${ts}] === log rotated from previous day ===\n`);
}

// Build the child command:
//   node_modules/.bin/next dev --max-old-space-size=8192 [user args...]
const isWin = platform() === "win32";
const nextBin = join(process.cwd(), "node_modules", ".bin", isWin ? "next.cmd" : "next");

const args = ["dev"];
// Forward any extra CLI args
const userArgs = process.argv.slice(2);
if (userArgs.length) args.push(...userArgs);

const child = spawn(nextBin, args, {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_OPTIONS: "--max-old-space-size=8192",
  },
  shell: isWin,
  windowsHide: true,
});

function tee(data, source) {
  const text = data.toString();
  // Terminal (normal)
  if (source === "stderr") {
    process.stderr.write(text);
  } else {
    process.stdout.write(text);
  }
  // Rotate log file if date changed
  rotateIfNeeded();
  // File (with timestamp prefix per line)
  const ts = localTs();
  const lines = text.replace(/\n$/, "").split("\n");
  for (const line of lines) {
    logStream.write(`[${ts}] [${source === "stderr" ? "ERR" : "OUT"}] ${line}\n`);
  }
}

child.stdout.on("data", (d) => tee(d, "stdout"));
child.stderr.on("data", (d) => tee(d, "stderr"));

child.on("close", (code) => {
  const ts = localTs();
  logStream.write(`[${ts}] === dev server exited (code=${code}) ===\n`);
  logStream.end();
  process.exit(code ?? 0);
});

child.on("error", (err) => {
  process.stderr.write(`[dev-logger] Failed to spawn next: ${err.message}\n`);
  logStream.write(`[${localTs()}] SPAWN ERROR: ${err.message}\n`);
  logStream.end();
  process.exit(1);
});

// Forward signals
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
