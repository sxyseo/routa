"use client";

import { useEffect, useRef, type CSSProperties } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  bytesFromUnknown,
  collectTextBlocks,
  colorToCss,
  cssFontSize,
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
import {
  wordSplitOversizedTableElements,
  wordTableElementEstimatedHeight,
} from "./word-preview-table-pagination";

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
  const pages = wordPreviewPages(root, elements, styleMaps);
  const numberingMarkers = wordNumberingMarkers(elements, root, styleMaps);
  const referenceMarkers = wordReferenceMarkers(root);
  const reviewMarkTypes = wordReviewMarkTypes(root);

  const hasRenderableBlocks = pages.flatMap((page) => [...page.headerElements, ...page.elements, ...page.footerElements]).some((element) => {
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

  const renderedPages = pages.map((page, index) => (
    <WordDocumentPage
      charts={charts}
      elements={page.elements}
      footerElements={page.footerElements}
      headerElements={page.headerElements}
      key={page.id || index}
      numberingMarkers={numberingMarkers}
      pageLayout={wordPageLayout(page.root)}
      pageRoot={page.root}
      referenceMarkers={referenceMarkers}
      reviewMarkTypes={reviewMarkTypes}
      supplementalRoot={index === pages.length - 1 ? root : null}
      styleMaps={styleMaps}
    />
  ));

  return pages.length > 1 ? <div style={wordDocumentStackStyle}>{renderedPages}</div> : renderedPages[0];
}

function WordDocumentPage({
  charts,
  elements,
  footerElements,
  headerElements,
  numberingMarkers,
  pageLayout,
  pageRoot,
  referenceMarkers,
  reviewMarkTypes,
  supplementalRoot,
  styleMaps,
}: {
  charts: RecordValue[];
  elements: unknown[];
  footerElements: unknown[];
  headerElements: unknown[];
  numberingMarkers: Map<string, string>;
  pageLayout: WordPageLayout;
  pageRoot: RecordValue | null;
  referenceMarkers: Map<string, string[]>;
  reviewMarkTypes: Map<string, number>;
  supplementalRoot: RecordValue | null;
  styleMaps: OfficeTextStyleMaps;
}) {
  return (
    <article
      data-testid="document-preview"
      style={{
        ...wordDocumentPageStyleFromLayout(pageLayout),
        ...wordDocumentPageCssVars(pageLayout),
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
        pageLayout={pageLayout}
        styleMaps={styleMaps}
        variant="header"
      />
      <section data-testid="word-body-content" style={wordBodyContentStyle(pageRoot)}>
        {elements.map((element, index) => (
          <WordElement
            charts={charts}
            element={asRecord(element) ?? {}}
            key={`${asString(asRecord(element)?.id)}-${index}`}
            numberingMarkers={numberingMarkers}
            pageLayout={pageLayout}
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
        root={supplementalRoot}
        styleMaps={styleMaps}
      />
      <WordSectionContent
        charts={charts}
        elements={footerElements}
        numberingMarkers={numberingMarkers}
        referenceMarkers={referenceMarkers}
        reviewMarkTypes={reviewMarkTypes}
        pageLayout={pageLayout}
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
  pageLayout,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  variant,
}: {
  charts: RecordValue[];
  elements: unknown[];
  numberingMarkers: Map<string, string>;
  pageLayout: WordPageLayout;
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
          pageLayout={pageLayout}
          referenceMarkers={referenceMarkers}
          reviewMarkTypes={reviewMarkTypes}
          styleMaps={styleMaps}
        />
      ))}
    </section>
  );
}

type WordPreviewPage = {
  elements: unknown[];
  footerElements: unknown[];
  headerElements: unknown[];
  id: string;
  root: RecordValue | null;
};

function wordPreviewPages(
  root: RecordValue | null,
  rootElements: unknown[],
  styleMaps: OfficeTextStyleMaps,
): WordPreviewPage[] {
  const sections = asArray(root?.sections)
    .map(asRecord)
    .filter((section): section is RecordValue => section != null);
  const inheritedSectionContent = { footer: [] as unknown[], header: [] as unknown[] };
  const sectionPages = sections.map((section, index) => {
    const headerElements = wordInheritedSectionContentElements(section, "header", inheritedSectionContent);
    const footerElements = wordInheritedSectionContentElements(section, "footer", inheritedSectionContent);
    return {
      elements: asArray(section.elements),
      footerElements,
      headerElements,
      id: asString(section.id) || `section-${index + 1}`,
      root: section,
    };
  })
    .filter((page) => page.elements.length > 0);

  if (sectionPages.some((page) => page.elements.length > 0)) {
    return wordPreviewSectionPages(root, rootElements, sectionPages, styleMaps);
  }

  return wordPaginatePreviewPages([
    {
      elements: wordCollapseTinyDuplicateImages(rootElements, root),
      footerElements: wordSectionContentElements(root, "footer"),
      headerElements: wordSectionContentElements(root, "header"),
      id: "document",
      root,
    },
  ], styleMaps);
}

function wordInheritedSectionContentElements(
  section: RecordValue,
  key: "footer" | "header",
  inheritedContent: { footer: unknown[]; header: unknown[] },
): unknown[] {
  const elements = wordSectionContentElements(section, key);
  if (elements.length === 0) return inheritedContent[key];
  inheritedContent[key] = elements;
  return elements;
}

function wordPreviewSectionPages(
  root: RecordValue | null,
  rootElements: unknown[],
  sectionPages: WordPreviewPage[],
  styleMaps: OfficeTextStyleMaps,
): WordPreviewPage[] {
  if (rootElements.length === 0) {
    return wordPaginatePreviewPages(
      sectionPages.map((page) => ({ ...page, elements: wordCollapseTinyDuplicateImages(page.elements, root) })),
      styleMaps,
    );
  }

  let offset = 0;
  const pages = sectionPages.map((page, index) => {
    const nextOffset = offset + page.elements.length;
    const elements = index === sectionPages.length - 1 ? rootElements.slice(offset) : rootElements.slice(offset, nextOffset);
    offset = nextOffset;
    return { ...page, elements };
  }).filter((page) => page.elements.length > 0);

  return wordPaginatePreviewPages(
    pages.map((page) => ({ ...page, elements: wordCollapseTinyDuplicateImages(page.elements, root) })),
    styleMaps,
  );
}

function wordPaginatePreviewPages(
  pages: WordPreviewPage[],
  styleMaps: OfficeTextStyleMaps,
): WordPreviewPage[] {
  return pages.flatMap((page) => wordPaginatePreviewPage(page, styleMaps));
}

function wordPaginatePreviewPage(page: WordPreviewPage, styleMaps: OfficeTextStyleMaps): WordPreviewPage[] {
  const layout = wordPageLayout(page.root);
  const capacity = wordPageBodyCapacity(layout, page);
  const tableHeightContext = wordTableHeightContext(styleMaps, layout);
  const elements = wordSplitOversizedTableElements(page.elements, capacity, tableHeightContext);
  if (capacity <= 0 || elements.length <= 1) return [{ ...page, elements }];
  if (wordIsCoverLikeFullBleedPage(page, layout)) return [page];

  const chunks: WordPreviewPage[] = [];
  let current: unknown[] = [];
  let currentHeight = 0;

  for (const element of elements) {
    const estimatedHeight = wordElementEstimatedHeight(element, styleMaps, layout);
    const shouldBreak = current.length > 0 && currentHeight + estimatedHeight > capacity;
    if (shouldBreak) {
      chunks.push(wordPreviewPageChunk(page, chunks.length, current));
      current = [];
      currentHeight = 0;
    }

    current.push(element);
    currentHeight += estimatedHeight;
  }

  if (current.length > 0) {
    chunks.push(wordPreviewPageChunk(page, chunks.length, current));
  }

  return chunks.length > 0 ? chunks : [page];
}

function wordIsCoverLikeFullBleedPage(page: WordPreviewPage, pageLayout: WordPageLayout): boolean {
  return page.elements.length <= 12 && page.elements.some((element) => {
    const record = asRecord(element);
    return record != null && elementImageReferenceId(record) !== "" && wordIsFullBleedElement(record, pageLayout);
  });
}

function wordPreviewPageChunk(page: WordPreviewPage, index: number, elements: unknown[]): WordPreviewPage {
  return {
    ...page,
    elements,
    id: `${page.id}-page-${index + 1}`,
  };
}

function wordCollapseTinyDuplicateImages(elements: unknown[], root: RecordValue | null): unknown[] {
  const tinyImageIds = wordTinyImageIds(root);

  const collapsedElements: unknown[] = [];
  let previousImageBoxKey = "";
  for (const element of elements) {
    const record = asRecord(element);
    if (!record) { previousImageBoxKey = ""; collapsedElements.push(element); continue; }

    const imageId = elementImageReferenceId(record);
    if (!imageId) { previousImageBoxKey = ""; collapsedElements.push(element); continue; }

    const boxKey = wordImageBoxKey(record);
    const isTinyDuplicate = tinyImageIds.has(imageId) && boxKey !== "" && boxKey === previousImageBoxKey;
    previousImageBoxKey = boxKey;
    if (!isTinyDuplicate) collapsedElements.push(element);
  }

  return wordOrderFigureCaptionImages(collapsedElements);
}

function wordOrderFigureCaptionImages(elements: unknown[]): unknown[] {
  const orderedElements: unknown[] = [];
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const nextElement = elements[index + 1];
    const record = asRecord(element);
    const nextRecord = asRecord(nextElement);
    if (record != null && nextRecord != null && wordIsFigureCaptionElement(record) && elementImageReferenceId(nextRecord)) {
      orderedElements.push(nextElement, element);
      index++;
      continue;
    }

    orderedElements.push(element);
  }
  return orderedElements;
}

function wordIsFigureCaptionElement(element: RecordValue): boolean {
  const text = asArray(element.paragraphs)
    .map((paragraph) => {
      const record = asRecord(paragraph);
      return asArray(record?.runs).map((run) => asString(asRecord(run)?.text)).join("");
    })
    .join("")
    .trim();
  return /^Figure[-\s]/i.test(text);
}

function wordTinyImageIds(root: RecordValue | null): Set<string> {
  const ids = new Set<string>();
  for (const image of asArray(root?.images).map(asRecord)) {
    const id = asString(image?.id);
    const bytes = bytesFromUnknown(image?.data ?? image?.bytes);
    if (id && bytes != null && bytes.byteLength > 0 && bytes.byteLength <= 100) {
      ids.add(id);
    }
  }
  return ids;
}

function wordImageBoxKey(element: RecordValue): string {
  const box = asRecord(element.bbox);
  const x = Math.round(asNumber(box?.xEmu));
  const y = Math.round(asNumber(box?.yEmu));
  const width = Math.round(asNumber(box?.widthEmu));
  const height = Math.round(asNumber(box?.heightEmu));
  return width > 0 && height > 0 ? `${x}:${y}:${width}:${height}` : "";
}

function wordPageBodyCapacity(layout: WordPageLayout, page: WordPreviewPage): number {
  if (layout.heightPx <= 0) return 0;
  const headerReserve = page.headerElements.length > 0 ? 24 : 0;
  const footerReserve = page.footerElements.length > 0 ? 24 : 0;
  return Math.max(180, layout.heightPx - layout.paddingTop - layout.paddingBottom - headerReserve - footerReserve);
}

function wordElementEstimatedHeight(
  element: unknown,
  styleMaps: OfficeTextStyleMaps,
  pageLayout: WordPageLayout,
): number {
  const record = asRecord(element);
  if (!record) return 0;

  if (elementImageReferenceId(record)) {
    return wordEstimatedBoxHeight(record, pageLayout, 280);
  }

  if (asRecord(record.chartReference)) {
    return wordEstimatedBoxHeight(record, pageLayout, 300) + 18;
  }

  const table = asRecord(record.table);
  if (table) {
    return wordTableElementEstimatedHeight(table, wordTableHeightContext(styleMaps, pageLayout));
  }

  const paragraphs = asArray(record.paragraphs);
  if (paragraphs.length === 0) return 0;
  return paragraphs.reduce<number>(
    (total, paragraph) => total + wordParagraphEstimatedHeight(paragraph, styleMaps, pageLayout),
    0,
  );
}

function wordEstimatedBoxHeight(element: RecordValue, pageLayout: WordPageLayout, fallbackHeight: number): number {
  const box = wordElementBox(element, WORD_PREVIEW_CONTENT_WIDTH_PX, fallbackHeight);
  const fullBleed = wordIsFullBleedElement(element, pageLayout);
  const height = fullBleed && box.rawWidth > 0 ? box.rawHeight * (pageLayout.widthPx / box.rawWidth) : box.height;
  return Math.max(18, Math.min(900, height + (box.marginTop ?? 0) + 16));
}

function wordParagraphEstimatedHeight(
  paragraph: unknown,
  styleMaps: OfficeTextStyleMaps,
  pageLayout: WordPageLayout,
): number {
  const view = paragraphView(paragraph, styleMaps);
  const style = view.style;
  const textLength = Math.max(1, view.runs.reduce((total, run) => total + run.text.length, 0));
  const isTitle = view.styleId === "Title";
  const isHeading = /^Heading/i.test(view.styleId);
  const fontSize = wordCssFontSize(style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14);
  const lineHeight = wordEstimatedLineHeight(style, fontSize);
  const contentWidth = Math.max(120, pageLayout.widthPx - pageLayout.paddingLeft - pageLayout.paddingRight);
  const averageCharWidth = Math.max(4, fontSize * 0.52);
  const charsPerLine = Math.max(8, Math.floor(contentWidth / averageCharWidth));
  const explicitLines = view.runs.reduce((count, run) => count + run.text.split("\n").length - 1, 0);
  const lines = Math.max(1, Math.ceil(textLength / charsPerLine) + explicitLines);
  const before = Math.min(32, asNumber(style?.spaceBefore) / 20);
  const after = Math.min(28, asNumber(style?.spaceAfter) / 20);
  return Math.max(8, before + lines * lineHeight + after);
}

function wordTableHeightContext(styleMaps: OfficeTextStyleMaps, pageLayout: WordPageLayout) {
  return {
    contentWidth: Math.max(120, pageLayout.widthPx - pageLayout.paddingLeft - pageLayout.paddingRight),
    paragraphHeight: (paragraph: unknown) => wordParagraphEstimatedHeight(paragraph, styleMaps, pageLayout),
    tableParagraphHeight: (paragraph: unknown, contentWidth: number) =>
      wordTableParagraphEstimatedHeight(paragraph, styleMaps, contentWidth),
  };
}

function wordTableParagraphEstimatedHeight(
  paragraph: unknown,
  styleMaps: OfficeTextStyleMaps,
  contentWidth: number,
): number {
  const view = paragraphView(paragraph, styleMaps);
  const style = view.style;
  const textLength = Math.max(1, view.runs.reduce((total, run) => total + run.text.length, 0));
  const fontSize = Math.min(wordCssFontSize(style?.fontSize, 10.5), 10.5);
  const lineHeight = fontSize * 1.15;
  const averageCharWidth = Math.max(4, fontSize * 0.48);
  const charsPerLine = Math.max(8, Math.floor(contentWidth / averageCharWidth));
  const explicitLines = view.runs.reduce((count, run) => count + run.text.split("\n").length - 1, 0);
  const lines = Math.max(1, Math.ceil(textLength / charsPerLine) + explicitLines);
  return Math.max(20, lines * lineHeight + 1);
}

function wordEstimatedLineHeight(style: RecordValue | null, fontSize: number): number {
  const exactPoints = asNumber(style?.lineSpacing);
  if (exactPoints > 0) return Math.max(10, Math.min(128, (exactPoints / 100) * (4 / 3)));

  const percent = asNumber(style?.lineSpacingPercent);
  if (percent > 0) return fontSize * Math.max(0.8, Math.min(3, percent / 100_000));

  return fontSize * 1.35;
}

function wordCssFontSize(value: unknown, fallbackPx: number): number {
  const raw = asNumber(value);
  if (raw > 200) return Math.max(8, Math.min(72, (raw / 100) * (4 / 3)));
  return cssFontSize(value, fallbackPx);
}

function WordElement({
  charts,
  element,
  numberingMarkers,
  pageLayout,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
}: {
  charts: RecordValue[];
  element: RecordValue;
  numberingMarkers: Map<string, string>;
  pageLayout: WordPageLayout;
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
        style={wordImageStyle(element, imageSrc, pageLayout)}
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
  variant = "body",
}: {
  fallbackColor?: string;
  paragraph: ParagraphView;
  variant?: "body" | "table";
}) {
  const style = variant === "table" ? wordTableParagraphStyle(paragraph) : wordParagraphStyle(paragraph);
  if (fallbackColor && asRecord(paragraph.style?.fill)?.color == null) {
    style.color = fallbackColor;
  }

  return (
    <p style={style}>
      {paragraph.marker ? (
        <span aria-hidden="true" style={wordParagraphMarkerStyle(paragraph.marker)}>
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
  const marker = numberingMarkers.get(view.id) || asString(view.style?.bulletCharacter);
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
            <tr key={asString(row.id) || rowIndex} style={wordTableRowStyle(row)}>
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
                          variant="table"
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
          {item.meta ? <div style={wordSupplementalNoteMetaStyle}>{item.meta}</div> : null}
          {item.paragraphs.map((paragraph, index) => (
            <WordParagraph key={paragraph.id || `${item.id}-${index}`} paragraph={paragraph} />
          ))}
        </div>
      ))}
    </section>
  );
}

export function wordImageStyle(
  element: RecordValue,
  imageSrc: string,
  pageLayout?: WordPageLayout,
): CSSProperties {
  const box = wordElementBox(element, WORD_PREVIEW_CONTENT_WIDTH_PX, 280);
  const fullBleed = pageLayout ? wordIsFullBleedElement(element, pageLayout) : false;
  const topBleed = fullBleed && wordElementY(element) <= 2;

  return {
    aspectRatio: box.hasDecodedSize ? `${box.rawWidth} / ${box.rawHeight}` : undefined,
    backgroundImage: `url("${imageSrc}")`,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "contain",
    display: "block",
    height: box.hasDecodedSize ? undefined : box.height,
    marginLeft: fullBleed ? "calc(-1 * var(--word-page-padding-left, 0px))" : box.marginLeft,
    marginTop: topBleed ? "calc(-1 * var(--word-page-padding-top, 0px))" : box.marginTop,
    maxHeight: box.hasDecodedSize ? undefined : 360,
    maxWidth: fullBleed ? "none" : "100%",
    width: fullBleed && pageLayout
      ? pageLayout.widthPx
      : box.hasDecodedSize
        ? box.width
        : "100%",
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
  return wordDocumentPageStyleFromLayout(wordPageLayout(root));
}

function wordDocumentPageStyleFromLayout(pageLayout: WordPageLayout): CSSProperties {
  return {
    minHeight: pageLayout.heightPx > 0 ? Math.max(680, pageLayout.heightPx) : 680,
    paddingBottom: pageLayout.paddingBottom,
    paddingLeft: pageLayout.paddingLeft,
    paddingRight: pageLayout.paddingRight,
    paddingTop: pageLayout.paddingTop,
    width: pageLayout.widthPx > 0 ? pageLayout.widthPx : "100%",
  };
}

function wordDocumentPageCssVars(pageLayout: WordPageLayout): CSSProperties {
  return {
    "--word-page-padding-left": `${pageLayout.paddingLeft}px`,
    "--word-page-padding-right": `${pageLayout.paddingRight}px`,
    "--word-page-padding-top": `${pageLayout.paddingTop}px`,
  } as CSSProperties;
}

export type WordPageLayout = {
  heightPx: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  widthPx: number;
};

function wordPageLayout(root: RecordValue | null): WordPageLayout {
  const page = wordPageSetup(root);
  const widthPx = wordPageUnitToPx(page?.widthEmu ?? root?.widthEmu);
  const heightPx = wordPageUnitToPx(page?.heightEmu ?? root?.heightEmu);
  const margin = asRecord(page?.pageMargin);

  return {
    heightPx,
    paddingBottom: wordPageMarginPx(margin?.bottom, 56),
    paddingLeft: wordPageMarginPx(margin?.left, 64),
    paddingRight: wordPageMarginPx(margin?.right, 64),
    paddingTop: wordPageMarginPx(margin?.top, 56),
    widthPx: widthPx > 0 ? Math.max(480, Math.min(960, widthPx)) : 0,
  };
}

function wordSectionColumns(root: RecordValue | null): { count: number; gapPx?: number; separator: boolean } | null {
  const sections = asRecord(root?.columns) ? [root] : asArray(root?.sections).map(asRecord);
  for (const section of sections) {
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
  const directPageSetup = asRecord(root?.pageSetup);
  if (directPageSetup) return directPageSetup;

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
): { id: string; meta?: string; paragraphs: ParagraphView[] }[] {
  const items: { id: string; meta?: string; paragraphs: ParagraphView[] }[] = [];

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
      items.push({
        id: `comment-${asString(comment.id) || index}`,
        meta: wordCommentMeta(comment),
        paragraphs,
      });
    }
  }

  return items;
}

function wordCommentMeta(comment: RecordValue): string | undefined {
  const author = asString(comment.author);
  const initials = asString(comment.initials);
  const createdAt = asString(comment.createdAt || comment.date);
  const parts = [author, initials ? `(${initials})` : "", createdAt]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function wordSectionContentElements(root: RecordValue | null, key: "footer" | "header"): unknown[] {
  const directContent = asRecord(root?.[key]);
  const directElements = asArray(directContent?.elements);
  if (directElements.length > 0) return directElements;

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
  if (run.style?.fontSize != null) {
    style.fontSize = wordCssFontSize(run.style.fontSize, 14);
  }

  if (!hyperlink) return style;
  return {
    ...style,
    color: style.color ?? "#2563eb",
    textDecoration: style.textDecoration ?? "underline",
  };
}

function wordReviewMarkStyle(types: number[]): CSSProperties {
  if (types.includes(2)) return { color: "#b91c1c", textDecoration: "line-through" };
  if (types.includes(1)) return { backgroundColor: "#dcfce7", textDecoration: "underline", textDecorationColor: "#16a34a" };
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

  const numberingDefinitions = wordNumberingDefinitionLevels(root);
  const counters = new Map<string, number>();
  const markers = new Map<string, string>();
  for (const paragraph of wordParagraphRecords(elements)) {
    const view = paragraphView(paragraph, styleMaps);
    const numbering = numberingByParagraphId.get(view.id);
    if (!numbering) continue;

    resetDeeperNumberingLevels(counters, numbering.numId, numbering.level);
    const counterKey = `${numbering.numId}:${numbering.level}`;
    const definition = numberingDefinitions.get(counterKey);
    const current = counters.has(counterKey)
      ? (counters.get(counterKey) ?? 0) + 1
      : Math.max(1, Math.floor(asNumber(view.style?.autoNumberStartAt, asNumber(definition?.startAt, 1))));
    counters.set(counterKey, current);

    const marker = wordNumberingMarkerForDefinition(asString(view.style?.autoNumberType), definition, current);
    if (marker) markers.set(view.id, marker);
  }

  return markers;
}

type WordNumberingLevel = {
  levelText: string;
  numberFormat: string;
  startAt: number;
};

function wordNumberingDefinitionLevels(root: RecordValue | null): Map<string, WordNumberingLevel> {
  const levelsByKey = new Map<string, WordNumberingLevel>();
  for (const definition of asArray(root?.numberingDefinitions).map(asRecord)) {
    const numId = asString(definition?.numId);
    if (!numId) continue;

    for (const level of asArray(definition?.levels).map(asRecord)) {
      const levelIndex = Math.max(0, Math.floor(asNumber(level?.level)));
      levelsByKey.set(`${numId}:${levelIndex}`, {
        levelText: asString(level?.levelText),
        numberFormat: asString(level?.numberFormat),
        startAt: Math.max(1, Math.floor(asNumber(level?.startAt, 1))),
      });
    }
  }
  return levelsByKey;
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
  const alphaLc = alphabeticMarker(value, false);
  const alphaUc = alphabeticMarker(value, true);
  const romanUc = romanMarker(value);
  const romanLc = romanUc.toLowerCase();
  return (
    {
      alphaLcParenR: `${alphaLc})`,
      alphaLcPeriod: `${alphaLc}.`,
      alphaUcParenR: `${alphaUc})`,
      alphaUcPeriod: `${alphaUc}.`,
      arabicParenR: `${value})`,
      arabicPeriod: `${value}.`,
      romanLcParenR: `${romanLc})`,
      romanLcPeriod: `${romanLc}.`,
      romanUcParenR: `${romanUc})`,
      romanUcPeriod: `${romanUc}.`,
    } satisfies Record<string, string>
  )[type] ?? "";
}

function wordNumberingMarkerForDefinition(
  autoNumberType: string,
  definition: WordNumberingLevel | undefined,
  value: number,
): string {
  if (autoNumberType) return wordNumberingMarker(autoNumberType, value);
  if (!definition) return "";

  const format = definition.numberFormat;
  const levelText = definition.levelText;
  if (format === "bullet") return levelText || "•";

  const markerValue = wordNumberingMarker(wordNumberingFormatAutoType(format), value);
  if (!markerValue) return "";
  if (!levelText.includes("%")) return markerValue;
  return levelText.replace(/%\d+/g, markerValue.replace(/[.)]$/u, ""));
}

function wordNumberingFormatAutoType(format: string): string {
  return (
    {
      decimal: "arabicPeriod",
      lowerLetter: "alphaLcPeriod",
      lowerRoman: "romanLcPeriod",
      upperLetter: "alphaUcPeriod",
      upperRoman: "romanUcPeriod",
    } satisfies Record<string, string>
  )[format] ?? "";
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

function wordIsFullBleedElement(element: RecordValue, pageLayout: WordPageLayout): boolean {
  if (pageLayout.widthPx <= 0) return false;
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const xPx = emuToPx(box?.xEmu);
  return rawWidth >= pageLayout.widthPx - 2 && Math.abs(xPx) <= 2;
}

function wordElementY(element: RecordValue): number {
  return emuToPx(asRecord(element.bbox)?.yEmu);
}

export function wordTableRowStyle(row: RecordValue): CSSProperties {
  const height = emuToPx(row.heightEmu ?? row.height);
  return {
    height: height > 0 ? Math.max(12, Math.min(240, height)) : undefined,
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
    backgroundColor: background,
    backgroundImage: wordTableDiagonalBorders(cell.lines),
    color,
    ...wordTableCellBorders(cell.lines),
    paddingBottom: tableCellPaddingPx(cell.marginBottom, 3),
    paddingLeft: tableCellPaddingPx(cell.marginLeft, 5),
    paddingRight: tableCellPaddingPx(cell.marginRight, 5),
    paddingTop: tableCellPaddingPx(cell.marginTop, 3),
    verticalAlign: wordVerticalAlign(cell.anchor),
  };
}

function wordTableDiagonalBorders(lines: unknown): CSSProperties["backgroundImage"] {
  const lineRecord = asRecord(lines);
  if (lineRecord == null) return undefined;

  const gradients = [
    wordTableDiagonalBorder(lineRecord.diagonalDown ?? lineRecord.topLeftToBottomRight, "to bottom right"),
    wordTableDiagonalBorder(lineRecord.diagonalUp ?? lineRecord.topRightToBottomLeft, "to top right"),
  ].filter(Boolean);
  return gradients.length > 0 ? gradients.join(", ") : undefined;
}

function wordTableDiagonalBorder(line: unknown, direction: "to bottom right" | "to top right"): string | undefined {
  const lineRecord = asRecord(line);
  if (lineRecord == null) return undefined;

  const border = lineToCss(lineRecord);
  const color = border.color ?? "#cbd5e1";
  const halfWidth = Math.max(0.5, Math.min(3, border.width / 2));
  return `linear-gradient(${direction}, transparent calc(50% - ${halfWidth}px), ${color} calc(50% - ${halfWidth}px), ${color} calc(50% + ${halfWidth}px), transparent calc(50% + ${halfWidth}px))`;
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

const wordDocumentStackStyle: CSSProperties = { display: "grid", gap: 20 };

function wordParagraphStyle(paragraph: ParagraphView): CSSProperties {
  const style = paragraphStyle(paragraph);
  const isTitle = paragraph.styleId === "Title";
  const isHeading = /^Heading/i.test(paragraph.styleId);
  const fontSize = wordCssFontSize(paragraph.style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14);
  const hasText = paragraph.runs.some((run) => run.text.trim() !== "");

  return {
    ...style,
    ...(paragraph.styleId === "Heading2" && hasText ? wordHeading2RuleStyle : {}),
    fontSize,
    lineHeight: wordParagraphCssLineHeight(paragraph, fontSize),
  };
}

function wordParagraphCssLineHeight(paragraph: ParagraphView, fontSize: number): CSSProperties["lineHeight"] {
  const exactPoints = asNumber(paragraph.style?.lineSpacing);
  if (exactPoints > 0) return `${wordEstimatedLineHeight(paragraph.style, fontSize)}px`;

  const percent = asNumber(paragraph.style?.lineSpacingPercent);
  if (percent > 0) return Math.max(0.8, Math.min(3, percent / 100_000));

  return 1.35;
}

function wordTableParagraphStyle(paragraph: ParagraphView): CSSProperties {
  const style = wordParagraphStyle(paragraph);
  style.fontSize = Math.min(asNumber(style.fontSize, 10.5), 10.5);
  style.lineHeight = 1.15;
  style.marginBottom = 1;
  style.marginTop = 0;
  return style;
}

const wordHeading2RuleStyle: CSSProperties = {
  borderBottom: "1px solid #3c9faa",
  borderTop: "1px solid #3c9faa",
  marginBottom: 18,
  marginTop: 18,
  paddingBottom: 6,
  paddingTop: 6,
};

function wordParagraphMarkerStyle(marker: string): CSSProperties {
  const isBullet = /^[•●○▪■o]$/u.test(marker);
  return {
    color: isBullet ? "#4aa6b2" : undefined,
    display: "inline-block",
    fontSize: isBullet ? "1.08em" : undefined,
    fontWeight: isBullet ? 700 : undefined,
    minWidth: isBullet ? "1.9em" : "2.25em",
    paddingRight: "0.35em",
    textAlign: "right",
  };
}

const wordHeaderContentStyle: CSSProperties = {
  borderBottom: "1px solid #e2e8f0",
  color: "#475569",
  fontSize: 12,
  marginBottom: 12,
  paddingBottom: 8,
};

const wordFooterContentStyle: CSSProperties = {
  borderTop: "1px solid #e2e8f0",
  color: "#475569",
  fontSize: 12,
  marginTop: 12,
  paddingTop: 8,
};

const wordReferenceMarkerStyle: CSSProperties = { color: "#475569", fontSize: "0.72em", marginLeft: 2 };

const wordSupplementalNotesStyle: CSSProperties = {
  borderTop: "1px solid #cbd5e1",
  display: "grid",
  gap: 4,
  marginTop: 18,
  paddingTop: 10,
};

const wordSupplementalNoteStyle: CSSProperties = { color: "#334155", fontSize: 12 };

const wordSupplementalNoteMetaStyle: CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 600, marginBottom: 2 };

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
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

const documentFallbackBlockStyle: CSSProperties = {
  borderBottom: "1px solid #e2e8f0",
  color: "#0f172a",
  lineHeight: 1.6,
  margin: 0,
  paddingBottom: 10,
  whiteSpace: "pre-wrap",
};
