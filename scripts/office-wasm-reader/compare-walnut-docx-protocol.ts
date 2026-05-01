import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import officeWasmConfig from "../../src/app/debug/office-wasm-poc/office-wasm-config";

type ReaderExports = {
  DocxReader: {
    ExtractDocxProto: (bytes: Uint8Array, ignoreErrors: boolean) => Uint8Array | ArrayBuffer | number[];
  };
};

type DocumentSummary = ReturnType<typeof summarizeDocument>;

type ComparisonResult = {
  equivalence: ReturnType<typeof summarizeEquivalence>;
  fixture: string;
  routa: DocumentSummary;
  targetProtocol: string;
  walnut: DocumentSummary;
};

const repoRoot = process.cwd();
const assetDir = path.resolve(repoRoot, officeWasmConfig.OFFICE_WASM_TMP_ASSET_DIR);
const assertMode = process.argv.includes("--assert");
const fixturePaths = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => path.resolve(repoRoot, arg));
if (fixturePaths.length === 0) {
  fixturePaths.push(path.resolve(repoRoot, "tools/office-wasm-reader/fixtures/dll_viewer_solution_test_document.docx"));
}
const generatedBundleEntry = path.resolve(repoRoot, "public/office-wasm-reader/main.js");

async function main(): Promise<void> {
  assertFile(assetDir, "extracted Walnut asset directory");
  assertFile(generatedBundleEntry, "generated Routa office WASM bundle");

  const results: ComparisonResult[] = [];
  for (const fixturePath of fixturePaths) {
    assertFile(fixturePath, "DOCX fixture");
    results.push(await compareFixture(fixturePath));
  }

  if (assertMode) {
    for (const result of results) {
      assertEquivalence(result);
      console.log(`ok ${result.fixture}`);
    }
    return;
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

async function compareFixture(fixturePath: string): Promise<ComparisonResult> {
  const sourceBytes = readFileSync(fixturePath);
  const walnutProtoBytes = await extractWalnutDocumentProto(sourceBytes);
  const walnutDocument = await decodeWalnutDocument(walnutProtoBytes);
  const routaProtoBytes = await extractRoutaDocumentProto(sourceBytes);
  const routaDocument = await decodeWalnutDocument(routaProtoBytes);

  return {
    equivalence: summarizeEquivalence(walnutDocument, routaDocument),
    fixture: path.relative(repoRoot, fixturePath),
    routa: summarizeDocument(routaDocument, routaProtoBytes),
    targetProtocol: "oaiproto.coworker.docx.Document",
    walnut: summarizeDocument(walnutDocument, walnutProtoBytes),
  };
}

async function extractWalnutDocumentProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
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
  return toUint8Array(exports.DocxReader.ExtractDocxProto(sourceBytes, false));
}

async function decodeWalnutDocument(protoBytes: Uint8Array): Promise<Record<string, unknown>> {
  const documentModule = moduleWithExport(await import(
    pathToFileURL(path.join(assetDir, officeWasmConfig.OFFICE_WASM_READER_MODULES.document)).href
  ), "Document") as {
    Document: { decode: (bytes: Uint8Array) => Record<string, unknown> };
  };

  return documentModule.Document.decode(protoBytes);
}

async function extractRoutaDocumentProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
  await import(pathToFileURL(generatedBundleEntry).href);
  const bridge = (globalThis as typeof globalThis & {
    RoutaOfficeWasmReader?: { exports?: ReaderExports };
  }).RoutaOfficeWasmReader;

  if (!bridge?.exports) {
    throw new Error("RoutaOfficeWasmReader exports were not initialized.");
  }

  return toUint8Array(bridge.exports.DocxReader.ExtractDocxProto(sourceBytes, false));
}

function summarizeDocument(document: Record<string, unknown>, protoBytes: Uint8Array) {
  const charts = arrayOfRecords(document.charts);
  const elements = arrayOfRecords(document.elements);
  const images = arrayOfRecords(document.images);
  const footnotes = arrayOfRecords(document.footnotes);
  const comments = arrayOfRecords(document.comments);
  const commentReferences = arrayOfRecords(document.commentReferences);
  const reviewMarks = arrayOfRecords(document.reviewMarks);
  const sections = arrayOfRecords(document.sections);
  const paragraphNumberings = arrayOfRecords(document.paragraphNumberings);
  const imageIds = new Set(images.map((image) => String(image.id ?? "")).filter(Boolean));
  const imageReferenceIds = elements.flatMap(elementImageReferenceIds);
  const chartReferenceIds = elements.flatMap(elementChartReferenceIds);
  const paragraphs = elements.flatMap(elementParagraphs);
  const textRuns = paragraphs.flatMap((paragraph) => arrayOfRecords(paragraph.runs));

  return {
    protoByteLength: protoBytes.length,
    protoSha256: sha256(protoBytes),
    topLevelKeys: Object.keys(document),
    name: document.name,
    widthEmu: document.widthEmu,
    heightEmu: document.heightEmu,
    chartCount: charts.length,
    chartIds: charts.map((chart) => String(chart.id ?? "")).filter(Boolean),
    chartReferenceCount: chartReferenceIds.length,
    chartReferenceIds,
    elementCount: elements.length,
    elementTypes: countBy(elements, elementTypeKey),
    imageCount: images.length,
    imageDigests: images.map(summarizeImage),
    imageReferenceCount: imageReferenceIds.length,
    imageReferenceIds,
    missingImageReferenceIds: [...new Set(imageReferenceIds.filter((id) => !imageIds.has(id)))],
    paragraphCount: paragraphs.length,
    textRunCount: textRuns.length,
    hyperlinkCount: textRuns.filter((run) => isRecord(run.hyperlink)).length,
    reviewMarkedRunCount: textRuns.filter((run) => arrayOfStrings(run.reviewMarkIds).length > 0).length,
    footnoteCount: footnotes.length,
    footnoteReferenceRunIds: footnotes.flatMap((footnote) =>
      arrayOfStrings(footnote.referenceRunIds).map((runId) => `${String(footnote.id ?? "")}:${runId}`)
    ),
    commentCount: comments.length,
    commentReferenceCount: commentReferences.length,
    commentReferenceRunIds: commentReferences.flatMap((reference) =>
      arrayOfStrings(reference.runIds).map((runId) => `${String(reference.commentId ?? "")}:${runId}`)
    ),
    reviewMarkCount: reviewMarks.length,
    tableCount: elements.filter((element) => isRecord(element.table)).length,
    textStyleCount: arrayOfRecords(document.textStyles).length,
    textStyleIds: arrayOfRecords(document.textStyles).map((style) => String(style.id ?? "")).filter(Boolean),
    sectionCount: sections.length,
    sectionShapes: sections.map(summarizeSection),
    numberingDefinitionCount: arrayOfRecords(document.numberingDefinitions).length,
    paragraphNumberingCount: paragraphNumberings.length,
    paragraphNumberings: paragraphNumberings.map((numbering) => ({
      paragraphId: String(numbering.paragraphId ?? ""),
      numId: String(numbering.numId ?? ""),
      level: Number(numbering.level ?? 0),
    })),
    tableShapes: elements.filter((element) => isRecord(element.table)).map(summarizeTableShape),
    tableColorSignatures: elements.filter((element) => isRecord(element.table)).map(summarizeTableColors),
    firstElements: elements.slice(0, 12).map(summarizeElement),
  };
}

function summarizeEquivalence(
  walnutDocument: Record<string, unknown>,
  routaDocument: Record<string, unknown>,
) {
  const walnutSummary = summarizeDocument(walnutDocument, new Uint8Array());
  const routaSummary = summarizeDocument(routaDocument, new Uint8Array());

  return {
    pageSizeMatches:
      walnutSummary.widthEmu === routaSummary.widthEmu &&
      walnutSummary.heightEmu === routaSummary.heightEmu,
    elementCountMatches: walnutSummary.elementCount === routaSummary.elementCount,
    elementTypeCountsMatch: stableJson(walnutSummary.elementTypes) === stableJson(routaSummary.elementTypes),
    imageCountMatches: walnutSummary.imageCount === routaSummary.imageCount,
    imageDigestsMatch: stableJson(walnutSummary.imageDigests) === stableJson(routaSummary.imageDigests),
    imageReferenceIdsMatch: stableJson(walnutSummary.imageReferenceIds) === stableJson(routaSummary.imageReferenceIds),
    imageReferencesResolve: routaSummary.missingImageReferenceIds.length === 0,
    chartCountMatches: walnutSummary.chartCount === routaSummary.chartCount,
    chartReferenceIdsMatch: stableJson(walnutSummary.chartReferenceIds) === stableJson(routaSummary.chartReferenceIds),
    paragraphCountMatches: walnutSummary.paragraphCount === routaSummary.paragraphCount,
    hyperlinkCountMatches: walnutSummary.hyperlinkCount === routaSummary.hyperlinkCount,
    footnoteCountMatches: walnutSummary.footnoteCount === routaSummary.footnoteCount,
    footnoteReferenceRunIdsMatch:
      stableJson(walnutSummary.footnoteReferenceRunIds) === stableJson(routaSummary.footnoteReferenceRunIds),
    commentCountMatches: walnutSummary.commentCount === routaSummary.commentCount,
    commentReferenceRunIdsMatch:
      stableJson(walnutSummary.commentReferenceRunIds) === stableJson(routaSummary.commentReferenceRunIds),
    reviewMarkCountMatches: walnutSummary.reviewMarkCount === routaSummary.reviewMarkCount,
    tableShapesMatch: stableJson(walnutSummary.tableShapes) === stableJson(routaSummary.tableShapes),
    tableColorSignaturesMatch:
      stableJson(walnutSummary.tableColorSignatures) === stableJson(routaSummary.tableColorSignatures),
    textRunCountMatches: walnutSummary.textRunCount === routaSummary.textRunCount,
    textStyleCountMatches: walnutSummary.textStyleCount === routaSummary.textStyleCount,
    sectionCountMatches: walnutSummary.sectionCount === routaSummary.sectionCount,
    sectionShapesMatch: stableJson(walnutSummary.sectionShapes) === stableJson(routaSummary.sectionShapes),
    numberingDefinitionCountMatches:
      walnutSummary.numberingDefinitionCount === routaSummary.numberingDefinitionCount,
    paragraphNumberingCountMatches:
      walnutSummary.paragraphNumberingCount === routaSummary.paragraphNumberingCount,
  };
}

function assertEquivalence(result: ComparisonResult): void {
  const failed = Object.entries(result.equivalence)
    .filter(([, value]) => typeof value === "boolean" && !value)
    .map(([key]) => key);

  if (failed.length > 0) {
    throw new Error(`${result.fixture} DOCX parity failed: ${failed.join(", ")}`);
  }
}

function summarizeElement(element: Record<string, unknown>) {
  const paragraphs = elementParagraphs(element);
  return {
    id: element.id,
    type: element.type,
    bbox: element.bbox,
    hasImageReference: elementImageReferenceIds(element).length > 0,
    hasChartReference: elementChartReferenceIds(element).length > 0,
    hasTable: isRecord(element.table),
    paragraphCount: paragraphs.length,
    textPreview: paragraphs.map(paragraphText).filter(Boolean).join(" ").slice(0, 220),
    tableShape: isRecord(element.table) ? summarizeTableShape(element) : undefined,
  };
}

function summarizeSection(section: Record<string, unknown>) {
  const columns = asRecord(section.columns);
  const header = asRecord(section.header);
  const footer = asRecord(section.footer);
  return {
    breakType: section.breakType,
    columnCount: columns?.count ?? 0,
    headerElementCount: arrayOfRecords(header?.elements).length,
    footerElementCount: arrayOfRecords(footer?.elements).length,
  };
}

function summarizeTableShape(element: Record<string, unknown>) {
  const table = asRecord(element.table) ?? {};
  const rows = arrayOfRecords(table.rows);
  return {
    rowCount: rows.length,
    cellCounts: rows.map((row) => arrayOfRecords(row.cells).length),
    preview: rows.slice(0, 3).map((row) =>
      arrayOfRecords(row.cells).slice(0, 4).map((cell) => collectTextPreview(cell).slice(0, 80))
    ),
  };
}

function summarizeTableColors(element: Record<string, unknown>) {
  const table = asRecord(element.table) ?? {};
  return arrayOfRecords(table.rows).map((row) =>
    arrayOfRecords(row.cells).map((cell) => ({
      fill: fillColorSignature(cell.fill),
      paragraphFills: arrayOfRecords(cell.paragraphs).map((paragraph) =>
        fillColorSignature(asRecord(paragraph.textStyle)?.fill)
      ),
      runFills: arrayOfRecords(cell.paragraphs).map((paragraph) =>
        arrayOfRecords(paragraph.runs).map((run) => fillColorSignature(asRecord(run.textStyle)?.fill))
      ),
    }))
  );
}

function elementTypeKey(element: Record<string, unknown>): string {
  if (element.type != null) {
    return String(element.type);
  }

  if (isRecord(element.table)) {
    return "table";
  }

  if (elementImageReferenceIds(element).length > 0) {
    return "imageReference";
  }

  if (elementChartReferenceIds(element).length > 0) {
    return "chartReference";
  }

  return "text";
}

function elementParagraphs(element: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = arrayOfRecords(element.paragraphs);
  if (direct.length > 0) {
    return direct;
  }

  const paragraph = asRecord(element.paragraph);
  if (paragraph) {
    return [paragraph];
  }

  const table = asRecord(element.table);
  if (!table) {
    return [];
  }

  return arrayOfRecords(table.rows)
    .flatMap((row) => arrayOfRecords(row.cells))
    .flatMap((cell) => arrayOfRecords(cell.paragraphs));
}

function paragraphText(paragraph: Record<string, unknown>): string {
  return arrayOfRecords(paragraph.runs)
    .map((run) => typeof run.text === "string" ? run.text : "")
    .join("");
}

function elementImageReferenceIds(element: Record<string, unknown>): string[] {
  return [
    imageReferenceId(element.imageReference),
    imageReferenceId(asRecord(element.fill)?.imageReference),
    imageReferenceId(asRecord(asRecord(element.shape)?.fill)?.imageReference),
  ].filter(Boolean);
}

function elementChartReferenceIds(element: Record<string, unknown>): string[] {
  return [chartReferenceId(element.chartReference)].filter(Boolean);
}

function chartReferenceId(value: unknown): string {
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id : "";
}

function imageReferenceId(value: unknown): string {
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id : "";
}

function fillColorSignature(value: unknown): string {
  const fill = asRecord(value);
  if (!fill) return "";
  return colorSignature(fill.color);
}

function colorSignature(value: unknown): string {
  const color = asRecord(value);
  if (!color) return "";
  const transform = asRecord(color.transform);
  return [
    String(color.type ?? ""),
    String(color.value ?? ""),
    String(color.lastColor ?? ""),
    String(transform?.alpha ?? ""),
    String(transform?.lumMod ?? ""),
    String(transform?.lumOff ?? ""),
    String(transform?.shade ?? ""),
    String(transform?.tint ?? ""),
  ].join(":");
}

function summarizeImage(image: Record<string, unknown>) {
  const data = bytesFromUnknown(image.data ?? image.bytes);
  return {
    id: typeof image.id === "string" ? image.id : "",
    contentType: typeof image.contentType === "string" ? image.contentType : "",
    byteLength: data.length,
    sha256: data.length > 0 ? sha256(data) : "",
    uri: typeof image.uri === "string" ? image.uri : "",
  };
}

function collectTextPreview(value: unknown): string {
  const items: string[] = [];
  const seen = new WeakSet<object>();

  function visit(node: unknown): void {
    if (items.length >= 8) {
      return;
    }

    if (typeof node === "string") {
      const text = node.trim();
      if (text.length > 0) {
        items.push(text);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (!isRecord(node) || seen.has(node)) {
      return;
    }

    seen.add(node);
    for (const key of ["text", "value", "alt"]) {
      visit(node[key]);
    }

    for (const child of Object.values(node)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }

  visit(value);
  return items.join(" | ").slice(0, 260);
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const itemKey = key(item);
    counts[itemKey] = (counts[itemKey] ?? 0) + 1;
    return counts;
  }, {});
}

function bytesFromUnknown(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value);
  }

  return new Uint8Array();
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function moduleWithExport(module: unknown, exportName: string): Record<string, unknown> {
  for (const candidate of moduleCandidates(module)) {
    if (exportName in candidate) {
      return candidate;
    }
  }

  throw new Error(`Could not find module export: ${exportName}`);
}

function moduleCandidates(module: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown): void {
    if (!isRecord(value) || seen.has(value)) {
      return;
    }

    seen.add(value);
    candidates.push(value);
    visit(value.default);
    visit(value["module.exports"]);
  }

  visit(module);
  return candidates;
}

function toUint8Array(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value);
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
