#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

import { fromRoot } from "../lib/paths";

function resolveCargoBinary(): string {
  const rustupCargo = spawnSync("rustup", ["which", "cargo"], {
    cwd: fromRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (rustupCargo.status === 0) {
    const resolved = rustupCargo.stdout.trim();
    if (resolved) {
      return resolved;
    }
  }
  return "cargo";
}

function main(): void {
  const crate = process.argv[2] ?? "routa-core";
  const format = process.argv[3] ?? "summary";
  const cargoBin = resolveCargoBinary();

  const cargoCheck = spawnSync(cargoBin, ["--version"], { stdio: "ignore" });
  if (cargoCheck.status !== 0) {
    console.error("cargo not found");
    process.exit(1);
  }

  const llvmCovCheck = spawnSync(cargoBin, ["llvm-cov", "--version"], { stdio: "ignore" });
  if (llvmCovCheck.status !== 0) {
    console.error("cargo-llvm-cov is not installed.");
    console.error("Install with:");
    console.error("  rustup component add llvm-tools-preview");
    console.error("  cargo install cargo-llvm-cov");
    process.exit(2);
  }

  let args: string[];
  switch (format) {
    case "summary":
      args = ["llvm-cov", "-p", crate, "--summary-only"];
      break;
    case "lcov":
      args = ["llvm-cov", "-p", crate, "--lcov", "--output-path", `target/coverage/${crate}.lcov`];
      break;
    case "html":
      args = ["llvm-cov", "-p", crate, "--html"];
      break;
    default:
      console.error(`Unsupported format: ${format}`);
      console.error("Use one of: summary | lcov | html");
      process.exit(1);
  }

  if (format === "lcov") {
    fs.mkdirSync(fromRoot("target", "coverage"), { recursive: true });
  }

  const result = spawnSync(cargoBin, args, {
    cwd: fromRoot(),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (format === "lcov") {
    console.log(`LCOV written to target/coverage/${crate}.lcov`);
  }
  if (format === "html") {
    console.log("HTML report written to target/llvm-cov/html/index.html");
  }
}

main();
