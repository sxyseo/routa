"use client";

import { type ChangeEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveApiPath } from "@/client/config/backend";
import { toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import {
  OFFICE_WASM_ASSET_ROUTE,
  OFFICE_WASM_DOTNET_RUNTIME_CONFIG,
  OFFICE_WASM_READER_MODULES,
} from "./office-wasm-config";

type ArtifactKind = "csv" | "tsv" | "docx" | "pptx" | "xlsx";
type ParseStage = "idle" | "initializing" | "parsing" | "ready" | "error";

type ParsedArtifact = {
  kind: "document" | "presentation" | "spreadsheet";
  sourceKind: ArtifactKind;
  proto: unknown;
};

type RecordValue = Record<string, unknown>;

type ImageSource = {
  id: string;
  src: string;
};

type PreviewLabels = {
  visualPreview: string;
  rawJson: string;
  sheet: string;
  slide: string;
  noSheets: string;
  noSlides: string;
  noDocumentBlocks: string;
  showingFirstRows: string;
  shapes: string;
  textRuns: string;
};

type TextRunView = {
  id: string;
  text: string;
  style: RecordValue | null;
};

type ParagraphView = {
  id: string;
  runs: TextRunView[];
  styleId: string;
  style: RecordValue | null;
};

type DocumentStyleMaps = {
  textStyles: Map<string, RecordValue>;
  images: Map<string, string>;
};

type CellMerge = {
  startColumn: number;
  startRow: number;
  columnSpan: number;
  rowSpan: number;
};

type WalnutReader = {
  DocxReader: {
    ExtractDocxProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
  PptxReader: {
    ExtractSlidesProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
  XlsxReader: {
    ExtractXlsxProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
};

const EMPTY_DOCUMENT_STYLE_MAPS: DocumentStyleMaps = {
  textStyles: new Map(),
  images: new Map(),
};

const ASSET_BASE_URL = resolveApiPath(OFFICE_WASM_ASSET_ROUTE);
const WORKBOOK_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.workbook}`;
const DOCUMENT_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.document}`;
const PRESENTATION_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.presentation}`;
const SPREADSHEET_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.spreadsheet}`;
const DOTNET_JS = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.dotnet}`;

let cachedWalnutRuntime: Promise<WalnutReader> | null = null;

async function getWalnutReader(): Promise<WalnutReader> {
  if (!cachedWalnutRuntime) {
    cachedWalnutRuntime = (async () => {
      const dotnet = await import(
        /* webpackIgnore: true */ `${DOTNET_JS}?v=walnut-runtime`
      );
      const runtime = await dotnet.dotnet
        .withConfig({
          ...OFFICE_WASM_DOTNET_RUNTIME_CONFIG,
          resources: {
            ...OFFICE_WASM_DOTNET_RUNTIME_CONFIG.resources,
          },
        })
        .withResourceLoader((resourceType: string, _name: string, defaultUri: string, integrity: string) => {
          if (resourceType === "dotnetjs") {
            return defaultUri;
          }

          const url = new URL(defaultUri, window.location.href);
          if (url.origin === window.location.origin) {
            return url.href;
          }

          return fetch(url.href, { credentials: "omit", integrity });
        })
        .create();

      return runtime.getAssemblyExports("Walnut") as Promise<WalnutReader>;
    })().catch((error: unknown) => {
      cachedWalnutRuntime = null;
      throw new Error(`Walnut runtime init failed: ${toErrorMessage(error)}`);
    });
  }

  return cachedWalnutRuntime;
}

function detectFileKind(fileName: string): ArtifactKind | null {
  const extension = fileName.trim().toLowerCase().split(".").pop();
  if (extension === "csv") return "csv";
  if (extension === "tsv") return "tsv";
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  if (extension === "xlsx") return "xlsx";
  return null;
}

async function parseSpreadsheetFromCsv(file: File, separator?: string): Promise<ParsedArtifact> {
  const { Workbook } = (await import(
    /* webpackIgnore: true */ `${WORKBOOK_MODULE}?v=workbook`
  )) as {
    Workbook: {
      fromCSV: (text: string, options?: { separator?: string }) => {
        toProto: () => unknown;
      };
    };
  };
  const fileBytes = await file.arrayBuffer();
  const asText = new TextDecoder().decode(fileBytes);
  const workbook = await Workbook.fromCSV(asText, separator ? { separator } : undefined);
  return { kind: "spreadsheet", sourceKind: file.name.endsWith(".tsv") ? "tsv" : "csv", proto: workbook.toProto() };
}

async function parseDocument(file: File, kind: "docx" | "pptx" | "xlsx"): Promise<ParsedArtifact> {
  const walnut = await getWalnutReader();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (kind === "docx") {
    const { Document } = (await import(
      /* webpackIgnore: true */ `${DOCUMENT_MODULE}?v=document`
    )) as { Document: { decode: (value: unknown) => unknown } };
    const proto = Document.decode(walnut.DocxReader.ExtractDocxProto(bytes, false));
    return { kind: "document", sourceKind: "docx", proto };
  }

  if (kind === "pptx") {
    const { Presentation } = (await import(
      /* webpackIgnore: true */ `${PRESENTATION_MODULE}?v=presentation`
    )) as { Presentation: { decode: (value: unknown) => unknown } };
    const proto = Presentation.decode(walnut.PptxReader.ExtractSlidesProto(bytes, false));
    return { kind: "presentation", sourceKind: "pptx", proto };
  }

  const { Workbook } = (await import(
    /* webpackIgnore: true */ `${SPREADSHEET_MODULE}?v=spreadsheet`
  )) as { Workbook: { decode: (value: unknown) => unknown } };
  const proto = Workbook.decode(walnut.XlsxReader.ExtractXlsxProto(bytes, false));
  return { kind: "spreadsheet", sourceKind: "xlsx", proto };
}

function truncateJson(rawJson: string): string {
  const maxLength = 50_000;
  if (rawJson.length <= maxLength) return rawJson;
  return `${rawJson.slice(0, maxLength)}\n... (truncated)`;
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null ? (value as RecordValue) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bytesFromUnknown(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value);
  }

  const record = asRecord(value);
  if (record == null) return null;

  const numericKeys = Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((left, right) => left - right);

  if (numericKeys.length === 0) return null;

  const bytes = new Uint8Array(numericKeys.length);
  for (const key of numericKeys) {
    bytes[key] = asNumber(record[String(key)]);
  }

  return bytes;
}

function inferImageContentType(id: string): string {
  const extension = id.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

function hexToRgb(value: string): { red: number; green: number; blue: number } | null {
  const normalized = /^[0-9a-f]{8}$/i.test(value) ? value.slice(2) : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function colorAlpha(value: unknown): number {
  const transform = asRecord(asRecord(value)?.transform);
  const alpha = transform?.alpha;
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) return 1;
  return Math.max(0, Math.min(1, alpha / 100_000));
}

function colorToCss(value: unknown): string | undefined {
  const color = asRecord(value);
  const raw = asString(color?.value);
  const rgb = hexToRgb(raw);
  if (rgb) {
    const argbAlpha = /^[0-9a-f]{8}$/i.test(raw) ? Number.parseInt(raw.slice(0, 2), 16) / 255 : 1;
    const alpha = Math.min(argbAlpha, colorAlpha(color));
    if (alpha < 1) return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${alpha})`;
    return `#${raw.slice(-6)}`;
  }

  const lastColor = asString(color?.lastColor);
  const lastRgb = hexToRgb(lastColor);
  if (lastRgb) return `#${lastColor}`;
  return undefined;
}

function fillToCss(fill: unknown): string | undefined {
  const fillRecord = asRecord(fill);
  if (fillRecord == null || asNumber(fillRecord.type) === 0) return undefined;
  return colorToCss(fillRecord.color);
}

function spreadsheetFillToCss(fill: unknown): string | undefined {
  const fillRecord = asRecord(fill);
  if (fillRecord == null) return undefined;
  return (
    fillToCss(fillRecord) ??
    colorToCss(fillRecord.color) ??
    colorToCss(asRecord(fillRecord.pattern)?.foregroundColor) ??
    colorToCss(asRecord(fillRecord.pattern)?.backgroundColor) ??
    colorToCss(asRecord(fillRecord.pattern)?.fill)
  );
}

function lineToCss(line: unknown): { color?: string; width: number } {
  const lineRecord = asRecord(line);
  const fillRecord = asRecord(lineRecord?.fill);
  const color = colorToCss(fillRecord?.color);
  const width = Math.max(1, Math.min(4, asNumber(lineRecord?.widthEmu) / 9_000));
  return { color, width };
}

function slideBackgroundToCss(slide: RecordValue): string {
  const background = asRecord(slide.background);
  const fill = asRecord(background?.fill);
  return fillToCss(fill) ?? "#ffffff";
}

function imageReferenceId(value: unknown): string {
  const record = asRecord(value);
  return asString(record?.id);
}

function elementImageReferenceId(element: RecordValue): string {
  const direct = imageReferenceId(element.imageReference);
  if (direct) return direct;

  const fill = asRecord(element.fill);
  const fillImage = imageReferenceId(fill?.imageReference);
  if (fillImage) return fillImage;

  const shapeFill = asRecord(asRecord(element.shape)?.fill);
  return imageReferenceId(shapeFill?.imageReference);
}

function paragraphText(paragraph: unknown): string {
  const runs = asArray(asRecord(paragraph)?.runs);
  return runs.map((run) => asString(asRecord(run)?.text)).join("");
}

function paragraphView(paragraph: unknown, styleMaps: DocumentStyleMaps): ParagraphView {
  const record = asRecord(paragraph);
  const styleId = asString(record?.styleId);
  const styleRecord = styleMaps.textStyles.get(styleId);
  const style = {
    ...(asRecord(styleRecord?.textStyle) ?? {}),
    ...(asRecord(record?.textStyle) ?? {}),
    spaceAfter: record?.spaceAfter,
    spaceBefore: record?.spaceBefore,
  };
  const runs = asArray(record?.runs)
    .map(asRecord)
    .filter((run): run is RecordValue => run != null)
    .map((run, index) => ({
      id: asString(run.id) || `${asString(record?.id)}-${index}`,
      text: asString(run.text),
      style: {
        ...style,
        ...(asRecord(run.textStyle) ?? {}),
      },
    }));

  return {
    id: asString(record?.id),
    runs,
    styleId,
    style,
  };
}

function paragraphStyle(paragraph: ParagraphView): CSSProperties {
  const isTitle = paragraph.styleId === "Title";
  const isHeading = /^Heading/i.test(paragraph.styleId);
  const spaceBefore = asNumber(paragraph.style?.spaceBefore);
  const spaceAfter = asNumber(paragraph.style?.spaceAfter);

  return {
    color: colorToCss(asRecord(paragraph.style?.fill)?.color) ?? "#0f172a",
    fontFamily: asString(paragraph.style?.typeface) || undefined,
    fontSize: cssFontSize(paragraph.style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14),
    fontWeight: paragraph.style?.bold === true || isTitle || isHeading ? 700 : 400,
    lineHeight: 1.55,
    margin: 0,
    marginBottom: spaceAfter ? Math.min(28, spaceAfter / 20) : isTitle || isHeading ? 10 : 8,
    marginTop: spaceBefore ? Math.min(32, spaceBefore / 20) : isHeading ? 12 : 0,
    whiteSpace: "pre-wrap",
  };
}

function textRunStyle(run: TextRunView, fontScale = 1): CSSProperties {
  const runFontSize = run.style?.fontSize == null ? undefined : cssFontSize(run.style.fontSize, 14) * fontScale;
  return {
    color: colorToCss(asRecord(run.style?.fill)?.color) ?? undefined,
    fontFamily: asString(run.style?.typeface) || undefined,
    fontSize: runFontSize == null ? undefined : Math.max(fontScale < 1 ? 2 : 8, Math.min(fontScale < 1 ? 12 : 72, runFontSize)),
    fontStyle: run.style?.italic === true ? "italic" : undefined,
    fontWeight: run.style?.bold === true ? 700 : undefined,
    textDecoration: run.style?.underline === true ? "underline" : undefined,
  };
}

function collectTextBlocks(value: unknown, limit = 80): string[] {
  const blocks: string[] = [];
  const seen = new WeakSet<object>();

  function visit(node: unknown) {
    if (blocks.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = asRecord(node);
    if (record == null || seen.has(record)) return;
    seen.add(record);

    const paragraphs = asArray(record.paragraphs);
    if (paragraphs.length > 0) {
      const text = paragraphs.map(paragraphText).filter(Boolean).join("\n");
      if (text.trim()) blocks.push(text);
    }

    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }

  visit(value);
  return blocks;
}

function columnIndexFromAddress(address: string): number {
  const match = address.match(/^[A-Z]+/i);
  if (!match) return 0;

  let index = 0;
  for (const char of match[0].toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

function rowIndexFromAddress(address: string): number {
  const match = address.match(/\d+/);
  if (!match) return 1;
  return Math.max(1, Number.parseInt(match[0], 10));
}

function parseCellRange(reference: string): CellMerge | null {
  const [start, end = start] = reference.split(":");
  if (!start) return null;

  const startColumn = columnIndexFromAddress(start);
  const startRow = rowIndexFromAddress(start);
  const endColumn = columnIndexFromAddress(end);
  const endRow = rowIndexFromAddress(end);
  return {
    startColumn: Math.min(startColumn, endColumn),
    startRow: Math.min(startRow, endRow),
    columnSpan: Math.abs(endColumn - startColumn) + 1,
    rowSpan: Math.abs(endRow - startRow) + 1,
  };
}

function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function resolveStyleRecord(record: RecordValue | null, keys: string[]): RecordValue | null {
  for (const key of keys) {
    const candidate = asRecord(record?.[key]);
    if (candidate) return candidate;
  }

  return null;
}

function cssFontSize(value: unknown, fallbackPx: number): number {
  const raw = asNumber(value);
  if (raw <= 0) return fallbackPx;
  if (raw > 200) return Math.max(8, Math.min(72, raw / 100));
  return Math.max(8, Math.min(72, raw));
}

function cellText(cell: unknown): string {
  const record = asRecord(cell);
  if (record == null) return "";

  const value = asString(record.value);
  if (value) return value;

  const formula = asString(record.formula) || asString(record.formulaText);
  if (formula) return `=${formula.replace(/^=/, "")}`;

  const paragraphs = asArray(record.paragraphs);
  return paragraphs.map(paragraphText).filter(Boolean).join("\n");
}

function styleAt(values: unknown, index: unknown): RecordValue | null {
  const styleIndex = asNumber(index, -1);
  if (styleIndex < 0) return null;
  return asRecord(asArray(values)[styleIndex]);
}

function spreadsheetCellStyle(
  cell: RecordValue | null,
  styles: RecordValue | null,
): CSSProperties {
  const cellFormat = styleAt(styles?.cellXfs, cell?.styleIndex);
  const font = styleAt(styles?.fonts, cellFormat?.fontId);
  const fill = styleAt(styles?.fills, cellFormat?.fillId);
  const border = styleAt(styles?.borders, cellFormat?.borderId);
  const alignment = asRecord(cellFormat?.alignment);
  const fontFill = resolveStyleRecord(font, ["fill", "color"]);
  const fillColor = spreadsheetFillToCss(fill);
  const fontColor = colorToCss(fontFill?.color ?? fontFill);
  const borderColor = colorToCss(asRecord(asRecord(border?.bottom)?.color)) ?? "#e2e8f0";

  return {
    ...sheetCellStyle,
    background: fillColor,
    borderBottomColor: borderColor,
    borderRightColor: borderColor,
    color: fontColor ?? sheetCellStyle.color,
    fontFamily: asString(font?.typeface) || undefined,
    fontSize: cssFontSize(font?.fontSize, 13),
    fontStyle: font?.italic === true ? "italic" : undefined,
    fontWeight: font?.bold === true ? 700 : undefined,
    textAlign: (asString(alignment?.horizontal) || asString(cellFormat?.horizontalAlignment)) as CSSProperties["textAlign"] || undefined,
    verticalAlign: asString(alignment?.vertical) as CSSProperties["verticalAlign"] || sheetCellStyle.verticalAlign,
  };
}

function spreadsheetCellText(cell: RecordValue | null, styles: RecordValue | null): string {
  const text = cellText(cell);
  const numberValue = Number(text);
  if (cell == null || !Number.isFinite(numberValue)) return text;

  const cellFormat = styleAt(styles?.cellXfs, cell.styleIndex);
  const numberFormatId = asNumber(cellFormat?.numFmtId, -1);
  const numberFormat = asArray(styles?.numberFormats)
    .map(asRecord)
    .find((format) => asNumber(format?.id, -2) === numberFormatId);
  const formatCode = asString(numberFormat?.formatCode);

  if (formatCode.includes("%")) return `${(numberValue * 100).toFixed(formatCode.includes(".0") ? 1 : 0)}%`;
  if (formatCode.includes("$")) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
  if (formatCode.includes("#,##0")) return Math.round(numberValue).toLocaleString("en-US");
  return text;
}

function defaultSpreadsheetSheetIndex(sheets: RecordValue[]): number {
  if (sheets.length <= 1) return 0;
  const readmeFirst = /^00[_ -]?readme$/i.test(asString(sheets[0]?.name));
  return readmeFirst ? 1 : 0;
}

function OfficePreview({
  artifact,
  labels,
}: {
  artifact: ParsedArtifact;
  labels: PreviewLabels;
}) {
  if (artifact.kind === "spreadsheet") {
    return <SpreadsheetPreview labels={labels} proto={artifact.proto} />;
  }

  if (artifact.kind === "presentation") {
    return <PresentationPreview labels={labels} proto={artifact.proto} />;
  }

  return <DocumentPreview labels={labels} proto={artifact.proto} />;
}

function SpreadsheetPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const sheets = asArray(root?.sheets).map(asRecord).filter((sheet): sheet is RecordValue => sheet != null);
  const styles = asRecord(root?.styles);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => defaultSpreadsheetSheetIndex(sheets));
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];

  const rows = asArray(activeSheet?.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  let maxColumn = 0;
  const rowsByIndex = new Map<number, Map<number, RecordValue>>();

  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = new Map<number, RecordValue>();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      const address = asString(cellRecord?.address);
      const columnIndex = columnIndexFromAddress(address);
      maxColumn = Math.max(maxColumn, columnIndex);
      if (cellRecord) cells.set(columnIndex, cellRecord);
    }
    rowsByIndex.set(rowIndex, cells);
  }

  const rowHeights = new Map(rows.map((row) => [asNumber(row.index, 1), asNumber(row.height)]));
  const columns = asArray(activeSheet?.columns).map(asRecord).filter((column): column is RecordValue => column != null);
  const columnWidths = new Map<number, number>();
  for (const column of columns) {
    const min = Math.max(1, asNumber(column.min, asNumber(column.index, 1)));
    const max = Math.max(min, asNumber(column.max, min));
    const width = asNumber(column.width, asNumber(activeSheet?.defaultColWidth, 10));
    for (let index = min - 1; index <= max - 1; index += 1) {
      columnWidths.set(index, Math.max(56, Math.min(240, width * 9)));
      maxColumn = Math.max(maxColumn, index);
    }
  }

  const mergeByStart = new Map<string, CellMerge>();
  const coveredCells = new Set<string>();
  for (const mergeRecord of asArray(activeSheet?.mergedCells)) {
    const mergeValue = asRecord(mergeRecord);
    const reference = (
      asString(mergeValue?.reference) ||
      (asString(mergeValue?.startAddress) && asString(mergeValue?.endAddress)
        ? `${asString(mergeValue?.startAddress)}:${asString(mergeValue?.endAddress)}`
        : "") ||
      asString(mergeRecord)
    );
    const merge = parseCellRange(reference);
    if (!merge || (merge.columnSpan === 1 && merge.rowSpan === 1)) continue;
    mergeByStart.set(`${merge.startRow}:${merge.startColumn}`, merge);
    maxColumn = Math.max(maxColumn, merge.startColumn + merge.columnSpan - 1);
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) {
      for (let column = merge.startColumn; column < merge.startColumn + merge.columnSpan; column += 1) {
        if (row === merge.startRow && column === merge.startColumn) continue;
        coveredCells.add(`${row}:${column}`);
      }
    }
  }

  const maxRow = Math.min(Math.max(...rowsByIndex.keys(), 1), 80);
  const columnCount = Math.min(Math.max(maxColumn + 1, 6), 32);

  if (sheets.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSheets}</p>;
  }

  return (
    <div
      data-testid="spreadsheet-preview"
      style={{
        background: "#ffffff",
        borderColor: "#d7dde5",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) auto",
        maxHeight: "calc(100vh - 150px)",
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%", fontSize: 13 }}>
          <colgroup>
            <col style={{ width: 52 }} />
            {Array.from({ length: columnCount }, (_, index) => (
              <col key={index} style={{ width: columnWidths.get(index) ?? 88 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={spreadsheetCornerStyle} />
              {Array.from({ length: columnCount }, (_, index) => (
                <th key={index} style={spreadsheetColumnHeaderStyle}>{columnLabel(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRow }, (_, rowOffset) => {
              const rowIndex = rowOffset + 1;
              const row = rowsByIndex.get(rowIndex);
              const height = rowHeights.get(rowIndex);
              return (
                <tr key={rowIndex} style={{ height: height && height > 0 ? Math.max(20, height) : undefined }}>
                  <th style={spreadsheetRowHeaderStyle}>{rowIndex}</th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => {
                    if (coveredCells.has(`${rowIndex}:${columnIndex}`)) return null;
                    const cell = row?.get(columnIndex) ?? null;
                    const merge = mergeByStart.get(`${rowIndex}:${columnIndex}`);
                    return (
                      <td
                        key={columnIndex}
                        colSpan={merge?.columnSpan}
                        rowSpan={merge?.rowSpan}
                        style={spreadsheetCellStyle(cell, styles)}
                      >
                        {spreadsheetCellText(cell, styles)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          background: "#f6f7f9",
          borderTopColor: "#d7dde5",
          borderTopStyle: "solid",
          borderTopWidth: 1,
          display: "flex",
          gap: 4,
          overflowX: "auto",
          padding: "0 10px",
        }}
      >
        {sheets.map((sheet, index) => (
          <button
            key={`${asString(sheet.sheetId)}-${index}`}
            onClick={() => setActiveSheetIndex(index)}
            style={{
              background: index === activeSheetIndex ? "#ffffff" : "transparent",
              borderBottomColor: index === activeSheetIndex ? "#111827" : "transparent",
              borderBottomStyle: "solid",
              borderBottomWidth: 3,
              borderLeftWidth: 0,
              borderRightWidth: 0,
              borderTopWidth: 0,
              color: index === activeSheetIndex ? "#111827" : "#5f6368",
              cursor: "pointer",
              flex: "0 0 auto",
              fontSize: 13,
              fontWeight: index === activeSheetIndex ? 600 : 500,
              minHeight: 44,
              padding: "0 16px",
            }}
            type="button"
          >
            {asString(sheet.name) || `${labels.sheet} ${index + 1}`}
          </button>
        ))}
      </div>
    </div>
  );
}

const spreadsheetHeaderBaseStyle: CSSProperties = {
  background: "#f3f4f6",
  borderBottomColor: "#d7dde5",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#d7dde5",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  color: "#2f3437",
  fontSize: 13,
  fontWeight: 500,
  padding: "4px 9px",
  position: "sticky",
  zIndex: 2,
};

const spreadsheetCornerStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  left: 0,
  minWidth: 52,
  position: "sticky" as const,
  top: 0,
  zIndex: 4,
};

const spreadsheetColumnHeaderStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  minWidth: 88,
  textAlign: "center",
  top: 0,
};

const spreadsheetRowHeaderStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  left: 0,
  minWidth: 52,
  textAlign: "center",
  zIndex: 3,
};

const sheetCellStyle: CSSProperties = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#e2e8f0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  color: "#0f172a",
  minWidth: 88,
  padding: "7px 9px",
  verticalAlign: "top" as const,
  whiteSpace: "pre-wrap" as const,
};

function PresentationPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const slides = asArray(root?.slides).map(asRecord).filter((slide): slide is RecordValue => slide != null);
  const imageSources = useOfficeImageSources(root);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const selectedSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const selectedSlide = slides[selectedSlideIndex] ?? {};

  if (slides.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSlides}</p>;
  }

  return (
    <div
      data-testid="presentation-preview"
      style={{
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        display: "grid",
        gridTemplateColumns: "minmax(150px, 220px) minmax(0, 1fr)",
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          borderRight: "1px solid #cbd5e1",
          display: "grid",
          gap: 10,
          maxHeight: 720,
          overflowY: "auto",
          padding: 12,
        }}
      >
        {slides.map((slide, index) => (
          <button
            key={`${asString(slide.id)}-${index}`}
            onClick={() => setActiveSlideIndex(index)}
            style={{
              background: "transparent",
              border: "0",
              color: "#0f172a",
              cursor: "pointer",
              display: "grid",
              gap: 6,
              padding: 0,
              textAlign: "left",
            }}
            type="button"
          >
            <span style={{ color: "#475569", fontSize: 12, fontWeight: 600 }}>
              {labels.slide} {asNumber(slide.index, index + 1)}
            </span>
            <SlideFrame
              compact
              imageSources={imageSources}
              isActive={index === selectedSlideIndex}
              slide={slide}
            />
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <SlideCanvas
          imageSources={imageSources}
          labels={labels}
          slide={selectedSlide}
          slideIndex={selectedSlideIndex}
        />
      </div>
    </div>
  );
}

function SlideCanvas({
  imageSources,
  labels,
  slide,
  slideIndex,
}: {
  imageSources: Map<string, string>;
  labels: PreviewLabels;
  slide: RecordValue;
  slideIndex: number;
}) {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const textRunCount = elements.reduce((count, element) => {
    return count + collectTextBlocks(element, 20).length;
  }, 0);

  return (
    <article style={{ display: "grid", gap: 12, minHeight: 0, overflow: "auto", padding: 18 }}>
      <div style={{ color: "#475569", display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
        <strong>{labels.slide} {asNumber(slide.index, slideIndex + 1)}</strong>
        <span>{elements.length} {labels.shapes}</span>
        <span>{textRunCount} {labels.textRuns}</span>
      </div>
      <SlideFrame imageSources={imageSources} slide={slide} />
    </article>
  );
}

function useOfficeImageSources(root: RecordValue | null): Map<string, string> {
  const imageRecords = useMemo(() => {
    return asArray(root?.images).map(asRecord).filter((image): image is RecordValue => image != null);
  }, [root]);

  const imageSources = useMemo(() => {
    const sources: ImageSource[] = [];
    for (const image of imageRecords) {
      const id = asString(image.id);
      if (!id) continue;

      const uri = asString(image.uri);
      if (uri) {
        sources.push({ id, src: uri });
        continue;
      }

      const bytes = bytesFromUnknown(image.data);
      if (bytes == null || bytes.byteLength === 0) continue;

      const contentType = asString(image.contentType) || inferImageContentType(id);
      const payload = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(payload).set(bytes);
      const blob = new Blob([payload], { type: contentType });
      sources.push({ id, src: URL.createObjectURL(blob) });
    }

    return sources;
  }, [imageRecords]);

  useEffect(() => {
    return () => {
      for (const image of imageSources) {
        if (image.src.startsWith("blob:")) {
          URL.revokeObjectURL(image.src);
        }
      }
    };
  }, [imageSources]);

  return useMemo(() => {
    return new Map(imageSources.map((image) => [image.id, image.src]));
  }, [imageSources]);
}

function slideBounds(slide: RecordValue): { width: number; height: number } {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  return elements.reduce<{ width: number; height: number }>(
    (acc, element) => {
      const bbox = asRecord(element.bbox);
      return {
        width: Math.max(acc.width, asNumber(bbox?.xEmu) + asNumber(bbox?.widthEmu)),
        height: Math.max(acc.height, asNumber(bbox?.yEmu) + asNumber(bbox?.heightEmu)),
      };
    },
    { width: 12_192_000, height: 6_858_000 },
  );
}

function SlideFrame({
  compact = false,
  imageSources,
  isActive = false,
  slide,
}: {
  compact?: boolean;
  imageSources: Map<string, string>;
  isActive?: boolean;
  slide: RecordValue;
}) {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const bounds = slideBounds(slide);
  const background = slideBackgroundToCss(slide);

  return (
    <div
      style={{
        aspectRatio: `${bounds.width} / ${bounds.height}`,
        background,
        border: `1px solid ${isActive ? "#0285ff" : "#cbd5e1"}`,
        borderRadius: 6,
        boxShadow: isActive ? "0 0 0 2px rgba(2, 133, 255, 0.18)" : "0 8px 22px rgba(15, 23, 42, 0.12)",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {elements.map((element, index) => (
        <SlideElement
          bounds={bounds}
          compact={compact}
          element={element}
          imageSources={imageSources}
          key={`${asString(element.id)}-${index}`}
        />
      ))}
    </div>
  );
}

function SlideElement({
  bounds,
  compact,
  element,
  imageSources,
}: {
  bounds: { width: number; height: number };
  compact: boolean;
  element: RecordValue;
  imageSources: Map<string, string>;
}) {
  const bbox = asRecord(element.bbox);
  const shape = asRecord(element.shape);
  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, EMPTY_DOCUMENT_STYLE_MAPS));
  const text = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).filter(Boolean).join("\n");
  const firstRun = asRecord(asArray(asRecord(asArray(element.paragraphs)[0])?.runs)[0]);
  const textStyle = asRecord(firstRun?.textStyle);
  const fill = fillToCss(shape?.fill);
  const line = lineToCss(shape?.line);
  const textColor = colorToCss(asRecord(textStyle?.fill)?.color) ?? "#0f172a";
  const fontScale = compact ? 0.15 : 1;
  const fontSize = Math.max(compact ? 2 : 10, Math.min(44, asNumber(textStyle?.fontSize, 1200) / 100) * fontScale);
  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? imageSources.get(imageId) : undefined;
  const heightEmu = asNumber(bbox?.heightEmu);
  const isLine = heightEmu === 0 && line.color != null;
  const borderRadius = shape?.geometry === 35 || shape?.geometry === 89 ? "999px" : 3;

  return (
    <div
      style={{
        alignItems: "center",
        background: text ? "transparent" : fill,
        borderColor: !isLine ? line.color : undefined,
        borderRadius,
        borderStyle: !isLine && line.color ? "solid" : undefined,
        borderTopColor: isLine ? line.color : undefined,
        borderTopStyle: isLine && line.color ? "solid" : undefined,
        borderTopWidth: isLine && line.color ? line.width : undefined,
        borderWidth: !isLine && line.color ? line.width : undefined,
        color: textColor,
        display: "flex",
        fontSize,
        fontWeight: textStyle?.bold === true ? 700 : 400,
        height: `${(asNumber(bbox?.heightEmu) / bounds.height) * 100}%`,
        left: `${(asNumber(bbox?.xEmu) / bounds.width) * 100}%`,
        lineHeight: 1.15,
        overflow: "hidden",
        padding: text ? (compact ? "0.05em" : "0.15em") : 0,
        position: "absolute",
        top: `${(asNumber(bbox?.yEmu) / bounds.height) * 100}%`,
        transform: `rotate(${asNumber(bbox?.rotation) / 60000}deg)`,
        whiteSpace: "pre-wrap",
        width: `${(asNumber(bbox?.widthEmu) / bounds.width) * 100}%`,
      }}
      title={asString(element.name)}
    >
      {imageSrc ? (
        <span
          aria-hidden="true"
          style={{
            backgroundImage: `url("${imageSrc}")`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 100%",
            height: "100%",
            inset: 0,
            position: "absolute",
            width: "100%",
          }}
        />
      ) : null}
      {text ? (
        <span style={{ display: "grid", position: "relative", width: "100%", zIndex: 1 }}>
          {paragraphs.map((paragraph, paragraphIndex) => (
            <span key={paragraph.id || paragraphIndex}>
              {paragraph.runs.map((run, runIndex) => (
                <span key={run.id || runIndex} style={textRunStyle(run, fontScale)}>
                  {run.text}
                </span>
              ))}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function DocumentPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const elements = asArray(root?.elements);
  const imageSources = useOfficeImageSources(root);
  const textStyles = new Map<string, RecordValue>();
  for (const style of asArray(root?.textStyles)) {
    const record = asRecord(style);
    const id = asString(record?.id);
    if (record && id) textStyles.set(id, record);
  }
  const styleMaps: DocumentStyleMaps = { textStyles, images: imageSources };

  const hasRenderableBlocks = elements.some((element) => {
    const record = asRecord(element);
    return (
      record != null &&
      (asArray(record.paragraphs).length > 0 || asRecord(record.table) != null || elementImageReferenceId(record) !== "")
    );
  });

  if (!hasRenderableBlocks) {
    const blocks = collectTextBlocks(elements.length > 0 ? elements : proto, 120);
    if (blocks.length === 0) {
      return <p style={{ color: "#64748b" }}>{labels.noDocumentBlocks}</p>;
    }

    return (
      <div data-testid="document-preview" style={{ display: "grid", gap: 10 }}>
        {blocks.map((block, index) => (
          <p key={`${block.slice(0, 24)}-${index}`} style={documentFallbackBlockStyle}>
            {block}
          </p>
        ))}
      </div>
    );
  }

  return (
    <article
      data-testid="document-preview"
      style={{
        background: "#ffffff",
        borderColor: "#d8e0ea",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
        color: "#0f172a",
        display: "grid",
        gap: 6,
        margin: "0 auto",
        maxWidth: 920,
        minHeight: 680,
        padding: "56px 64px",
        width: "100%",
      }}
    >
      {elements.map((element, index) => (
        <DocumentElement
          element={asRecord(element) ?? {}}
          key={`${asString(asRecord(element)?.id)}-${index}`}
          styleMaps={styleMaps}
        />
      ))}
    </article>
  );
}

function DocumentElement({
  element,
  styleMaps,
}: {
  element: RecordValue;
  styleMaps: DocumentStyleMaps;
}) {
  const table = asRecord(element.table);
  if (table) return <DocumentTable table={table} styleMaps={styleMaps} />;

  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? styleMaps.images.get(imageId) : undefined;
  if (imageSrc) {
    return (
      <span
        aria-label={asString(element.name)}
        role="img"
        style={{
          backgroundImage: `url("${imageSrc}")`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          display: "block",
          height: 280,
          maxHeight: 360,
          maxWidth: "100%",
          width: "100%",
        }}
      />
    );
  }

  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, styleMaps));
  if (paragraphs.length === 0) return null;

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <DocumentParagraph key={paragraph.id || index} paragraph={paragraph} />
      ))}
    </>
  );
}

function DocumentParagraph({ paragraph }: { paragraph: ParagraphView }) {
  return (
    <p style={paragraphStyle(paragraph)}>
      {paragraph.runs.map((run, index) => (
        <span key={run.id || index} style={textRunStyle(run)}>
          {run.text}
        </span>
      ))}
    </p>
  );
}

function DocumentTable({
  styleMaps,
  table,
}: {
  styleMaps: DocumentStyleMaps;
  table: RecordValue;
}) {
  const rows = asArray(table.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  if (rows.length === 0) return null;

  return (
    <div style={{ margin: "12px 0 18px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", minWidth: "70%", width: "100%" }}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={asString(row.id) || rowIndex}>
              {asArray(row.cells).map((cell, cellIndex) => {
                const cellRecord = asRecord(cell) ?? {};
                const paragraphs = asArray(cellRecord.paragraphs).map((paragraph) => paragraphView(paragraph, styleMaps));
                return (
                  <td
                    key={asString(cellRecord.id) || cellIndex}
                    style={{
                      background: rowIndex === 0 ? "#f8fafc" : "#ffffff",
                      borderColor: "#cbd5e1",
                      borderStyle: "solid",
                      borderWidth: 1,
                      color: "#0f172a",
                      padding: "8px 10px",
                      verticalAlign: "top",
                    }}
                  >
                    {paragraphs.length > 0 ? (
                      paragraphs.map((paragraph, index) => (
                        <DocumentParagraph key={paragraph.id || index} paragraph={paragraph} />
                      ))
                    ) : (
                      asString(cellRecord.text)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const documentFallbackBlockStyle: CSSProperties = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  color: "#0f172a",
  lineHeight: 1.6,
  margin: 0,
  paddingBottom: 10,
  whiteSpace: "pre-wrap",
};

function statusLabel(t: ReturnType<typeof useTranslation>["t"], status: ParseStage): string {
  switch (status) {
    case "idle":
      return t.debug.officeWasmPocStatusIdle;
    case "initializing":
      return t.debug.officeWasmPocStatusInitializing;
    case "parsing":
      return t.debug.officeWasmPocStatusParsing;
    case "ready":
      return t.debug.officeWasmPocStatusReady;
    case "error":
      return t.debug.officeWasmPocStatusError;
  }
}

export function OfficeWasmPocPageClient() {
  const { t } = useTranslation();
  const [selectedFileName, setSelectedFileName] = useState("");
  const [artifact, setArtifact] = useState<ParsedArtifact | null>(null);
  const [status, setStatus] = useState<ParseStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastBytes, setLastBytes] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setSelectedFileName("");
    setArtifact(null);
    setErrorMessage(null);
    setStatus("idle");
    setLastBytes(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const parseFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];
      if (!selected) {
        reset();
        return;
      }

      const kind = detectFileKind(selected.name);
      if (!kind) {
        reset();
        setErrorMessage(t.debug.unsupportedOfficeFormat);
        return;
      }

      setSelectedFileName(selected.name);
      setStatus("initializing");
      setErrorMessage(null);
      setIsBusy(true);
      setArtifact(null);

      try {
        setStatus("parsing");
        let parsed: ParsedArtifact;

        if (kind === "csv" || kind === "tsv") {
          parsed = await parseSpreadsheetFromCsv(selected, kind === "tsv" ? "\t" : undefined);
        } else {
          parsed = await parseDocument(selected, kind);
        }

        setArtifact(parsed);
        setLastBytes(selected.size);
        setStatus("ready");
      } catch (error: unknown) {
        setStatus("error");
        setErrorMessage(toErrorMessage(error));
      } finally {
        setIsBusy(false);
      }
    },
    [reset, t.debug.unsupportedOfficeFormat],
  );

  const preview =
    artifact == null ? "" : truncateJson(JSON.stringify(artifact.proto, null, 2));
  const labels: PreviewLabels = {
    visualPreview: t.debug.officeWasmPocVisualPreview,
    rawJson: t.debug.officeWasmPocRawJson,
    sheet: t.debug.officeWasmPocSheet,
    slide: t.debug.officeWasmPocSlide,
    noSheets: t.debug.officeWasmPocNoSheets,
    noSlides: t.debug.officeWasmPocNoSlides,
    noDocumentBlocks: t.debug.officeWasmPocNoDocumentBlocks,
    showingFirstRows: t.debug.officeWasmPocShowingFirstRows,
    shapes: t.debug.officeWasmPocShapes,
    textRuns: t.debug.officeWasmPocTextRuns,
  };

  return (
    <main
      style={{
        boxSizing: "border-box",
        display: "grid",
        fontFamily: "Arial, sans-serif",
        gap: 16,
        height: "100vh",
        maxWidth: "none",
        minHeight: "100vh",
        overflowY: "auto",
        padding: 24,
        width: "100%",
      }}
    >
      <header
        style={{
          alignItems: "center",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          paddingBottom: 12,
        }}
      >
        <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#475569", fontSize: 13 }}>{t.debug.officeWasmPocSelectFile}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.docx,.pptx,.xlsx"
            onChange={parseFile}
            disabled={isBusy}
          />
        </label>
        <div style={{ color: "#475569", fontSize: 13 }}>
          <strong>{t.debug.officeWasmPocStatus}</strong> {statusLabel(t, status)}
        </div>
        {selectedFileName ? (
          <div style={{ color: "#475569", fontSize: 13 }}>
            <code>{selectedFileName}</code>
            {lastBytes !== null ? <> ({lastBytes} {t.debug.officeWasmPocBytes})</> : null}
          </div>
        ) : null}
        {errorMessage ? <div style={{ color: "#b91c1c", fontSize: 13 }}>{errorMessage}</div> : null}
      </header>

      <section>
        {artifact ? (
          <div style={{ display: "grid", gap: 12 }}>
            <section data-testid="office-preview">
              <OfficePreview artifact={artifact} labels={labels} />
            </section>
            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer" }}>{labels.rawJson}</summary>
              <pre style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "420px",
                overflow: "auto",
                background: "#0b1020",
                color: "#f8fafc",
                padding: 12,
                borderRadius: 8,
              }}>
                {preview}
              </pre>
            </details>
          </div>
        ) : (
          <p>{t.debug.officeWasmPocNoResult}</p>
        )}
      </section>
    </main>
  );
}
