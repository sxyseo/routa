#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  extractDocxProto,
  extractPptxProto,
  extractXlsxProto,
  getReaderVersion,
} from "./index.js";
import {
  renderPptxCursorCanvasSource,
  renderPptxCursorCanvasSourceFromPayload,
} from "./cursor-canvas.js";
import {
  renderDocxCursorCanvasSource,
  renderDocxCursorCanvasSourceFromPayload,
  renderXlsxCursorCanvasSource,
  renderXlsxCursorCanvasSourceFromPayload,
} from "./office-canvas.js";

type InputFormat = "json" | "office" | "proto";
type OfficeKind = "docx" | "pptx" | "xlsx";
type PptxPayload = Parameters<typeof renderPptxCursorCanvasSourceFromPayload>[0];
type DocxPayload = Parameters<typeof renderDocxCursorCanvasSourceFromPayload>[0];
type XlsxPayload = Parameters<typeof renderXlsxCursorCanvasSourceFromPayload>[0];

type CliOptions = {
  command: string;
  cursor: boolean;
  cursorProject?: string;
  inputFormat?: InputFormat;
  inputPath?: string;
  kind?: OfficeKind;
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
  const inputFormat = resolveInputFormat(extension, options);
  const kind = resolveKind(extension, options, inputFormat);
  const sourceLabel = path.basename(inputPath);
  const source = await renderCanvasSource(inputPath, inputFormat, kind, {
    maxColumns: options.maxColumns,
    maxRows: options.maxRows,
    mediaQuality: options.mediaQuality,
    mediaWidth: options.mediaWidth,
    sourceLabel,
  });
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
  const command = normalizeCommand(args[0]);
  const options: CliOptions = {
    command: command.name,
    cursor: false,
    inputPath: command.inputPath,
  };
  for (let index = command.nextIndex; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--cursor") {
      options.cursor = true;
    } else if (arg === "--cursor-project") {
      options.cursorProject = requiredValue(args, ++index, arg);
    } else if (arg === "--input-format" || arg === "--format") {
      options.inputFormat = inputFormatValue(requiredValue(args, ++index, arg), arg);
    } else if (arg === "--kind") {
      options.kind = officeKindValue(requiredValue(args, ++index, arg), arg);
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

function normalizeCommand(firstArg: string | undefined): {
  inputPath?: string;
  name: string;
  nextIndex: number;
} {
  if (!firstArg || firstArg === "--help" || firstArg === "-h") {
    return { name: "help", nextIndex: firstArg ? 1 : 0 };
  }
  if (firstArg === "canvas" || firstArg === "convert") {
    return { name: firstArg, nextIndex: 1 };
  }
  if (!firstArg.startsWith("-")) {
    return { inputPath: firstArg, name: "canvas", nextIndex: 1 };
  }
  return { name: firstArg, nextIndex: 1 };
}

async function renderCanvasSource(
  inputPath: string,
  inputFormat: InputFormat,
  kind: OfficeKind,
  options: {
    maxColumns?: number;
    maxRows?: number;
    mediaQuality?: number;
    mediaWidth?: number;
    sourceLabel: string;
  },
): Promise<string> {
  if (inputFormat === "json") {
    return renderCanvasSourceFromPayloadJson(inputPath, kind);
  }

  const inputBytes = new Uint8Array(await readFile(inputPath));
  const readerVersion = await getReaderVersion();
  const protoBytes =
    inputFormat === "proto"
      ? inputBytes
      : await extractOfficeProto(inputBytes, kind);

  const renderOptions = {
    maxColumns: options.maxColumns,
    maxRows: options.maxRows,
    mediaQuality: options.mediaQuality,
    mediaWidth: options.mediaWidth,
    readerVersion,
    sourceLabel: options.sourceLabel,
    title: options.sourceLabel,
  };

  if (kind === "pptx") {
    return renderPptxCursorCanvasSource(protoBytes, renderOptions);
  }
  if (kind === "docx") {
    return renderDocxCursorCanvasSource(protoBytes, renderOptions);
  }
  return renderXlsxCursorCanvasSource(protoBytes, renderOptions);
}

async function extractOfficeProto(bytes: Uint8Array, kind: OfficeKind): Promise<Uint8Array> {
  if (kind === "pptx") return extractPptxProto(bytes);
  if (kind === "docx") return extractDocxProto(bytes);
  return extractXlsxProto(bytes);
}

async function renderCanvasSourceFromPayloadJson(inputPath: string, kind: OfficeKind): Promise<string> {
  const payload = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  if (kind === "pptx") {
    return renderPptxCursorCanvasSourceFromPayload(payload as PptxPayload);
  }
  if (kind === "docx") {
    return renderDocxCursorCanvasSourceFromPayload(payload as DocxPayload);
  }
  return renderXlsxCursorCanvasSourceFromPayload(payload as XlsxPayload);
}

function resolveInputFormat(extension: string, options: CliOptions): InputFormat {
  if (options.inputFormat) return options.inputFormat;
  if (extension === ".json") return "json";
  if (extension === ".proto" || extension === ".pb" || extension === ".bin") return "proto";
  return "office";
}

function resolveKind(
  extension: string,
  options: CliOptions,
  inputFormat: InputFormat,
): OfficeKind {
  if (options.kind) return options.kind;
  if (extension === ".pptx") return "pptx";
  if (extension === ".docx") return "docx";
  if (extension === ".xlsx") return "xlsx";
  if (inputFormat === "office") {
    throw new Error("Cursor Canvas conversion supports .pptx, .docx, and .xlsx files.");
  }
  throw new Error(`--kind <pptx|docx|xlsx> is required for ${inputFormat} input.`);
}

function inputFormatValue(value: string, option: string): InputFormat {
  if (value === "office" || value === "proto" || value === "json") return value;
  throw new Error(`Invalid value for ${option}: ${value}. Expected office, proto, or json.`);
}

function officeKindValue(value: string, option: string): OfficeKind {
  if (value === "pptx" || value === "docx" || value === "xlsx") return value;
  throw new Error(`Invalid value for ${option}: ${value}. Expected pptx, docx, or xlsx.`);
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
  if (options.outputPath) {
    const resolvedOutputPath = path.resolve(options.outputPath);
    if (isExistingDirectory(resolvedOutputPath)) {
      return path.join(resolvedOutputPath, basename);
    }
    return resolvedOutputPath;
  }
  if (options.cursorProject) {
    return path.resolve(options.cursorProject, "canvases", basename);
  }
  if (options.cursor) {
    return path.join(os.homedir(), ".cursor/projects", cursorProjectName(process.cwd()), "canvases", basename);
  }
  return path.resolve(process.cwd(), basename);
}

function isExistingDirectory(value: string): boolean {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
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
  autodev-office <file.pptx|file.docx|file.xlsx> [--output file.canvas.tsx]
  autodev-office <payload.json> --input-format json --kind <pptx|docx|xlsx> --output file.canvas.tsx
  autodev-office <proto.bin> --input-format proto --kind <pptx|docx|xlsx> --output file.canvas.tsx
  autodev-office canvas <file.pptx|file.docx|file.xlsx> [--output file.canvas.tsx]
  autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor
  autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor-project ~/.cursor/projects/<project>

Options:
  -o, --output <path>          Write the generated Cursor Canvas file.
      --cursor                Write into the Cursor project for the current cwd.
      --cursor-project <dir>  Write into <dir>/canvases.
      --input-format <format> Input format: office, proto, or json. Default: infer from extension.
      --kind <kind>           Required for proto/json input: pptx, docx, or xlsx.
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
