import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  RoutaOfficeArtifact,
  RoutaOfficeCell,
  RoutaOfficeChart,
  RoutaOfficeSheet,
  RoutaOfficeSpreadsheetShape,
} from "../../src/client/office-document-viewer/protocol/office-artifact-types";
import officeWasmConfig from "../../src/app/debug/office-wasm-poc/office-wasm-config";

type ReaderExports = {
  XlsxReader: {
    ExtractXlsxProto: (bytes: Uint8Array, ignoreErrors: boolean) => Uint8Array | ArrayBuffer | number[];
  };
};

type WorkbookDecoder = {
  Workbook: {
    decode: (bytes: Uint8Array) => Record<string, unknown>;
  };
};

type DecodeRoutaOfficeArtifact = (bytes: Uint8Array) => RoutaOfficeArtifact;

type XlsxComparisonResult = {
  equivalence: ReturnType<typeof summarizeEquivalence>;
  fixture: string;
  routa: ReturnType<typeof summarizeRoutaArtifact>;
  routaProtocol: string;
  targetProtocol: string;
  walnut: ReturnType<typeof summarizeWalnutWorkbook>;
};

const repoRoot = process.cwd();
const assetDir = path.resolve(repoRoot, officeWasmConfig.OFFICE_WASM_TMP_ASSET_DIR);
const generatedBundleEntry = path.resolve(repoRoot, "public/office-wasm-reader/main.js");
const assertMode = process.argv.includes("--assert");
const fixturePaths = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => path.resolve(repoRoot, arg));

if (fixturePaths.length === 0) {
  fixturePaths.push(path.resolve(repoRoot, "tools/office-wasm-reader/fixtures/complex_excel_renderer_test.xlsx"));
}

async function main(): Promise<void> {
  assertFile(assetDir, "extracted Walnut asset directory");
  assertFile(generatedBundleEntry, "generated Routa office WASM bundle");

  const results: XlsxComparisonResult[] = [];
  for (const fixturePath of fixturePaths) {
    assertFile(fixturePath, "XLSX fixture");
    results.push(await compareFixture(fixturePath));
  }

  if (assertMode) {
    for (const result of results) {
      assertCoreEquivalence(result);
      console.log(`ok ${result.fixture}`);
    }
    return;
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

async function compareFixture(fixturePath: string): Promise<XlsxComparisonResult> {
  const sourceBytes = readFileSync(fixturePath);
  const walnutProtoBytes = await extractWalnutWorkbookProto(sourceBytes);
  const walnutWorkbook = await decodeWalnutWorkbook(walnutProtoBytes);
  const routaProtoBytes = await extractRoutaArtifactProto(sourceBytes);
  const decodeRoutaOfficeArtifact = await loadRoutaArtifactDecoder();
  const routaArtifact = decodeRoutaOfficeArtifact(routaProtoBytes);

  return {
    equivalence: summarizeEquivalence(walnutWorkbook, routaArtifact),
    fixture: path.relative(repoRoot, fixturePath),
    routa: summarizeRoutaArtifact(routaArtifact, routaProtoBytes),
    routaProtocol: "RoutaOfficeArtifact",
    targetProtocol: "oaiproto.coworker.spreadsheet.Workbook",
    walnut: summarizeWalnutWorkbook(walnutWorkbook, walnutProtoBytes),
  };
}

async function loadRoutaArtifactDecoder(): Promise<DecodeRoutaOfficeArtifact> {
  const imported = await import("../../src/client/office-document-viewer/protocol/office-artifact-protobuf") as unknown as {
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

async function extractWalnutWorkbookProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
  const dotnetModule = moduleWithExport(await import(pathToFileURL(path.join(assetDir, "dotnet.js")).href), "dotnet") as {
    dotnet: {
      withConfig: (config: unknown) => {
        withResourceLoader: (loader: (resourceType: string, name: string, defaultUri: string) => string | Uint8Array) => {
          create: () => Promise<{ getAssemblyExports: (assemblyName: string) => Promise<ReaderExports> }>;
        };
      };
    };
  };

  const runtime = await dotnetModule.dotnet
    .withConfig(officeWasmConfig.OFFICE_WASM_DOTNET_RUNTIME_CONFIG)
    .withResourceLoader((resourceType, _name, defaultUri) => {
      const fullPath = path.join(assetDir, path.basename(defaultUri));
      if (resourceType === "dotnetjs") {
        return pathToFileURL(fullPath).href;
      }

      return readFileSync(fullPath);
    })
    .create();
  const exports = await runtime.getAssemblyExports("Walnut");
  return toUint8Array(exports.XlsxReader.ExtractXlsxProto(sourceBytes, false));
}

async function decodeWalnutWorkbook(protoBytes: Uint8Array): Promise<Record<string, unknown>> {
  const spreadsheetModule = moduleRoot(await import(
    pathToFileURL(path.join(assetDir, officeWasmConfig.OFFICE_WASM_READER_MODULES.spreadsheet)).href
  )) as WorkbookDecoder;

  if (!spreadsheetModule.Workbook?.decode) {
    throw new Error("Could not load Walnut spreadsheet Workbook decoder.");
  }

  return spreadsheetModule.Workbook.decode(protoBytes);
}

async function extractRoutaArtifactProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
  await import(pathToFileURL(generatedBundleEntry).href);
  const bridge = (globalThis as typeof globalThis & {
    RoutaOfficeWasmReader?: { exports?: ReaderExports };
  }).RoutaOfficeWasmReader;

  if (!bridge?.exports) {
    throw new Error("RoutaOfficeWasmReader exports were not initialized.");
  }

  return toUint8Array(bridge.exports.XlsxReader.ExtractXlsxProto(sourceBytes, false));
}

function summarizeEquivalence(
  walnutWorkbook: Record<string, unknown>,
  routaArtifact: RoutaOfficeArtifact,
) {
  const walnut = summarizeWalnutWorkbook(walnutWorkbook, new Uint8Array());
  const routa = summarizeRoutaArtifact(routaArtifact, new Uint8Array());

  return {
    sameTopLevelProtocol: false,
    sheetCountMatches: walnut.sheetCount === routa.sheetCount,
    sheetNamesMatch: stableJson(walnut.sheets.map((sheet) => sheet.name)) === stableJson(routa.sheets.map((sheet) => sheet.name)),
    sheetRowCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.rowCount)) === stableJson(routa.sheets.map((sheet) => sheet.rowCount)),
    sheetCellCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.cellCount)) === stableJson(routa.sheets.map((sheet) => sheet.cellCount)),
    sheetFormulaCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.formulaCellCount)) ===
      stableJson(routa.sheets.map((sheet) => sheet.formulaCellCount)),
    sheetColumnCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.columnCount)) === stableJson(routa.sheets.map((sheet) => sheet.columnCount)),
    mergedRangeCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.mergedRangeCount)) ===
      stableJson(routa.sheets.map((sheet) => sheet.mergedRangeCount)),
    tableCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.tableCount)) === stableJson(routa.sheets.map((sheet) => sheet.tableCount)),
    conditionalFormatCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.conditionalFormatCount)) ===
      stableJson(routa.sheets.map((sheet) => sheet.conditionalFormatGroupCount)),
    dataValidationCountsMatch:
      stableJson(walnut.sheets.map((sheet) => sheet.dataValidationCount)) ===
      stableJson(routa.sheets.map((sheet) => sheet.dataValidationCount)),
    chartCountMatches: walnut.chartCount === routa.chartCount,
    chartTitlesMatch: stableJson(walnut.chartTitles) === stableJson(routa.chartTitles),
    chartSeriesShapesMatch: stableJson(walnut.chartSeriesShapes) === stableJson(routa.chartSeriesShapes),
    imageCountMatches: walnut.imageCount === routa.imageCount,
    drawingShapeCountMatches: walnut.drawingShapeCount === routa.shapeCount,
    styleCountsMatch: stableJson(walnut.styleCounts) === stableJson(routa.styleCounts),
  };
}

function summarizeWalnutWorkbook(workbook: Record<string, unknown>, protoBytes: Uint8Array) {
  const sheets = arrayOfRecords(workbook.sheets);
  const drawings = sheets.flatMap((sheet) => arrayOfRecords(sheet.drawings).map((drawing) => ({ drawing, sheet })));
  const charts = drawings.filter(({ drawing }) => isRecord(drawing.chart));
  const shapes = drawings.filter(({ drawing }) => isRecord(drawing.shape));
  const styles = asRecord(workbook.styles) ?? {};

  return {
    protoByteLength: protoBytes.length,
    protoSha256: sha256(protoBytes),
    topLevelKeys: Object.keys(workbook),
    sheetCount: sheets.length,
    sheets: sheets.map(summarizeWalnutSheet),
    chartCount: charts.length,
    chartTitles: charts.map(({ drawing }) => String(asRecord(drawing.chart)?.title ?? "")),
    chartSeriesShapes: charts.map(({ drawing }) => summarizeWalnutChartSeriesShape(asRecord(drawing.chart) ?? {})),
    drawingShapeCount: shapes.length,
    drawingShapes: shapes.map(({ drawing, sheet }) => summarizeWalnutDrawingShape(String(sheet.name ?? ""), asRecord(drawing.shape) ?? {})),
    imageCount: arrayOfRecords(workbook.images).length,
    styleCounts: {
      borderCount: arrayOfRecords(styles.borders).length,
      cellFormatCount: arrayOfRecords(styles.cellXfs).length,
      fillCount: arrayOfRecords(styles.fills).length,
      fontCount: arrayOfRecords(styles.fonts).length,
      numberFormatCount: arrayOfRecords(styles.numberFormats).length,
    },
  };
}

function summarizeWalnutSheet(sheet: Record<string, unknown>) {
  const rows = arrayOfRecords(sheet.rows);
  const cells = rows.flatMap((row) => arrayOfRecords(row.cells));

  return {
    name: String(sheet.name ?? ""),
    rowCount: rows.length,
    cellCount: cells.length,
    formulaCellCount: cells.filter((cell) => stringValue(cell.formula).length > 0).length,
    columnCount: arrayOfRecords(sheet.columns).length,
    mergedRangeCount: arrayOfRecords(sheet.mergedCells).length,
    tableCount: arrayOfRecords(sheet.tables).length,
    conditionalFormatCount: arrayOfRecords(sheet.conditionalFormattings).length,
    dataValidationCount: arrayOfRecords(sheet.dataValidations).length,
    drawingCount: arrayOfRecords(sheet.drawings).length,
    chartDrawingCount: arrayOfRecords(sheet.drawings).filter((drawing) => isRecord(drawing.chart)).length,
    shapeDrawingCount: arrayOfRecords(sheet.drawings).filter((drawing) => isRecord(drawing.shape)).length,
    previewCells: cells
      .filter((cell) => stringValue(cell.value).length > 0 || stringValue(cell.formula).length > 0)
      .slice(0, 12)
      .map((cell) => ({
        address: stringValue(cell.address),
        formula: stringValue(cell.formula),
        value: stringValue(cell.value),
      })),
  };
}

function summarizeRoutaArtifact(artifact: RoutaOfficeArtifact, protoBytes: Uint8Array) {
  return {
    protoByteLength: protoBytes.length,
    protoSha256: sha256(protoBytes),
    sourceKind: artifact.sourceKind,
    title: artifact.title,
    metadata: artifact.metadata,
    diagnostics: artifact.diagnostics,
    sheetCount: artifact.sheets.length,
    sheets: artifact.sheets.map(summarizeRoutaSheet),
    chartCount: artifact.charts.length,
    chartTitles: artifact.charts.map((chart) => chart.title),
    chartSeriesShapes: artifact.charts.map(summarizeRoutaChartSeriesShape),
    charts: artifact.charts.map((chart) => ({
      chartType: chart.chartType,
      id: chart.id,
      path: chart.path,
      seriesCount: chart.series.length,
      sheetName: chart.sheetName,
      title: chart.title,
    })),
    imageCount: artifact.images.length,
    shapeCount: artifact.shapes.length,
    shapes: artifact.shapes.map(summarizeRoutaShape),
    styleCounts: {
      borderCount: artifact.styles.borders.length,
      cellFormatCount: artifact.styles.cellXfs.length,
      fillCount: artifact.styles.fills.length,
      fontCount: artifact.styles.fonts.length,
      numberFormatCount: artifact.styles.numberFormats.length,
    },
  };
}

function summarizeRoutaSheet(sheet: RoutaOfficeSheet) {
  const cells = sheet.rows.flatMap((row) => row.cells);

  return {
    name: sheet.name,
    rowCount: sheet.rows.length,
    cellCount: cells.length,
    formulaCellCount: cells.filter((cell) => cell.formula.length > 0).length,
    columnCount: sheet.columns.length,
    mergedRangeCount: sheet.mergedRanges.length,
    tableCount: sheet.tables.length,
    conditionalFormatCount: sheet.conditionalFormats.length,
    conditionalFormatGroupCount: new Set(
      sheet.conditionalFormats.flatMap((format) => format.ranges).filter(Boolean),
    ).size,
    dataValidationCount: sheet.dataValidations.length,
    previewCells: cells.filter(cellHasContent).slice(0, 12).map((cell) => ({
      address: cell.address,
      formula: cell.formula,
      value: cell.text,
    })),
  };
}

function summarizeWalnutChartSeriesShape(chart: Record<string, unknown>) {
  return {
    title: stringValue(chart.title),
    series: arrayOfRecords(chart.series).map((series) => ({
      categoryCount: arrayOfStrings(series.categories).length,
      name: stringValue(series.name),
      valueCount: arrayOfNumbers(series.values).length,
    })),
  };
}

function summarizeRoutaChartSeriesShape(chart: RoutaOfficeChart) {
  return {
    title: chart.title,
    series: chart.series.map((series) => ({
      categoryCount: series.categories.length,
      name: series.label,
      valueCount: series.values.length,
    })),
  };
}

function summarizeWalnutDrawingShape(sheetName: string, shapeElement: Record<string, unknown>) {
  const shape = asRecord(shapeElement.shape) ?? {};
  const fill = asRecord(shape.fill);
  const line = asRecord(shape.line);
  const lineFill = asRecord(line?.fill);

  return {
    fillColor: nestedColorValue(fill),
    geometry: shape.geometry,
    heightEmu: asRecord(shapeElement.bbox)?.heightEmu ?? 0,
    lineColor: nestedColorValue(lineFill),
    name: stringValue(shapeElement.name),
    sheetName,
    widthEmu: asRecord(shapeElement.bbox)?.widthEmu ?? 0,
  };
}

function summarizeRoutaShape(shape: RoutaOfficeSpreadsheetShape) {
  return {
    fillColor: shape.fillColor,
    geometry: shape.geometry,
    heightEmu: shape.heightEmu,
    id: shape.id,
    lineColor: shape.lineColor,
    sheetName: shape.sheetName,
    widthEmu: shape.widthEmu,
  };
}

function assertCoreEquivalence(result: XlsxComparisonResult): void {
  const { equivalence } = result;
  const requiredChecks: Array<keyof typeof equivalence> = [
    "sheetCountMatches",
    "sheetNamesMatch",
    "sheetRowCountsMatch",
    "sheetCellCountsMatch",
    "sheetFormulaCountsMatch",
    "mergedRangeCountsMatch",
    "tableCountsMatch",
    "chartCountMatches",
    "chartTitlesMatch",
    "chartSeriesShapesMatch",
    "imageCountMatches",
    "drawingShapeCountMatches",
    "styleCountsMatch",
  ];
  const failures = requiredChecks.filter((key) => equivalence[key] !== true);
  if (failures.length > 0) {
    throw new Error(`XLSX core equivalence failed for ${result.fixture}: ${failures.join(", ")}`);
  }
}

function nestedColorValue(record: Record<string, unknown> | null): string {
  const color = asRecord(record?.color);
  return stringValue(color?.value);
}

function cellHasContent(cell: RoutaOfficeCell): boolean {
  return cell.text.length > 0 || cell.formula.length > 0;
}

function moduleWithExport(moduleValue: unknown, exportName: string): unknown {
  const root = moduleRoot(moduleValue);
  if (isRecord(root) && exportName in root) {
    return root;
  }

  if (isRecord(moduleValue) && exportName in moduleValue) {
    return moduleValue;
  }

  throw new Error(`Could not load ${exportName} export.`);
}

function moduleRoot(moduleValue: unknown): unknown {
  if (!isRecord(moduleValue)) {
    return moduleValue;
  }

  return moduleValue.default ?? moduleValue["module.exports"] ?? moduleValue;
}

function assertFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForJson(value[key])]),
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOfNumbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toUint8Array(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return Uint8Array.from(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
