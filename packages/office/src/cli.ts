#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  extractDocxProto,
  extractPptxProto,
  extractXlsxProto,
  getReaderVersion,
} from "./index.js";
import { renderPptxCursorCanvasSource } from "./cursor-canvas.js";
import {
  renderDocxCursorCanvasSource,
  renderXlsxCursorCanvasSource,
} from "./office-canvas.js";

type CliOptions = {
  command: string;
  cursor: boolean;
  cursorProject?: string;
  inputPath?: string;
  maxColumns?: number;
  maxRows?: number;
  mediaQuality?: number;
  mediaWidth?: number;
  name?: string;
  outputPath?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help" || !options.inputPath) {
    printHelp();
    return;
  }
  if (options.command !== "canvas" && options.command !== "convert") {
    throw new Error(`Unknown command: ${options.command}`);
  }

  const inputPath = path.resolve(options.inputPath);
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }
  const extension = path.extname(inputPath).toLowerCase();
  const outputPath = resolveOutputPath(inputPath, options);
  const sourceBytes = new Uint8Array(await readFile(inputPath));
  const readerVersion = await getReaderVersion();
  const source =
    extension === ".pptx"
      ? await renderPptxCursorCanvasSource(await extractPptxProto(sourceBytes), {
          mediaQuality: options.mediaQuality,
          mediaWidth: options.mediaWidth,
          readerVersion,
          sourcePath: inputPath,
          title: path.basename(inputPath),
        })
      : extension === ".docx"
        ? await renderDocxCursorCanvasSource(await extractDocxProto(sourceBytes), {
            mediaQuality: options.mediaQuality,
            mediaWidth: options.mediaWidth,
            readerVersion,
            sourcePath: inputPath,
            title: path.basename(inputPath),
          })
        : extension === ".xlsx"
          ? renderXlsxCursorCanvasSource(await extractXlsxProto(sourceBytes), {
              maxColumns: options.maxColumns,
              maxRows: options.maxRows,
              readerVersion,
              sourcePath: inputPath,
              title: path.basename(inputPath),
            })
          : null;
  if (!source) {
    throw new Error("Cursor Canvas conversion supports .pptx, .docx, and .xlsx files.");
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, "utf8");
  if (shouldWriteCursorStatus(outputPath, options)) {
    await writeFile(
      cursorStatusPath(outputPath),
      JSON.stringify({ status: "rendered" }),
      "utf8",
    );
  }
  console.log(JSON.stringify({ inputPath, outputPath, type: "cursor-canvas" }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: args[0] ?? "help",
    cursor: false,
  };
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--cursor") {
      options.cursor = true;
    } else if (arg === "--cursor-project") {
      options.cursorProject = requiredValue(args, ++index, arg);
    } else if (arg === "--name") {
      options.name = requiredValue(args, ++index, arg);
    } else if (arg === "--media-quality") {
      options.mediaQuality = numberValue(requiredValue(args, ++index, arg), arg);
    } else if (arg === "--media-width") {
      options.mediaWidth = numberValue(requiredValue(args, ++index, arg), arg);
    } else if (arg === "--max-columns") {
      options.maxColumns = numberValue(requiredValue(args, ++index, arg), arg);
    } else if (arg === "--max-rows") {
      options.maxRows = numberValue(requiredValue(args, ++index, arg), arg);
    } else if (arg === "--output" || arg === "-o") {
      options.outputPath = requiredValue(args, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else if (!arg.startsWith("-") && !options.inputPath) {
      options.inputPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function numberValue(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${option}: ${value}`);
  }
  return parsed;
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function resolveOutputPath(inputPath: string, options: CliOptions): string {
  const basename = `${slugify(options.name ?? path.basename(inputPath, path.extname(inputPath)))}.canvas.tsx`;
  if (options.outputPath) return path.resolve(options.outputPath);
  if (options.cursorProject) {
    return path.resolve(options.cursorProject, "canvases", basename);
  }
  if (options.cursor) {
    return path.join(os.homedir(), ".cursor/projects", cursorProjectName(process.cwd()), "canvases", basename);
  }
  return path.resolve(process.cwd(), basename);
}

function shouldWriteCursorStatus(outputPath: string, options: CliOptions): boolean {
  if (options.cursor || options.cursorProject) return true;
  const normalized = outputPath.split(path.sep).join("/");
  return normalized.includes("/.cursor/projects/") && normalized.includes("/canvases/");
}

function cursorStatusPath(outputPath: string): string {
  return outputPath.replace(/\.canvas\.tsx$/u, ".canvas.status.json");
}

function cursorProjectName(cwd: string): string {
  return cwd.split(path.sep).filter(Boolean).join("-");
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96) || "office-canvas";
}

function printHelp(): void {
  console.log(`@autodev/office

Usage:
  autodev-office canvas <file.pptx|file.docx|file.xlsx> [--output file.canvas.tsx]
  autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor
  autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor-project ~/.cursor/projects/<project>

Options:
  -o, --output <path>          Write the generated Cursor Canvas file.
      --cursor                Write into the Cursor project for the current cwd.
      --cursor-project <dir>  Write into <dir>/canvases.
      --media-quality <1-100> JPEG quality for embedded media. Default: 70.
      --media-width <px>      Max embedded media width. Default: 1280.
      --max-columns <n>       Max XLSX columns to render. Default: 24.
      --max-rows <n>          Max XLSX rows to render. Default: 100.
      --name <slug>           Override the output file basename.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
