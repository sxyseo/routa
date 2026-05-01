import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import officeWasmConfig from "../../src/app/debug/office-wasm-poc/office-wasm-config";
import type {
  RoutaOfficeArtifact,
  RoutaOfficeChart,
  RoutaOfficeCell,
  RoutaOfficeConditionalFormat,
  RoutaOfficeDataValidation,
  RoutaOfficeImageAsset,
  RoutaOfficeMergedRange,
  RoutaOfficeRow,
  RoutaOfficeSheet,
  RoutaOfficeSheetTable,
  RoutaOfficeSlide,
  RoutaOfficeTable,
  RoutaOfficeTextBlock,
} from "../../src/client/office-document-viewer/protocol/office-artifact-types";

type ReaderExports = {
  PptxReader: {
    ExtractSlidesProto: (bytes: Uint8Array, ignoreErrors: boolean) => Uint8Array | ArrayBuffer | number[];
  };
  XlsxReader: {
    ExtractXlsxProto: (bytes: Uint8Array, ignoreErrors: boolean) => Uint8Array | ArrayBuffer | number[];
  };
};

type DecodeRoutaOfficeArtifact = (bytes: Uint8Array) => RoutaOfficeArtifact;

type DecodePresentation = (bytes: Uint8Array) => Record<string, unknown>;

type FixtureCase = {
  kind: "pptx" | "xlsx";
  name: string;
  path: string;
};

const repoRoot = path.resolve(import.meta.dirname, "../..");
const bundleEntry = path.join(repoRoot, "public/office-wasm-reader/main.js");
const fixturesDir = path.join(repoRoot, "tools/office-wasm-reader/fixtures");
const goldenDir = path.join(fixturesDir, "golden");
const updateGoldens = process.argv.includes("--update");
const fixtureFilter = new Set(readRepeatedOption("--only"));

const fixtureCases: FixtureCase[] = [
  {
    kind: "xlsx",
    name: "complex_excel_renderer_test",
    path: path.join(fixturesDir, "complex_excel_renderer_test.xlsx"),
  },
  {
    kind: "pptx",
    name: "agentic_ui_proactive_agent_technical_blueprint",
    path: path.join(fixturesDir, "agentic_ui_proactive_agent_technical_blueprint.pptx"),
  },
];

async function main(): Promise<void> {
  if (!existsSync(bundleEntry)) {
    throw new Error("Office WASM bundle is missing. Run `npm run build:office-wasm-reader` first.");
  }

  const decodeRoutaOfficeArtifact = await loadArtifactDecoder();
  const decodePresentation = await loadPresentationDecoder();
  const exports = await loadReaderExports();
  for (const fixture of fixtureCases.filter((fixture) => fixtureFilter.size === 0 || fixtureFilter.has(fixture.name))) {
    const bytes = readFileSync(fixture.path);
    const protoBytes =
      fixture.kind === "xlsx"
        ? exports.XlsxReader.ExtractXlsxProto(bytes, false)
        : exports.PptxReader.ExtractSlidesProto(bytes, false);
    const protoPayload = toUint8Array(protoBytes);
    const summary =
      fixture.kind === "pptx"
        ? summarizePresentation(decodePresentation(protoPayload), protoPayload)
        : summarizeArtifact(decodeRoutaOfficeArtifact(protoPayload), protoPayload);
    const goldenPath = path.join(goldenDir, `${fixture.name}.json`);
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;

    if (updateGoldens) {
      writeFileSync(goldenPath, serialized);
      console.log(`updated ${path.relative(repoRoot, goldenPath)}`);
      continue;
    }

    const expected = readFileSync(goldenPath, "utf8");
    if (expected !== serialized) {
      throw new Error(`Fixture output changed: ${path.relative(repoRoot, goldenPath)}`);
    }

    console.log(`ok ${fixture.name}`);
  }
}

function readRepeatedOption(optionName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === optionName && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index++;
    }
  }

  return values;
}

async function loadPresentationDecoder(): Promise<DecodePresentation> {
  const imported = await import(
    pathToFileURL(path.join(repoRoot, officeWasmConfig.OFFICE_WASM_TMP_ASSET_DIR, officeWasmConfig.OFFICE_WASM_READER_MODULES.presentation)).href
  ) as {
    Presentation?: { decode?: DecodePresentation };
    default?: { Presentation?: { decode?: DecodePresentation } };
    "module.exports"?: { Presentation?: { decode?: DecodePresentation } };
  };

  const decoder =
    imported.Presentation?.decode ??
    imported.default?.Presentation?.decode ??
    imported["module.exports"]?.Presentation?.decode;

  if (!decoder) {
    throw new Error("Could not load Walnut Presentation decoder.");
  }

  return decoder;
}

async function loadArtifactDecoder(): Promise<DecodeRoutaOfficeArtifact> {
  const imported = (await import(
    "../../src/client/office-document-viewer/protocol/office-artifact-protobuf"
  )) as unknown as {
    decodeRoutaOfficeArtifact?: DecodeRoutaOfficeArtifact;
    default?: { decodeRoutaOfficeArtifact?: DecodeRoutaOfficeArtifact };
    "module.exports"?: { decodeRoutaOfficeArtifact?: DecodeRoutaOfficeArtifact };
  };
  const decoder =
    imported.decodeRoutaOfficeArtifact ??
    imported.default?.decodeRoutaOfficeArtifact ??
    imported["module.exports"]?.decodeRoutaOfficeArtifact;

  if (!decoder) {
    throw new Error("Could not load decodeRoutaOfficeArtifact.");
  }

  return decoder;
}

async function loadReaderExports(): Promise<ReaderExports> {
  await import(pathToFileURL(bundleEntry).href);
  const bridge = (globalThis as typeof globalThis & {
    RoutaOfficeWasmReader?: { exports?: ReaderExports };
  }).RoutaOfficeWasmReader;

  if (!bridge?.exports) {
    throw new Error("RoutaOfficeWasmReader exports were not initialized.");
  }

  return bridge.exports;
}

function summarizeArtifact(artifact: RoutaOfficeArtifact, protoPayload: Uint8Array): unknown {
  return {
    chartCount: artifact.charts.length,
    charts: artifact.charts.slice(0, 12).map(summarizeChart),
    diagnostics: artifact.diagnostics,
    imageCount: artifact.images.length,
    images: artifact.images.slice(0, 12).map(summarizeImage),
    metadata: artifact.metadata,
    sheetCount: artifact.sheets.length,
    sheets: artifact.sheets.slice(0, 8).map(summarizeSheet),
    slideCount: artifact.slides.length,
    slides: artifact.slides.slice(0, 12).map(summarizeSlide),
    sourceKind: artifact.sourceKind,
    tableCount: artifact.tables.length,
    tables: artifact.tables.slice(0, 8).map(summarizeTable),
    textBlockCount: artifact.textBlocks.length,
    textBlocks: artifact.textBlocks.slice(0, 20).map(summarizeTextBlock),
    title: artifact.title,
    wasmProtoByteLength: protoPayload.length,
    wasmProtoSha256: createHash("sha256").update(protoPayload).digest("hex"),
  };
}

function summarizePresentation(presentation: Record<string, unknown>, protoPayload: Uint8Array): unknown {
  const slides = arrayOfRecords(presentation.slides);
  return {
    chartCount: arrayOfRecords(presentation.charts).length,
    imageCount: arrayOfRecords(presentation.images).length,
    layoutCount: arrayOfRecords(presentation.layouts).length,
    protocol: "oaiproto.coworker.presentation.Presentation",
    slideCount: slides.length,
    slides: slides.slice(0, 12).map(summarizePresentationSlide),
    wasmProtoByteLength: protoPayload.length,
    wasmProtoSha256: createHash("sha256").update(protoPayload).digest("hex"),
  };
}

function summarizePresentationSlide(slide: Record<string, unknown>): unknown {
  const elements = arrayOfRecords(slide.elements);
  return {
    elementCount: elements.length,
    elementTypes: countBy(elements, (element) => String(element.type ?? "unset")),
    hasBackground: isRecord(slide.background),
    heightEmu: slide.heightEmu,
    id: slide.id,
    index: slide.index,
    textElementCount: elements.filter((element) => element.type === 1).length,
    shapeElementCount: elements.filter((element) => element.type === 5).length,
    previewElements: elements.slice(0, 10).map(summarizePresentationElement),
    widthEmu: slide.widthEmu,
  };
}

function summarizePresentationElement(element: Record<string, unknown>): unknown {
  const paragraphs = arrayOfRecords(element.paragraphs);
  return {
    bbox: element.bbox,
    hasFill: isRecord(element.fill) || isRecord(asRecord(element.shape)?.fill),
    hasLine: isRecord(element.line) || isRecord(asRecord(element.shape)?.line),
    id: element.id,
    name: element.name,
    paragraphCount: paragraphs.length,
    textPreview: paragraphs.map(paragraphText).filter(Boolean).join(" ").slice(0, 160),
    type: element.type,
  };
}

function summarizeSheet(sheet: RoutaOfficeSheet): unknown {
  return {
    cellCount: sheet.rows.reduce((total, row) => total + row.cells.length, 0),
    conditionalFormatCount: sheet.conditionalFormats.length,
    conditionalFormats: sheet.conditionalFormats.slice(0, 12).map(summarizeConditionalFormat),
    dataValidationCount: sheet.dataValidations.length,
    dataValidations: sheet.dataValidations.slice(0, 12).map(summarizeDataValidation),
    formulaCellCount: sheet.rows.reduce(
      (total, row) => total + row.cells.filter(cell => cell.formula.length > 0).length,
      0,
    ),
    mergedRangeCount: sheet.mergedRanges.length,
    mergedRanges: sheet.mergedRanges.slice(0, 20).map(summarizeMergedRange),
    name: sheet.name,
    previewCells: summarizePreviewCells(sheet),
    rowCount: sheet.rows.length,
    tableCount: sheet.tables.length,
    tables: sheet.tables.slice(0, 12).map(summarizeSheetTable),
  };
}

function summarizeTable(table: RoutaOfficeTable): unknown {
  return {
    path: table.path,
    rowCount: table.rows.length,
    rows: table.rows.slice(0, 8).map(summarizeRow),
  };
}

function summarizeRow(row: RoutaOfficeRow): unknown {
  return {
    cellCount: row.cells.length,
    cells: row.cells.slice(0, 12).map(summarizeCell),
  };
}

function summarizePreviewCells(sheet: RoutaOfficeSheet): unknown {
  return sheet.rows
    .flatMap(row => row.cells)
    .filter(cell => cell.text.length > 0 || cell.formula.length > 0)
    .slice(0, 12)
    .map(summarizeCell);
}

function summarizeCell(cell: RoutaOfficeCell): unknown {
  return {
    address: cell.address,
    formula: cell.formula,
    text: truncate(cell.text, 120),
  };
}

function summarizeSlide(slide: RoutaOfficeSlide): unknown {
  return {
    index: slide.index,
    textBlockCount: slide.textBlocks.length,
    textBlocks: slide.textBlocks.slice(0, 16).map(summarizeTextBlock),
    title: truncate(slide.title, 160),
  };
}

function summarizeTextBlock(block: RoutaOfficeTextBlock): unknown {
  return {
    path: block.path,
    text: truncate(block.text, 160),
  };
}

function summarizeImage(image: RoutaOfficeImageAsset): unknown {
  return {
    byteLength: image.bytes.length,
    contentType: image.contentType,
    id: image.id,
    path: image.path,
    sha256: createHash("sha256").update(image.bytes).digest("hex"),
  };
}

function summarizeChart(chart: RoutaOfficeChart): unknown {
  return {
    chartType: chart.chartType,
    id: chart.id,
    path: chart.path,
    title: truncate(chart.title, 160),
  };
}

function summarizeMergedRange(range: RoutaOfficeMergedRange): unknown {
  return {
    reference: range.reference,
  };
}

function summarizeSheetTable(table: RoutaOfficeSheetTable): unknown {
  return {
    name: table.name,
    reference: table.reference,
  };
}

function summarizeDataValidation(validation: RoutaOfficeDataValidation): unknown {
  return {
    formula1: truncate(validation.formula1, 120),
    formula2: truncate(validation.formula2, 120),
    operator: validation.operator,
    ranges: validation.ranges.slice(0, 12),
    type: validation.type,
  };
}

function summarizeConditionalFormat(format: RoutaOfficeConditionalFormat): unknown {
  return {
    priority: format.priority,
    ranges: format.ranges.slice(0, 12),
    type: format.type,
  };
}

function paragraphText(paragraph: Record<string, unknown>): string {
  return arrayOfRecords(paragraph.runs)
    .map((run) => typeof run.text === "string" ? run.text : "")
    .join("");
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const itemKey = key(item);
    counts[itemKey] = (counts[itemKey] ?? 0) + 1;
    return counts;
  }, {});
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toUint8Array(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

main()
  .then(() => {
    setTimeout(() => process.exit(0), 0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    setTimeout(() => process.exit(1), 0);
  });
