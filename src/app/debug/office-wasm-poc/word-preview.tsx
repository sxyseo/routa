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
  type TextRunView,
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
  const headerElements = wordSectionContentElements(root, "header");
  const footerElements = wordSectionContentElements(root, "footer");
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
  const referenceMarkers = wordReferenceMarkers(root);
  const reviewMarkTypes = wordReviewMarkTypes(root);

  const hasRenderableBlocks = [...headerElements, ...elements, ...footerElements].some((element) => {
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
        ...wordDocumentPageStyle(root),
        background: "#ffffff",
        borderColor: "#d8e0ea",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxSizing: "border-box",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
        color: "#0f172a",
        display: "grid",
        gap: 6,
        margin: "0 auto",
        maxWidth: "100%",
      }}
    >
      <WordSectionContent
        charts={charts}
        elements={headerElements}
        numberingMarkers={numberingMarkers}
        referenceMarkers={referenceMarkers}
        reviewMarkTypes={reviewMarkTypes}
        styleMaps={styleMaps}
        variant="header"
      />
      <section data-testid="word-body-content" style={wordBodyContentStyle(root)}>
        {elements.map((element, index) => (
          <WordElement
            charts={charts}
            element={asRecord(element) ?? {}}
            key={`${asString(asRecord(element)?.id)}-${index}`}
            numberingMarkers={numberingMarkers}
            referenceMarkers={referenceMarkers}
            reviewMarkTypes={reviewMarkTypes}
            styleMaps={styleMaps}
          />
        ))}
      </section>
      <WordSupplementalNotes
        numberingMarkers={numberingMarkers}
        referenceMarkers={referenceMarkers}
        reviewMarkTypes={reviewMarkTypes}
        root={root}
        styleMaps={styleMaps}
      />
      <WordSectionContent
        charts={charts}
        elements={footerElements}
        numberingMarkers={numberingMarkers}
        referenceMarkers={referenceMarkers}
        reviewMarkTypes={reviewMarkTypes}
        styleMaps={styleMaps}
        variant="footer"
      />
    </article>
  );
}

function WordSectionContent({
  charts,
  elements,
  numberingMarkers,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  variant,
}: {
  charts: RecordValue[];
  elements: unknown[];
  numberingMarkers: Map<string, string>;
  referenceMarkers: Map<string, string[]>;
  reviewMarkTypes: Map<string, number>;
  styleMaps: OfficeTextStyleMaps;
  variant: "footer" | "header";
}) {
  if (elements.length === 0) return null;

  return (
    <section style={variant === "header" ? wordHeaderContentStyle : wordFooterContentStyle}>
      {elements.map((element, index) => (
        <WordElement
          charts={charts}
          element={asRecord(element) ?? {}}
          key={`${variant}-${asString(asRecord(element)?.id)}-${index}`}
          numberingMarkers={numberingMarkers}
          referenceMarkers={referenceMarkers}
          reviewMarkTypes={reviewMarkTypes}
          styleMaps={styleMaps}
        />
      ))}
    </section>
  );
}

function WordElement({
  charts,
  element,
  numberingMarkers,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
}: {
  charts: RecordValue[];
  element: RecordValue;
  numberingMarkers: Map<string, string>;
  referenceMarkers: Map<string, string[]>;
  reviewMarkTypes: Map<string, number>;
  styleMaps: OfficeTextStyleMaps;
}) {
  const table = asRecord(element.table);
  if (table) {
    return (
      <WordTable
        element={element}
        numberingMarkers={numberingMarkers}
        referenceMarkers={referenceMarkers}
        reviewMarkTypes={reviewMarkTypes}
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
    wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes),
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
        <WordRun key={run.id || index} run={run} />
      ))}
    </p>
  );
}

function WordRun({ run }: { run: TextRunView }) {
  const href = wordHyperlinkHref(run.hyperlink);
  const style = wordRunStyle(run, href !== "");
  const text = href ? (
    <a
      href={href}
      rel={run.hyperlink?.isExternal === true ? "noreferrer" : undefined}
      style={style}
      target={run.hyperlink?.isExternal === true ? "_blank" : undefined}
    >
      {run.text}
    </a>
  ) : (
    <span style={style}>{run.text}</span>
  );

  const markers = run.referenceMarkers ?? [];
  if (markers.length === 0) return text;

  return (
    <>
      {text}
      {markers.map((marker) => (
        <sup key={`${run.id}-${marker}`} style={wordReferenceMarkerStyle}>
          {marker}
        </sup>
      ))}
    </>
  );
}

function wordParagraphView(
  paragraph: unknown,
  styleMaps: OfficeTextStyleMaps,
  numberingMarkers: Map<string, string>,
  referenceMarkers: Map<string, string[]>,
  reviewMarkTypes: Map<string, number>,
): ParagraphView {
  const view = paragraphView(paragraph, styleMaps);
  const marker = numberingMarkers.get(view.id);
  const runs = view.runs.map((run) => ({
    ...run,
    referenceMarkers: referenceMarkers.get(run.id) ?? [],
    reviewMarkTypes: (run.reviewMarkIds ?? []).map((id) => reviewMarkTypes.get(id) ?? 0).filter((type) => type > 0),
  }));
  return marker ? { ...view, marker, runs } : { ...view, runs };
}

function WordTable({
  element,
  numberingMarkers,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  table,
}: {
  element: RecordValue;
  numberingMarkers: Map<string, string>;
  referenceMarkers: Map<string, string[]>;
  reviewMarkTypes: Map<string, number>;
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
                  wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes),
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

function WordSupplementalNotes({
  numberingMarkers,
  referenceMarkers,
  reviewMarkTypes,
  root,
  styleMaps,
}: {
  numberingMarkers: Map<string, string>;
  referenceMarkers: Map<string, string[]>;
  reviewMarkTypes: Map<string, number>;
  root: RecordValue | null;
  styleMaps: OfficeTextStyleMaps;
}) {
  const items = wordSupplementalNoteItems(root, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes);
  if (items.length === 0) return null;

  return (
    <section style={wordSupplementalNotesStyle}>
      {items.map((item) => (
        <div key={item.id} style={wordSupplementalNoteStyle}>
          {item.paragraphs.map((paragraph, index) => (
            <WordParagraph key={paragraph.id || `${item.id}-${index}`} paragraph={paragraph} />
          ))}
        </div>
      ))}
    </section>
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
    marginTop: box.marginTop,
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
    marginTop: box.marginTop,
    maxWidth: "100%",
    width: box.width,
  };
}

export function wordTableContainerStyle(element: RecordValue): CSSProperties {
  const box = wordElementBox(element, WORD_PREVIEW_CONTENT_WIDTH_PX, 0);
  return {
    margin: "12px 0 18px",
    marginLeft: box.marginLeft,
    marginTop: box.marginTop,
    maxWidth: "100%",
    overflowX: "auto",
    width: box.hasDecodedSize ? box.width : "100%",
  };
}

export function wordBodyContentStyle(root: RecordValue | null): CSSProperties {
  const columns = wordSectionColumns(root);
  if (!columns) return {};
  return {
    columnCount: columns.count,
    columnGap: columns.gapPx,
    columnRuleColor: columns.separator ? "#cbd5e1" : undefined,
    columnRuleStyle: columns.separator ? "solid" : undefined,
    columnRuleWidth: columns.separator ? 1 : undefined,
  };
}

export function wordDocumentPageStyle(root: RecordValue | null): CSSProperties {
  const page = wordPageSetup(root);
  const widthPx = wordPageUnitToPx(page?.widthEmu ?? root?.widthEmu);
  const heightPx = wordPageUnitToPx(page?.heightEmu ?? root?.heightEmu);
  const margin = asRecord(page?.pageMargin);

  return {
    minHeight: heightPx > 0 ? Math.max(680, heightPx) : 680,
    paddingBottom: wordPageMarginPx(margin?.bottom, 56),
    paddingLeft: wordPageMarginPx(margin?.left, 64),
    paddingRight: wordPageMarginPx(margin?.right, 64),
    paddingTop: wordPageMarginPx(margin?.top, 56),
    width: widthPx > 0 ? Math.max(480, Math.min(960, widthPx)) : "100%",
  };
}

function wordSectionColumns(root: RecordValue | null): { count: number; gapPx?: number; separator: boolean } | null {
  for (const section of asArray(root?.sections).map(asRecord)) {
    const columns = asRecord(section?.columns);
    const count = Math.floor(asNumber(columns?.count));
    if (count > 1) {
      const spaceTwips = asNumber(columns?.space);
      return {
        count,
        gapPx: spaceTwips > 0 ? Math.max(8, Math.min(96, spaceTwips / 15)) : undefined,
        separator: columns?.separator === true || columns?.hasSeparatorLine === true,
      };
    }
  }
  return null;
}

function wordPageSetup(root: RecordValue | null): RecordValue | null {
  for (const section of asArray(root?.sections).map(asRecord)) {
    const pageSetup = asRecord(section?.pageSetup);
    if (pageSetup) return pageSetup;
  }
  return null;
}

function wordSupplementalNoteItems(
  root: RecordValue | null,
  styleMaps: OfficeTextStyleMaps,
  numberingMarkers: Map<string, string>,
  referenceMarkers: Map<string, string[]>,
  reviewMarkTypes: Map<string, number>,
): { id: string; paragraphs: ParagraphView[] }[] {
  const items: { id: string; paragraphs: ParagraphView[] }[] = [];

  for (const [index, footnote] of asArray(root?.footnotes).map(asRecord).entries()) {
    if (!footnote) continue;
    const paragraphs = wordSupplementalParagraphs(
      footnote,
      String(index + 1),
      styleMaps,
      numberingMarkers,
      referenceMarkers,
      reviewMarkTypes,
    );
    if (paragraphs.length > 0) {
      items.push({ id: `footnote-${asString(footnote.id) || index}`, paragraphs });
    }
  }

  for (const [index, comment] of asArray(root?.comments).map(asRecord).entries()) {
    if (!comment) continue;
    const paragraphs = wordSupplementalParagraphs(
      comment,
      `C${index + 1}`,
      styleMaps,
      numberingMarkers,
      referenceMarkers,
      reviewMarkTypes,
    );
    if (paragraphs.length > 0) {
      items.push({ id: `comment-${asString(comment.id) || index}`, paragraphs });
    }
  }

  return items;
}

function wordSectionContentElements(root: RecordValue | null, key: "footer" | "header"): unknown[] {
  for (const section of asArray(root?.sections).map(asRecord)) {
    const content = asRecord(section?.[key]);
    const elements = asArray(content?.elements);
    if (elements.length > 0) return elements;
  }
  return [];
}

function wordSupplementalParagraphs(
  record: RecordValue,
  marker: string,
  styleMaps: OfficeTextStyleMaps,
  numberingMarkers: Map<string, string>,
  referenceMarkers: Map<string, string[]>,
  reviewMarkTypes: Map<string, number>,
): ParagraphView[] {
  return asArray(record.paragraphs).map((paragraph, index) => {
    const view = wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes);
    return index === 0 ? { ...view, marker } : view;
  });
}

function wordHyperlinkHref(hyperlink: unknown): string {
  const record = asRecord(hyperlink);
  const uri = asString(record?.uri);
  const action = asString(record?.action);
  return uri || action;
}

function wordRunStyle(run: TextRunView, hyperlink: boolean): CSSProperties {
  const style: CSSProperties = {
    ...textRunStyle(run),
    ...wordReviewMarkStyle(run.reviewMarkTypes ?? []),
  };
  if (!hyperlink) return style;
  return {
    ...style,
    color: style.color ?? "#2563eb",
    textDecoration: style.textDecoration ?? "underline",
  };
}

function wordReviewMarkStyle(types: number[]): CSSProperties {
  if (types.includes(2)) {
    return {
      color: "#b91c1c",
      textDecoration: "line-through",
    };
  }

  if (types.includes(1)) {
    return {
      backgroundColor: "#dcfce7",
      textDecoration: "underline",
      textDecorationColor: "#16a34a",
    };
  }

  return {};
}

function wordReviewMarkTypes(root: RecordValue | null): Map<string, number> {
  const reviewMarkTypes = new Map<string, number>();
  for (const reviewMark of asArray(root?.reviewMarks).map(asRecord)) {
    const id = asString(reviewMark?.id);
    const type = asNumber(reviewMark?.type);
    if (id && type > 0) reviewMarkTypes.set(id, type);
  }
  return reviewMarkTypes;
}

function wordReferenceMarkers(root: RecordValue | null): Map<string, string[]> {
  const markers = new Map<string, string[]>();
  for (const [index, footnote] of asArray(root?.footnotes).map(asRecord).entries()) {
    if (!footnote) continue;
    for (const runId of asArray(footnote.referenceRunIds).map(asString).filter(Boolean)) {
      addReferenceMarker(markers, runId, String(index + 1));
    }
  }

  const commentOrder = new Map<string, number>();
  for (const [index, comment] of asArray(root?.comments).map(asRecord).entries()) {
    const id = asString(comment?.id);
    if (id) commentOrder.set(id, index + 1);
  }

  for (const reference of asArray(root?.commentReferences).map(asRecord)) {
    const commentId = asString(reference?.commentId);
    const markerIndex = commentOrder.get(commentId) ?? commentOrder.size + 1;
    for (const runId of asArray(reference?.runIds).map(asString).filter(Boolean)) {
      addReferenceMarker(markers, runId, `C${markerIndex}`);
    }
  }

  return markers;
}

function addReferenceMarker(markers: Map<string, string[]>, runId: string, marker: string): void {
  const existing = markers.get(runId) ?? [];
  if (!existing.includes(marker)) {
    markers.set(runId, [...existing, marker]);
  }
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
  marginTop?: number;
  rawHeight: number;
  rawWidth: number;
  width: number;
};

function wordElementBox(element: RecordValue, fallbackWidth: number, fallbackHeight: number): WordElementBox {
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const yPx = emuToPx(box?.yEmu);
  const hasDecodedSize = rawWidth > 0 && (rawHeight > 0 || fallbackHeight <= 0);
  const width = hasDecodedSize ? Math.max(24, Math.min(WORD_PREVIEW_CONTENT_WIDTH_PX, rawWidth)) : fallbackWidth;
  const height = hasDecodedSize && rawHeight > 0 ? Math.max(18, rawHeight * (width / rawWidth)) : fallbackHeight;
  const maxOffset = Math.max(0, WORD_PREVIEW_CONTENT_WIDTH_PX - width);

  return {
    hasDecodedSize,
    height,
    marginLeft: xPx > 0 ? Math.min(maxOffset, xPx) : undefined,
    marginTop: yPx > 0 ? Math.min(240, yPx) : undefined,
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

function wordTableBorderStyle(style: unknown): string {
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

function wordPageUnitToPx(value: unknown): number {
  const raw = asNumber(value);
  if (raw <= 0) return 0;
  return raw > 100_000 ? raw / 9_525 : raw / 15;
}

function wordPageMarginPx(value: unknown, fallback: number): number {
  const px = wordPageUnitToPx(value);
  if (px <= 0) return fallback;
  return Math.max(24, Math.min(120, px));
}

const WORD_PREVIEW_CONTENT_WIDTH_PX = 720;

const wordParagraphMarkerStyle: CSSProperties = {
  display: "inline-block",
  minWidth: "2.25em",
  paddingRight: "0.35em",
  textAlign: "right",
};

const wordHeaderContentStyle: CSSProperties = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  color: "#475569",
  fontSize: 12,
  marginBottom: 12,
  paddingBottom: 8,
};

const wordFooterContentStyle: CSSProperties = {
  borderTopColor: "#e2e8f0",
  borderTopStyle: "solid",
  borderTopWidth: 1,
  color: "#475569",
  fontSize: 12,
  marginTop: 12,
  paddingTop: 8,
};

const wordReferenceMarkerStyle: CSSProperties = {
  color: "#475569",
  fontSize: "0.72em",
  marginLeft: 2,
};

const wordSupplementalNotesStyle: CSSProperties = {
  borderTopColor: "#cbd5e1",
  borderTopStyle: "solid",
  borderTopWidth: 1,
  display: "grid",
  gap: 4,
  marginTop: 18,
  paddingTop: 10,
};

const wordSupplementalNoteStyle: CSSProperties = {
  color: "#334155",
  fontSize: 12,
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
