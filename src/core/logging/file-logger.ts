import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_DIR = join(process.cwd(), "log");
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

let stream: ReturnType<typeof createWriteStream> | null = null;
let currentDate = "";

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getStream(): NonNullable<typeof stream> {
  const today = dateStamp();
  if (stream && currentDate === today) return stream;

  stream?.end();
  currentDate = today;
  ensureLogDir();
  stream = createWriteStream(join(LOG_DIR, `${today}.log`), { flags: "a" });
  stream.on("error", (err) => {
    process.stderr.write(`[file-logger] write error: ${err.message}\n`);
    stream = null;
    currentDate = "";
  });
  return stream;
}

function shouldRotate(): boolean {
  if (!stream || !currentDate) return false;
  try {
    const s = statSync(join(LOG_DIR, `${currentDate}.log`));
    return s.size >= MAX_FILE_SIZE;
  } catch {
    return false;
  }
}

function writeToFile(level: LogLevel, args: unknown[]): void {
  try {
    if (shouldRotate()) {
      stream?.end();
      stream = null;
      currentDate = "";
    }
    const s = getStream();
    const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
    const body = args.map((a) => (typeof a === "string" ? a : format("%O", a))).join(" ");
    s.write(`${prefix} ${body}\n`);
  } catch {
    // silent – never let logging break the app
  }
}

type ConsoleMethod = (...args: unknown[]) => void;

function patchConsole(): void {
  const methods: [LogLevel, keyof Console][] = [
    ["debug", "debug"],
    ["info", "log"],
    ["warn", "warn"],
    ["error", "error"],
  ];

  for (const [level, method] of methods) {
    const original = console[method] as ConsoleMethod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[method] = (...args: unknown[]) => {
      original.apply(console, args);
      writeToFile(level, args);
    };
  }
}

export function installConsoleFileLogger(): void {
  if (process.env.ROUTA_FILE_LOGGING === "0") return;

  patchConsole();
  console.log(`[file-logger] Console output mirrored to ${LOG_DIR}/`);
}
