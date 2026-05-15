import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

function npmCliPath(): string {
  return path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function hasChangedTsJs(baseRef: string): boolean {
  const stdout = gitOutput(["diff", "--name-only", "--diff-filter=ACMR", baseRef, "--", "src", "apps", "crates"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .some((file) => /\.(ts|tsx|js|jsx)$/.test(file) && !/(^|[\\/])(node_modules|target|\.next|_next|bundled)([\\/]|$)/.test(file));
}

function main(): number {
  const baseRef = process.env.ROUTA_FITNESS_CHANGED_BASE?.trim() || "HEAD";
  if (!hasChangedTsJs(baseRef)) {
    console.log("No changed TS/JS files");
    return 0;
  }

  const localDepcruise = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "depcruise.cmd" : "depcruise");
  const result = spawnSync(
    process.execPath,
    [
      npmCliPath(),
      "exec",
      "--yes",
      "dependency-cruiser",
      "--",
      "--config",
      ".dependency-cruiser.cjs",
      "src",
      "--validate",
    ],
    {
      encoding: "utf8",
      stdio: "inherit",
      env: {
        ...process.env,
        PATH: `${path.dirname(localDepcruise)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

process.exit(main());
