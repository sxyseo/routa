import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

type ScanResult = {
  durationMs: number;
  failedChecks: string[];
  file: string;
  jsonDiffCount?: number;
  jsonDiffPaths?: string[];
  ok: boolean;
  status: "match" | "mismatch" | "error";
  stderr?: string;
};

const repoRoot = process.cwd();
const roots = positionalArgs().map((arg) => path.resolve(repoRoot, arg));
const limit = numberArg("--limit");
const skip = numberArg("--skip") ?? 0;
const assertMode = process.argv.includes("--assert");
const jsonContractMode = process.argv.includes("--json-contract");
const compareScript = path.resolve(repoRoot, "scripts/office-wasm-reader/compare-walnut-docx-protocol.ts");

if (roots.length === 0) {
  console.error(
    "Usage: npm run scan:office-wasm-reader:docx -- <docx-file-or-directory> [--skip=N] [--limit=N] [--json-contract] [--assert]",
  );
  process.exit(1);
}

const files = roots.flatMap(collectDocxFiles).slice(skip, limit == null ? undefined : skip + limit);
const startedAt = Date.now();
const results = files.map(scanFile);
const failedCheckCounts = new Map<string, number>();
const jsonDiffPathCounts = new Map<string, number>();
for (const result of results) {
  for (const check of result.failedChecks) {
    failedCheckCounts.set(check, (failedCheckCounts.get(check) ?? 0) + 1);
  }

  for (const diffPath of result.jsonDiffPaths ?? []) {
    jsonDiffPathCounts.set(diffPath, (jsonDiffPathCounts.get(diffPath) ?? 0) + 1);
  }
}

const mismatchCount = results.filter((result) => result.status === "mismatch").length;
const errorCount = results.filter((result) => result.status === "error").length;
const summary = {
  durationMs: Date.now() - startedAt,
  errorCount,
  failedCheckCounts: sortedCounts(failedCheckCounts),
  files: results,
  jsonContract: jsonContractMode,
  jsonDiffPathCounts: sortedCounts(jsonDiffPathCounts),
  mismatchCount,
  okCount: results.filter((result) => result.status === "match").length,
  total: results.length,
};

console.log(JSON.stringify(summary, null, 2));
if (assertMode && (mismatchCount > 0 || errorCount > 0)) {
  process.exit(1);
}

function scanFile(file: string): ScanResult {
  const startedAt = Date.now();
  const args = ["--import", "tsx", compareScript];
  if (jsonContractMode) {
    args.push("--json-contract-only", "--json-diff-limit", "20");
  }

  args.push(file);
  const child = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  const durationMs = Date.now() - startedAt;
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  if (child.status !== 0) {
    return {
      durationMs,
      failedChecks: [],
      file: path.relative(repoRoot, file),
      ok: false,
      status: "error",
      stderr: trimOutput(output),
    };
  }

  const decoded = parseComparatorJson(output);
  if (!decoded) {
    return {
      durationMs,
      failedChecks: [],
      file: path.relative(repoRoot, file),
      ok: false,
      status: "error",
      stderr: trimOutput(output),
    };
  }

  const parity = asRecord(decoded.parity);
  const failedChecks = Array.isArray(parity?.failedChecks) ? parity.failedChecks.filter(isString) : [];
  const jsonContract = asRecord(decoded.jsonContract);
  const jsonDiffCount = numberValue(jsonContract?.diffCount);
  const jsonDiffPaths = Array.isArray(jsonContract?.diffs)
    ? jsonContract.diffs.map((diff) => stringValue(asRecord(diff)?.path)).filter(Boolean)
    : [];
  const hasJsonMismatch = jsonContractMode && (jsonDiffCount == null || jsonDiffCount > 0);
  const ok = failedChecks.length === 0 && !hasJsonMismatch;
  return {
    durationMs,
    failedChecks,
    file: path.relative(repoRoot, file),
    jsonDiffCount: jsonContractMode ? jsonDiffCount : undefined,
    jsonDiffPaths: jsonContractMode ? jsonDiffPaths : undefined,
    ok,
    status: ok ? "match" : "mismatch",
  };
}

function parseComparatorJson(output: string): Record<string, unknown> | null {
  const marker = "\n{\n  \"byteComparison\"";
  const start = output.indexOf(marker);
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectDocxFiles(root: string): string[] {
  if (!existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`);
  }

  const stats = statSync(root);
  if (stats.isFile()) {
    return isDocxFile(root) ? [root] : [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDocxFiles(fullPath));
    } else if (entry.isFile() && isDocxFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isDocxFile(file: string): boolean {
  return path.extname(file).toLowerCase() === ".docx" && !path.basename(file).startsWith("~$");
}

function positionalArgs(): string[] {
  return process.argv.slice(2).filter((arg, index, args) => !arg.startsWith("--") && args[index - 1] !== "--limit" && args[index - 1] !== "--skip");
}

function numberArg(name: string): number | null {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sortedCounts(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function trimOutput(value: string): string {
  return value.trim().split("\n").slice(-20).join("\n");
}
