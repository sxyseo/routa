"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  collectTextBlocks,
  colorToCss,
  elementImageReferenceId,
  fillToCss,
  lineToCss,
  type OfficeTextStyleMaps,
  paragraphStyle,
  type ParagraphView,
  paragraphView,
  type PreviewLabels,
  type RecordValue,
  textRunStyle,
  useOfficeImageSources,
} from "./office-preview-utils";
import {
  drawPresentationChart,
  presentationChartById,
  presentationChartReferenceId,
} from "./presentation-chart-renderer";

export function WordPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const elements = asArray(root?.elements);
  const charts = asArray(root?.charts).map(asRecord).filter((chart): chart is RecordValue => chart != null);
  const imageSources = useOfficeImageSources(root);
  const textStyles = new Map<string, RecordValue>();
  for (const style of asArray(root?.textStyles)) {
    const record = asRecord(style);
    const id = asString(record?.id);
    if (record && id) textStyles.set(id, record);
  }
  const styleMaps: OfficeTextStyleMaps = { textStyles, images: imageSources };
  const numberingMarkers = wordNumberingMarkers(elements, root, styleMaps);

  const hasRenderableBlocks = elements.some((element) => {
    const record = asRecord(element);
    return (
      record != null &&
      (asArray(record.paragraphs).length > 0 ||
        asRecord(record.table) != null ||
        asRecord(record.chartReference) != null ||
        elementImageReferenceId(record) !== "")
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
        <WordElement
          charts={charts}
          element={asRecord(element) ?? {}}
          key={`${asString(asRecord(element)?.id)}-${index}`}
          numberingMarkers={numberingMarkers}
          styleMaps={styleMaps}
        />
      ))}
    </article>
  );
}

function WordElement({
  charts,
  element,
  numberingMarkers,
  styleMaps,
}: {
  charts: RecordValue[];
  element: RecordValue;
  numberingMarkers: Map<string, string>;
  styleMaps: OfficeTextStyleMaps;
}) {
  const table = asRecord(element.table);
  if (table) {
    return (
      <WordTable
        element={element}
        numberingMarkers={numberingMarkers}
        table={table}
        styleMaps={styleMaps}
      />
    );
  }

  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? styleMaps.images.get(imageId) : undefined;
  if (imageSrc) {
    return (
      <span
        aria-label={asString(element.name)}
        role="img"
        style={wordImageStyle(element, imageSrc)}
      />
    );
  }

  const chart = presentationChartById(charts, presentationChartReferenceId(element.chartReference));
  if (chart) return <WordChart chart={chart} element={element} />;

  const paragraphs = asArray(element.paragraphs).map((paragraph) =>
    wordParagraphView(paragraph, styleMaps, numberingMarkers),
  );
  if (paragraphs.length === 0) return null;

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <WordParagraph key={paragraph.id || index} paragraph={paragraph} />
      ))}
    </>
  );
}

function WordChart({ chart, element }: { chart: RecordValue; element: RecordValue }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const box = wordElementBox(element, 560, 300);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(box.height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);
    drawPresentationChart(
      context,
      chart,
      { height: box.height, left: 0, top: 0, width: box.width },
      Math.max(0.7, Math.min(1.2, box.width / 560)),
    );
  }, [box.height, box.width, chart]);

  return (
    <canvas
      aria-label={asString(chart.title) || "Chart"}
      ref={canvasRef}
      role="img"
      style={wordChartStyle(element)}
    />
  );
}

function WordParagraph({
  fallbackColor,
  paragraph,
}: {
  fallbackColor?: string;
  paragraph: ParagraphView;
}) {
  const style = paragraphStyle(paragraph);
  if (fallbackColor && asRecord(paragraph.style?.fill)?.color == null) {
    style.color = fallbackColor;
  }

  return (
    <p style={style}>
      {paragraph.marker ? (
        <span aria-hidden="true" style={wordParagraphMarkerStyle}>
          {paragraph.marker}
        </span>
      ) : null}
      {paragraph.runs.map((run, index) => (
        <span key={run.id || index} style={textRunStyle(run)}>
          {run.text}
        </span>
      ))}
    </p>
  );
}

function wordParagraphView(
  paragraph: unknown,
  styleMaps: OfficeTextStyleMaps,
  numberingMarkers: Map<string, string>,
): ParagraphView {
  const view = paragraphView(paragraph, styleMaps);
  const marker = numberingMarkers.get(view.id);
  return marker ? { ...view, marker } : view;
}

function WordTable({
  element,
  numberingMarkers,
  styleMaps,
  table,
}: {
  element: RecordValue;
  numberingMarkers: Map<string, string>;
  styleMaps: OfficeTextStyleMaps;
  table: RecordValue;
}) {
  const rows = asArray(table.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  if (rows.length === 0) return null;
  const columnWidths = asArray(table.columnWidths).map((width) => asNumber(width)).filter((width) => width > 0);
  const columnWidthTotal = columnWidths.reduce((total, width) => total + width, 0);

  return (
    <div style={wordTableContainerStyle(element)}>
      <table style={wordTableStyle(columnWidths.length > 0)}>
        {columnWidths.length > 0 ? (
          <colgroup>
            {columnWidths.map((width, index) => (
              <col key={`${width}-${index}`} style={{ width: `${(width / columnWidthTotal) * 100}%` }} />
            ))}
          </colgroup>
        ) : null}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={asString(row.id) || rowIndex}>
              {asArray(row.cells).map((cell, cellIndex) => {
                const cellRecord = asRecord(cell) ?? {};
                const paragraphs = asArray(cellRecord.paragraphs).map((paragraph) =>
                  wordParagraphView(paragraph, styleMaps, numberingMarkers),
                );
                const background = wordFillToCss(cellRecord.fill) ?? (rowIndex === 0 ? "#f8fafc" : "#ffffff");
                const fallbackTextColor = readableTextColor(background);
                const gridSpan = Math.max(1, Math.floor(asNumber(cellRecord.gridSpan, 1)));
                const rowSpan = Math.max(1, Math.floor(asNumber(cellRecord.rowSpan, 1)));
                return (
                  <td
                    colSpan={gridSpan > 1 ? gridSpan : undefined}
                    key={asString(cellRecord.id) || cellIndex}
                    rowSpan={rowSpan > 1 ? rowSpan : undefined}
                    style={wordTableCellStyle(cellRecord, background, fallbackTextColor)}
                  >
                    {paragraphs.length > 0 ? (
                      paragraphs.map((paragraph, index) => (
                        <WordParagraph
                          fallbackColor={fallbackTextColor}
                          key={paragraph.id || index}
                          paragraph={paragraph}
                        />
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

export function wordImageStyle(element: RecordValue, imageSrc: string): CSSProperties {
  const box = wordElementBox(element, WORD_PREVIEW_CONTENT_WIDTH_PX, 280);

  return {
    aspectRatio: box.hasDecodedSize ? `${box.rawWidth} / ${box.rawHeight}` : undefined,
    backgroundImage: `url("${imageSrc}")`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    display: "block",
    height: box.hasDecodedSize ? undefined : box.height,
    marginLeft: box.marginLeft,
    maxHeight: box.hasDecodedSize ? undefined : 360,
    maxWidth: "100%",
    width: box.hasDecodedSize ? box.width : "100%",
  };
}

export function wordChartStyle(element: RecordValue): CSSProperties {
  const box = wordElementBox(element, 560, 300);
  return {
    display: "block",
    height: box.height,
    margin: "12px 0 18px",
    marginLeft: box.marginLeft,
    maxWidth: "100%",
    width: box.width,
  };
}

export function wordTableContainerStyle(element: RecordValue): CSSProperties {
  const box = wordElementBox(element, WORD_PREVIEW_CONTENT_WIDTH_PX, 0);
  return {
    margin: "12px 0 18px",
    marginLeft: box.marginLeft,
    maxWidth: "100%",
    overflowX: "auto",
    width: box.hasDecodedSize ? box.width : "100%",
  };
}

function wordNumberingMarkers(
  elements: unknown[],
  root: RecordValue | null,
  styleMaps: OfficeTextStyleMaps,
): Map<string, string> {
  const numberingByParagraphId = new Map<string, { level: number; numId: string }>();
  for (const numbering of asArray(root?.paragraphNumberings)) {
    const record = asRecord(numbering);
    const paragraphId = asString(record?.paragraphId);
    const numId = asString(record?.numId);
    if (!paragraphId || !numId) continue;
    numberingByParagraphId.set(paragraphId, {
      level: Math.max(0, Math.floor(asNumber(record?.level))),
      numId,
    });
  }

  const counters = new Map<string, number>();
  const markers = new Map<string, string>();
  for (const paragraph of wordParagraphRecords(elements)) {
    const view = paragraphView(paragraph, styleMaps);
    const numbering = numberingByParagraphId.get(view.id);
    if (!numbering) continue;

    resetDeeperNumberingLevels(counters, numbering.numId, numbering.level);
    const counterKey = `${numbering.numId}:${numbering.level}`;
    const current = counters.has(counterKey)
      ? (counters.get(counterKey) ?? 0) + 1
      : Math.max(1, Math.floor(asNumber(view.style?.autoNumberStartAt, 1)));
    counters.set(counterKey, current);

    const marker = wordNumberingMarker(asString(view.style?.autoNumberType), current);
    if (marker) markers.set(view.id, marker);
  }

  return markers;
}

function wordParagraphRecords(elements: unknown[]): unknown[] {
  const paragraphs: unknown[] = [];
  for (const element of elements) {
    const record = asRecord(element);
    if (!record) continue;
    paragraphs.push(...asArray(record.paragraphs));

    const table = asRecord(record.table);
    for (const row of asArray(table?.rows)) {
      const rowRecord = asRecord(row);
      for (const cell of asArray(rowRecord?.cells)) {
        paragraphs.push(...asArray(asRecord(cell)?.paragraphs));
      }
    }
  }
  return paragraphs;
}

function resetDeeperNumberingLevels(counters: Map<string, number>, numId: string, level: number): void {
  const prefix = `${numId}:`;
  for (const key of Array.from(counters.keys())) {
    if (!key.startsWith(prefix)) continue;
    const keyLevel = Number.parseInt(key.slice(prefix.length), 10);
    if (keyLevel > level) counters.delete(key);
  }
}

function wordNumberingMarker(type: string, value: number): string {
  switch (type) {
    case "arabicPeriod":
      return `${value}.`;
    case "arabicParenR":
      return `${value})`;
    case "alphaLcPeriod":
      return `${alphabeticMarker(value, false)}.`;
    case "alphaLcParenR":
      return `${alphabeticMarker(value, false)})`;
    case "alphaUcPeriod":
      return `${alphabeticMarker(value, true)}.`;
    case "alphaUcParenR":
      return `${alphabeticMarker(value, true)})`;
    case "romanLcPeriod":
      return `${romanMarker(value).toLowerCase()}.`;
    case "romanLcParenR":
      return `${romanMarker(value).toLowerCase()})`;
    case "romanUcPeriod":
      return `${romanMarker(value)}.`;
    case "romanUcParenR":
      return `${romanMarker(value)})`;
    default:
      return "";
  }
}

function alphabeticMarker(value: number, uppercase: boolean): string {
  let remaining = Math.max(1, value);
  let marker = "";
  while (remaining > 0) {
    remaining -= 1;
    marker = String.fromCharCode(97 + (remaining % 26)) + marker;
    remaining = Math.floor(remaining / 26);
  }
  return uppercase ? marker.toUpperCase() : marker;
}

function romanMarker(value: number): string {
  let remaining = Math.max(1, Math.min(3999, value));
  let marker = "";
  for (const [symbol, amount] of [
    ["M", 1000],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1],
  ] as const) {
    while (remaining >= amount) {
      marker += symbol;
      remaining -= amount;
    }
  }
  return marker;
}

type WordElementBox = {
  hasDecodedSize: boolean;
  height: number;
  marginLeft?: number;
  rawHeight: number;
  rawWidth: number;
  width: number;
};

function wordElementBox(element: RecordValue, fallbackWidth: number, fallbackHeight: number): WordElementBox {
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const hasDecodedSize = rawWidth > 0 && (rawHeight > 0 || fallbackHeight <= 0);
  const width = hasDecodedSize ? Math.max(24, Math.min(WORD_PREVIEW_CONTENT_WIDTH_PX, rawWidth)) : fallbackWidth;
  const height = hasDecodedSize && rawHeight > 0 ? Math.max(18, rawHeight * (width / rawWidth)) : fallbackHeight;
  const maxOffset = Math.max(0, WORD_PREVIEW_CONTENT_WIDTH_PX - width);

  return {
    hasDecodedSize,
    height,
    marginLeft: xPx > 0 ? Math.min(maxOffset, xPx) : undefined,
    rawHeight,
    rawWidth,
    width,
  };
}

function wordTableStyle(hasColumnWidths: boolean): CSSProperties {
  return {
    borderCollapse: "collapse",
    minWidth: "70%",
    tableLayout: hasColumnWidths ? "fixed" : "auto",
    width: "100%",
  };
}

export function wordTableCellStyle(cell: RecordValue, background: string, color: string): CSSProperties {
  return {
    background,
    color,
    ...wordTableCellBorders(cell.lines),
    paddingBottom: tableCellPaddingPx(cell.marginBottom, 8),
    paddingLeft: tableCellPaddingPx(cell.marginLeft, 10),
    paddingRight: tableCellPaddingPx(cell.marginRight, 10),
    paddingTop: tableCellPaddingPx(cell.marginTop, 8),
    verticalAlign: wordVerticalAlign(cell.anchor),
  };
}

function wordTableCellBorders(lines: unknown): CSSProperties {
  const lineRecord = asRecord(lines);
  if (lineRecord == null || Object.keys(lineRecord).length === 0) {
    return {
      borderColor: "#cbd5e1",
      borderStyle: "solid",
      borderWidth: 1,
    };
  }

  return {
    borderWidth: 0,
    ...wordTableBorderSide("Top", lineRecord.top),
    ...wordTableBorderSide("Right", lineRecord.right),
    ...wordTableBorderSide("Bottom", lineRecord.bottom),
    ...wordTableBorderSide("Left", lineRecord.left),
  };
}

function wordTableBorderSide(side: "Top" | "Right" | "Bottom" | "Left", line: unknown): CSSProperties {
  const lineRecord = asRecord(line);
  if (lineRecord == null) return {};

  const border = lineToCss(lineRecord);
  const css: Record<string, string | number> = {};
  css[`border${side}Color`] = border.color ?? "#cbd5e1";
  css[`border${side}Style`] = wordTableBorderStyle(lineRecord.style);
  css[`border${side}Width`] = border.width;
  return css as CSSProperties;
}

function wordTableBorderStyle(style: unknown): CSSProperties["borderStyle"] {
  switch (asNumber(style)) {
    case 2:
      return "dashed";
    case 3:
      return "dotted";
    case 4:
    case 5:
      return "dashed";
    default:
      return "solid";
  }
}

function tableCellPaddingPx(value: unknown, fallback: number): number {
  const emu = asNumber(value);
  if (emu <= 0) return fallback;
  return Math.max(2, Math.min(28, emuToPx(emu)));
}

function wordVerticalAlign(anchor: unknown): CSSProperties["verticalAlign"] {
  switch (asString(anchor)) {
    case "center":
      return "middle";
    case "bottom":
      return "bottom";
    default:
      return "top";
  }
}

function emuToPx(value: unknown): number {
  return asNumber(value) / 9_525;
}

const WORD_PREVIEW_CONTENT_WIDTH_PX = 720;

const wordParagraphMarkerStyle: CSSProperties = {
  display: "inline-block",
  minWidth: "2.25em",
  paddingRight: "0.35em",
  textAlign: "right",
};

function wordFillToCss(fill: unknown): string | undefined {
  const fillRecord = asRecord(fill);
  return fillToCss(fillRecord) ?? colorToCss(fillRecord?.color);
}

function readableTextColor(background: string): string {
  const rgb = hexCssToRgb(background);
  if (rgb == null) return "#0f172a";
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance < 0.45 ? "#ffffff" : "#0f172a";
}

function hexCssToRgb(value: string): [number, number, number] | null {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
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
