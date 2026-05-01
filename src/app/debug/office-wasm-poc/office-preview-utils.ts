"use client";

import { type CSSProperties, useEffect, useMemo } from "react";

export type RecordValue = Record<string, unknown>;

export type PreviewLabels = {
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
  id: string;
  text: string;
  style: RecordValue | null;
};

export type ParagraphView = {
  id: string;
  runs: TextRunView[];
  styleId: string;
  style: RecordValue | null;
};

export type DocumentStyleMaps = {
  textStyles: Map<string, RecordValue>;
  images: Map<string, string>;
};

export type CellMerge = {
  startColumn: number;
  startRow: number;
  columnSpan: number;
  rowSpan: number;
};

export const EMPTY_DOCUMENT_STYLE_MAPS: DocumentStyleMaps = {
  textStyles: new Map(),
  images: new Map(),
};

type ImageSource = {
  id: string;
  src: string;
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

export function paragraphView(paragraph: unknown, styleMaps: DocumentStyleMaps): ParagraphView {
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

export function paragraphStyle(paragraph: ParagraphView): CSSProperties {
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

export function textRunStyle(run: TextRunView, fontScale = 1): CSSProperties {
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
  const match = address.match(/^[A-Z]+/i);
  if (!match) return 0;

  let index = 0;
  for (const char of match[0].toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

export function rowIndexFromAddress(address: string): number {
  const match = address.match(/\d+/);
  if (!match) return 1;
  return Math.max(1, Number.parseInt(match[0], 10));
}

export function parseCellRange(reference: string): CellMerge | null {
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
  if (formula) return `=${formula.replace(/^=/, "")}`;

  const paragraphs = asArray(record.paragraphs);
  return paragraphs.map(paragraphText).filter(Boolean).join("\n");
}

export function styleAt(values: unknown, index: unknown): RecordValue | null {
  const styleIndex = asNumber(index, -1);
  if (styleIndex < 0) return null;
  return asRecord(asArray(values)[styleIndex]);
}

export function useOfficeImageSources(root: RecordValue | null): Map<string, string> {
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

      const bytes = bytesFromUnknown(image.data ?? image.bytes);
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
