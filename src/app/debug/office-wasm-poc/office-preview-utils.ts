"use client";

import { type CSSProperties, useMemo } from "react";

export type RecordValue = Record<string, unknown>;

export type PreviewLabels = {
  closeSlideshow: string;
  nextSlide: string;
  playSlideshow: string;
  previousSlide: string;
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

export type TextRunView = {
  hyperlink?: RecordValue | null;
  id: string;
  referenceMarkers?: string[];
  reviewMarkIds?: string[];
  reviewMarkTypes?: number[];
  text: string;
  style: RecordValue | null;
};

export type ParagraphView = {
  id: string;
  marker?: string;
  runs: TextRunView[];
  styleId: string;
  style: RecordValue | null;
};

export type OfficeTextStyleMaps = {
  textStyles: Map<string, RecordValue>;
  images: Map<string, string>;
};

export type CellMerge = {
  startColumn: number;
  startRow: number;
  columnSpan: number;
  rowSpan: number;
};

export const EXCEL_MAX_COLUMN_COUNT = 16_384;
export const EXCEL_MAX_ROW_COUNT = 1_048_576;

export const EMPTY_OFFICE_TEXT_STYLE_MAPS: OfficeTextStyleMaps = {
  textStyles: new Map(),
  images: new Map(),
};

type ImageSource = {
  id: string;
  src: string;
};

type ImagePayload = {
  bytes: Uint8Array | null;
  contentType: string;
  id: string;
  uri: string;
};

export function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null ? (value as RecordValue) : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function bytesFromUnknown(value: unknown): Uint8Array | null {
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

export function inferImageContentType(id: string): string {
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

export function colorToCss(value: unknown): string | undefined {
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

export function fillToCss(fill: unknown): string | undefined {
  const fillRecord = asRecord(fill);
  if (fillRecord == null || asNumber(fillRecord.type) === 0) return undefined;
  return colorToCss(fillRecord.color);
}

export function spreadsheetFillToCss(fill: unknown): string | undefined {
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

export function lineToCss(line: unknown): { color?: string; width: number } {
  const lineRecord = asRecord(line);
  const fillRecord = asRecord(lineRecord?.fill);
  const color = colorToCss(fillRecord?.color);
  const width = Math.max(1, Math.min(4, asNumber(lineRecord?.widthEmu) / 9_000));
  return { color, width };
}

export function slideBackgroundToCss(slide: RecordValue): string {
  const background = asRecord(slide.background);
  const fill = asRecord(background?.fill);
  return fillToCss(fill) ?? "#ffffff";
}

export function imageReferenceId(value: unknown): string {
  const record = asRecord(value);
  return asString(record?.id);
}

export function elementImageReferenceId(element: RecordValue): string {
  const direct = imageReferenceId(element.imageReference);
  if (direct) return direct;

  const fill = asRecord(element.fill);
  const fillImage = imageReferenceId(fill?.imageReference);
  if (fillImage) return fillImage;

  const shapeFill = asRecord(asRecord(element.shape)?.fill);
  return imageReferenceId(shapeFill?.imageReference);
}

export function paragraphText(paragraph: unknown): string {
  const runs = asArray(asRecord(paragraph)?.runs);
  return runs.map((run) => asString(asRecord(run)?.text)).join("");
}

export function paragraphView(paragraph: unknown, styleMaps: OfficeTextStyleMaps): ParagraphView {
  const record = asRecord(paragraph);
  const styleId = asString(record?.styleId);
  const style = {
    ...resolvedTextStyle(styleId, styleMaps),
    ...(asRecord(record?.paragraphStyle) ?? {}),
    ...(asRecord(record?.style) ?? {}),
    ...(asRecord(record?.textStyle) ?? {}),
    ...definedRecordProperties(record, TEXT_STYLE_FIELDS),
  };
  const runs = asArray(record?.runs)
    .map(asRecord)
    .filter((run): run is RecordValue => run != null)
    .map((run, index) => ({
      hyperlink: asRecord(run.hyperlink),
      id: asString(run.id) || `${asString(record?.id)}-${index}`,
      referenceMarkers: [],
      reviewMarkIds: asArray(run.reviewMarkIds).map(asString).filter(Boolean),
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

function resolvedTextStyle(styleId: string, styleMaps: OfficeTextStyleMaps, visited = new Set<string>()): RecordValue {
  if (!styleId || visited.has(styleId)) return {};

  const styleRecord = styleMaps.textStyles.get(styleId);
  if (!styleRecord) return {};

  const basedOn = asString(styleRecord.basedOn);
  const nextVisited = new Set(visited);
  nextVisited.add(styleId);

  return {
    ...resolvedTextStyle(basedOn, styleMaps, nextVisited),
    ...(asRecord(styleRecord.textStyle) ?? {}),
    ...(asRecord(styleRecord.paragraphStyle) ?? {}),
    ...definedRecordProperties(styleRecord, TEXT_STYLE_FIELDS),
  };
}

const TEXT_STYLE_FIELDS = [
  "alignment",
  "bulletCharacter",
  "indent",
  "lineSpacing",
  "lineSpacingPercent",
  "marginLeft",
  "spaceAfter",
  "spaceBefore",
];

function definedRecordProperties(record: RecordValue | null, keys: string[]): RecordValue {
  const values: RecordValue = {};
  if (!record) return values;

  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      values[key] = record[key];
    }
  }

  return values;
}

export function paragraphStyle(paragraph: ParagraphView): CSSProperties {
  const isTitle = paragraph.styleId === "Title";
  const isHeading = /^Heading/i.test(paragraph.styleId);
  const spaceBefore = asNumber(paragraph.style?.spaceBefore);
  const spaceAfter = asNumber(paragraph.style?.spaceAfter);
  const marginLeft = emuToCssPx(paragraph.style?.marginLeft);
  const textIndent = emuToCssPx(paragraph.style?.indent);

  return {
    color: colorToCss(asRecord(paragraph.style?.fill)?.color) ?? "#0f172a",
    fontFamily: officeFontFamily(asString(paragraph.style?.typeface)),
    fontSize: cssFontSize(paragraph.style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14),
    fontWeight: paragraph.style?.bold === true || isTitle || isHeading ? 700 : 400,
    lineHeight: paragraphLineHeight(paragraph),
    margin: 0,
    marginBottom: spaceAfter ? Math.min(28, spaceAfter / 20) : isTitle || isHeading ? 10 : 8,
    marginLeft: marginLeft || undefined,
    marginTop: spaceBefore ? Math.min(32, spaceBefore / 20) : isHeading ? 12 : 0,
    textAlign: paragraphTextAlign(paragraph.style?.alignment),
    textIndent: textIndent || undefined,
    whiteSpace: "pre-wrap",
  };
}

function paragraphLineHeight(paragraph: ParagraphView): CSSProperties["lineHeight"] {
  const exactPoints = asNumber(paragraph.style?.lineSpacing);
  if (exactPoints > 0) return `${Math.max(8, Math.min(96, exactPoints / 100))}pt`;

  const percent = asNumber(paragraph.style?.lineSpacingPercent);
  if (percent > 0) return Math.max(0.8, Math.min(3, percent / 100_000));

  return 1.55;
}

function paragraphTextAlign(alignment: unknown): CSSProperties["textAlign"] {
  switch (asNumber(alignment)) {
    case 2:
      return "center";
    case 3:
      return "right";
    case 4:
      return "justify";
    default:
      return undefined;
  }
}

function emuToCssPx(value: unknown): number {
  const emu = asNumber(value);
  if (emu === 0) return 0;
  return emu / 9_525;
}

export function textRunStyle(run: TextRunView, fontScale = 1): CSSProperties {
  const runFontSize = run.style?.fontSize == null ? undefined : cssFontSize(run.style.fontSize, 14) * fontScale;
  const scheme = docxSchemeStyle(run.style?.scheme);
  const typeface = asString(run.style?.typeface) || scheme.typeface;
  return {
    backgroundColor: scheme.backgroundColor,
    color: colorToCss(asRecord(run.style?.fill)?.color) ?? undefined,
    fontFamily: officeFontFamily(typeface),
    fontSize: runFontSize == null ? undefined : Math.max(fontScale < 1 ? 2 : 8, Math.min(fontScale < 1 ? 12 : 72, runFontSize)),
    fontStyle: run.style?.italic === true ? "italic" : run.style?.italic === false ? "normal" : undefined,
    fontWeight: run.style?.bold === true ? 700 : run.style?.bold === false ? 400 : undefined,
    ...docxTextDecoration(run.style?.underline),
    textTransform: scheme.textTransform,
  };
}

function docxTextDecoration(value: unknown): Pick<CSSProperties, "textDecoration" | "textDecorationStyle"> {
  if (value === true) return { textDecoration: "underline" };
  if (value === false) return { textDecoration: "none" };

  const underline = asString(value).toLowerCase();
  if (!underline) return {};
  if (underline === "none") return { textDecoration: "none" };
  return {
    textDecoration: "underline",
    textDecorationStyle: docxUnderlineStyle(underline),
  };
}

function docxUnderlineStyle(underline: string): CSSProperties["textDecorationStyle"] {
  if (underline.includes("double")) return "double";
  if (underline.includes("dotted") || underline.includes("dot")) return "dotted";
  if (underline.includes("dash")) return "dashed";
  if (underline.includes("wave") || underline.includes("wavy")) return "wavy";
  return undefined;
}

function docxSchemeStyle(scheme: unknown): Pick<CSSProperties, "backgroundColor" | "textTransform"> & {
  typeface: string;
} {
  const parts = asString(scheme).split(";").filter(Boolean);
  const style: Pick<CSSProperties, "backgroundColor" | "textTransform"> & { typeface: string } = { typeface: "" };
  for (const part of parts) {
    if (part === "__docxCaps:true") {
      style.textTransform = "uppercase";
      continue;
    }

    if (part.startsWith("__docxHighlight:")) {
      style.backgroundColor = docxHighlightToCss(part.slice("__docxHighlight:".length));
      continue;
    }

    if (part.startsWith("__docxEastAsiaTypeface:")) {
      style.typeface ||= part.slice("__docxEastAsiaTypeface:".length);
      continue;
    }

    if (part.startsWith("__docxComplexScriptTypeface:")) {
      style.typeface ||= part.slice("__docxComplexScriptTypeface:".length);
    }
  }
  return style;
}

function docxHighlightToCss(value: string): string | undefined {
  switch (value.toLowerCase()) {
    case "black":
      return "#000000";
    case "blue":
      return "#0000ff";
    case "cyan":
      return "#00ffff";
    case "darkblue":
      return "#000080";
    case "darkcyan":
      return "#008080";
    case "darkgray":
      return "#808080";
    case "darkgreen":
      return "#008000";
    case "darkmagenta":
      return "#800080";
    case "darkred":
      return "#800000";
    case "darkyellow":
      return "#808000";
    case "green":
      return "#00ff00";
    case "lightgray":
      return "#c0c0c0";
    case "magenta":
      return "#ff00ff";
    case "red":
      return "#ff0000";
    case "white":
      return "#ffffff";
    case "yellow":
      return "#ffff00";
    default:
      return undefined;
  }
}

export const OFFICE_FONT_FALLBACK =
  'Aptos, Carlito, Calibri, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const OFFICE_SERIF_FONT_FALLBACK =
  '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", "Noto Serif CJK", serif';

export function officeFontFamily(typeface: string): string {
  const normalized = typeface.trim();
  if (!normalized) return OFFICE_FONT_FALLBACK;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const fallback = /serif|song|宋|明|仿宋|楷/i.test(normalized)
    ? `${OFFICE_SERIF_FONT_FALLBACK}, ${OFFICE_FONT_FALLBACK}`
    : OFFICE_FONT_FALLBACK;
  return `"${escaped}", ${fallback}`;
}

export async function prewarmOfficeFonts(typefaces: Iterable<string>): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const fontSet = document.fonts;
  const families = new Set(["Aptos", "Carlito", "Calibri", "Arial", ...Array.from(typefaces).filter(Boolean)]);
  await Promise.all(
    Array.from(families).map(async (family) => {
      try {
        await fontSet.load(`400 16px ${officeFontFamily(family)}`);
      } catch {
        // Optional font probing should never block preview rendering.
      }
    }),
  );
}

export function collectTextBlocks(value: unknown, limit = 80): string[] {
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

export function columnIndexFromAddress(address: string): number {
  const match = normalizedCellReference(address).match(/^\$?([A-Z]+)/i);
  if (!match) return 0;

  let index = 0;
  for (const char of (match[1] ?? "").toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

export function rowIndexFromAddress(address: string): number {
  const match = normalizedCellReference(address).match(/\$?(\d+)/);
  if (!match) return 1;
  return Math.max(1, Number.parseInt(match[1] ?? "1", 10));
}

export function parseCellRange(reference: string): CellMerge | null {
  const normalizedReference = normalizedCellReference(reference);
  const hasRangeSeparator = normalizedReference.includes(":");
  const [startRaw, endRaw = startRaw] = normalizedReference.split(":");
  if (!startRaw) return null;

  const start = parseCellRangeEndpoint(startRaw);
  const end = parseCellRangeEndpoint(endRaw);
  if (!start.hasColumn && !start.hasRow && !end.hasColumn && !end.hasRow) return null;

  const startColumn = start.columnIndex ?? 0;
  const startRow = start.rowIndex ?? 1;
  const endColumn = end.columnIndex ?? (hasRangeSeparator ? EXCEL_MAX_COLUMN_COUNT - 1 : startColumn);
  const endRow = end.rowIndex ?? (hasRangeSeparator ? EXCEL_MAX_ROW_COUNT : startRow);
  return {
    startColumn: Math.min(startColumn, endColumn),
    startRow: Math.min(startRow, endRow),
    columnSpan: Math.abs(endColumn - startColumn) + 1,
    rowSpan: Math.abs(endRow - startRow) + 1,
  };
}

function normalizedCellReference(reference: string): string {
  const sheetSeparator = reference.lastIndexOf("!");
  return (sheetSeparator >= 0 ? reference.slice(sheetSeparator + 1) : reference)
    .replace(/^'|'$/g, "")
    .trim();
}

function parseCellRangeEndpoint(reference: string): {
  columnIndex?: number;
  hasColumn: boolean;
  hasRow: boolean;
  rowIndex?: number;
} {
  const trimmed = reference.trim();
  const columnMatch = trimmed.match(/^\$?([A-Z]+)/i);
  const rowMatch = trimmed.match(/\$?(\d+)/);
  const columnIndex = columnMatch ? columnIndexFromAddress(trimmed) : undefined;
  const rowIndex = rowMatch ? rowIndexFromAddress(trimmed) : undefined;
  return {
    ...(columnIndex != null ? { columnIndex } : {}),
    hasColumn: columnMatch != null,
    hasRow: rowMatch != null,
    ...(rowIndex != null ? { rowIndex } : {}),
  };
}

export function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

export function resolveStyleRecord(record: RecordValue | null, keys: string[]): RecordValue | null {
  for (const key of keys) {
    const candidate = asRecord(record?.[key]);
    if (candidate) return candidate;
  }

  return null;
}

export function cssFontSize(value: unknown, fallbackPx: number): number {
  const raw = asNumber(value);
  if (raw <= 0) return fallbackPx;
  if (raw > 200) return Math.max(8, Math.min(72, raw / 100));
  return Math.max(8, Math.min(72, raw));
}

export function cellText(cell: unknown): string {
  const record = asRecord(cell);
  if (record == null) return "";

  const value = asString(record.value);
  if (value) return value;

  const formula = asString(record.formula) || asString(record.formulaText);
  if (formula) return spreadsheetFormulaDisplayText(formula);

  const paragraphs = asArray(record.paragraphs);
  return paragraphs.map(paragraphText).filter(Boolean).join("\n");
}

function spreadsheetFormulaDisplayText(formula: string): string {
  const hyperlinkLabel = spreadsheetHyperlinkFormulaLabel(formula);
  if (hyperlinkLabel) return hyperlinkLabel;
  return `=${formula.replace(/^=/, "")}`;
}

function spreadsheetHyperlinkFormulaLabel(formula: string): string | null {
  const normalized = formula.trim().replace(/^=/, "");
  const openIndex = normalized.indexOf("(");
  const closeIndex = normalized.lastIndexOf(")");
  if (openIndex < 0 || closeIndex <= openIndex) return null;
  if (normalized.slice(0, openIndex).trim().toUpperCase() !== "HYPERLINK") return null;

  const args = splitSpreadsheetFormulaArgs(normalized.slice(openIndex + 1, closeIndex));
  const displayArg = args[1]?.trim() || args[0]?.trim();
  if (!displayArg) return null;
  return spreadsheetStringLiteralValue(displayArg) ?? displayArg;
}

function splitSpreadsheetFormulaArgs(source: string): string[] {
  const args: string[] = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      current += char;
      if (inString && source[index + 1] === '"') {
        current += source[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }

    if (char === "," && !inString) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  args.push(current.trim());
  return args;
}

function spreadsheetStringLiteralValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
  return trimmed.slice(1, -1).replaceAll('""', '"');
}

export function styleAt(values: unknown, index: unknown): RecordValue | null {
  const styleIndex = asNumber(index, -1);
  if (styleIndex < 0) return null;
  return asRecord(asArray(values)[styleIndex]);
}

export function useOfficeImageSources(root: RecordValue | null): Map<string, string> {
  const imageRecords = useMemo(() => {
    const rootImages = asArray(root?.images).map(asRecord).filter((image): image is RecordValue => image != null);
    return [...rootImages.map(imagePayloadFromImageRecord), ...collectElementImagePayloads(root)].filter(
      (image): image is ImagePayload => image != null,
    );
  }, [root]);

  const imageSources = useMemo(() => {
    const sources: ImageSource[] = [];
    for (const image of imageRecords) {
      const bytes = image.bytes;
      if (bytes != null && bytes.byteLength > 0) {
        const contentType = image.contentType || inferImageContentType(image.id);
        const payload = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(payload).set(bytes);
        const blob = new Blob([payload], { type: contentType });
        sources.push({ id: image.id, src: URL.createObjectURL(blob) });
        continue;
      }

      if (image.uri) {
        sources.push({ id: image.id, src: image.uri });
      }
    }

    return sources;
  }, [imageRecords]);

  return useMemo(() => {
    return new Map(imageSources.map((image) => [image.id, image.src]));
  }, [imageSources]);
}

function imagePayloadFromImageRecord(image: RecordValue): ImagePayload | null {
  const id = asString(image.id);
  if (!id) return null;

  return {
    bytes: bytesFromUnknown(image.data ?? image.bytes),
    contentType: asString(image.contentType),
    id,
    uri: asString(image.uri),
  };
}

function collectElementImagePayloads(root: RecordValue | null): ImagePayload[] {
  if (root == null) return [];

  const payloads: ImagePayload[] = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (record == null || seen.has(record)) return;
    seen.add(record);

    const image = asRecord(record.image);
    const id = imageReferenceId(record.imageReference);
    if (image != null && id) {
      payloads.push({
        bytes: bytesFromUnknown(image.data ?? image.bytes),
        contentType: asString(image.contentType),
        id,
        uri: asString(image.uri),
      });
    }

    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }

  visit(root);
  return payloads;
}
