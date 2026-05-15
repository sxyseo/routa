import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

function eslintCliPath(): string {
  return path.join(process.cwd(), "node_modules", "eslint", "bin", "eslint.js");
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function listChangedLintableFiles(baseRef: string): string[] {
  const stdout = gitOutput(["diff", "--name-only", "--diff-filter=ACMR", baseRef, "--", "src", "apps", "crates"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(file))
    .filter((file) => !/(^|[\\/])(node_modules|target|\.next|_next|bundled)([\\/]|$)/.test(file));
}

function main(): number {
  const baseRef = process.env.ROUTA_FITNESS_CHANGED_BASE?.trim() || "HEAD";
  const changedFiles = listChangedLintableFiles(baseRef);
  if (changedFiles.length === 0) {
    console.log("No changed lintable files");
    return 0;
  }

  const result = spawnSync(process.execPath, [eslintCliPath(), ...changedFiles], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

process.exit(main());
