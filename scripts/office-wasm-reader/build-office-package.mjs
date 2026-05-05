/**
 * build-office-package.mjs
 *
 * Full build pipeline for the @autodev/office npm package:
 *   1. dotnet publish (browser-wasm AppBundle)
 *   2. Copy bundle  ->  public/office-wasm-reader/   (Next.js static assets)
 *   3. Copy bundle  ->  packages/office/wasm/         (npm package assets)
 *   4. tsc  ->  packages/office/dist/                 (TypeScript compile)
 *
 * Usage:
 *   node scripts/office-wasm-reader/build-office-package.mjs
 *
 * Environment:
 *   DOTNET   Override the dotnet executable path.
 */

import { chmodSync, cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const projectPath = path.join(
  repoRoot,
  "tools/office-wasm-reader/Routa.OfficeWasmReader/Routa.OfficeWasmReader.csproj",
);
const projectDir = path.dirname(projectPath);
const publishDir = path.join(
  repoRoot,
  "tools/office-wasm-reader/artifacts/publish",
);

/** Output destinations */
const publicDir = path.join(repoRoot, "public/office-wasm-reader");
const packageWasmDir = path.join(repoRoot, "packages/office/wasm");

const dotnetHome = path.join(repoRoot, "tools/office-wasm-reader/.dotnet-home");
const nugetPackages = path.join(
  repoRoot,
  "tools/office-wasm-reader/.nuget/packages",
);
const dotnetCommand =
  process.env.DOTNET ??
  (existsSync("/opt/homebrew/opt/dotnet@9/libexec/dotnet")
    ? "/opt/homebrew/opt/dotnet@9/libexec/dotnet"
    : "dotnet");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DOTNET_CLI_HOME: process.env.DOTNET_CLI_HOME ?? dotnetHome,
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      NUGET_PACKAGES: process.env.NUGET_PACKAGES ?? nugetPackages,
    },
    stdio: "inherit",
    ...options,
  });

  if (result.error?.code === "ENOENT") {
    throw new Error(
      `\`${command}\` was not found. ` +
        (command === dotnetCommand
          ? "Install .NET 9 SDK and run `dotnet workload install wasm-tools`."
          : ""),
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}`,
    );
  }
}

function findBundleRoot(publishDir) {
  const candidates = [
    path.join(publishDir, "wwwroot"),
    path.join(publishDir, "AppBundle"),
    path.join(
      repoRoot,
      "tools/office-wasm-reader/Routa.OfficeWasmReader/bin/Release/net9.0-browser/browser-wasm/AppBundle",
    ),
    publishDir,
  ];
  return candidates.find((dir) => existsSync(path.join(dir, "_framework")));
}

// ─── Step 1: dotnet publish ───────────────────────────────────────────────────

console.log("▶ Step 1/3  dotnet publish");
rmSync(publishDir, { force: true, recursive: true });
rmSync(path.join(projectDir, "bin"), { force: true, recursive: true });
rmSync(path.join(projectDir, "obj"), { force: true, recursive: true });
run(dotnetCommand, ["publish", projectPath, "-c", "Release", "-o", publishDir]);

const bundleRoot = findBundleRoot(publishDir);
if (!bundleRoot) {
  throw new Error(
    `Could not find a published browser-wasm _framework directory under ${publishDir}`,
  );
}

// ─── Step 2: Copy to public/office-wasm-reader/ (Next.js static assets) ──────

console.log(`▶ Step 2/3  copy bundle → ${path.relative(repoRoot, publicDir)}`);
rmSync(publicDir, { force: true, recursive: true });
cpSync(bundleRoot, publicDir, { recursive: true });

// ─── Step 3: Copy to packages/office/wasm/ (npm package) ─────────────────────

console.log(
  `▶ Step 3/4  copy bundle → ${path.relative(repoRoot, packageWasmDir)}`,
);
rmSync(packageWasmDir, { force: true, recursive: true });
cpSync(bundleRoot, packageWasmDir, { recursive: true });

// ─── Step 4: TypeScript compile ───────────────────────────────────────────────

console.log("▶ Step 4/4  tsc");
const tsconfigPath = path.join(repoRoot, "packages/office/tsconfig.json");
const tscBin = path.join(
  repoRoot,
  "node_modules/.bin/tsc",
);
run(tscBin, ["-p", tsconfigPath]);
chmodSync(path.join(repoRoot, "packages/office/dist/cli.js"), 0o755);

console.log("\n✓ @autodev/office package built successfully.");
console.log(`  WASM bundle : ${path.relative(repoRoot, packageWasmDir)}`);
console.log(
  `  TS output   : ${path.relative(repoRoot, path.join(repoRoot, "packages/office/dist"))}`,
);
