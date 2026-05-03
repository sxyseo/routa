"use client";

import { type CSSProperties, type UIEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  columnIndexFromAddress,
  columnLabel,
  colorToCss,
  cssFontSize,
  type PreviewLabels,
  type RecordValue,
  resolveStyleRecord,
  rowIndexFromAddress,
  spreadsheetFillToCss,
  styleAt,
  useOfficeImageSources,
} from "./office-preview-utils";
import {
  buildSpreadsheetConditionalVisuals,
  type SpreadsheetCellVisual,
  type SpreadsheetCellVisualLookup,
} from "./spreadsheet-conditional-visuals";
import {
  buildSpreadsheetCommentVisuals,
  buildSpreadsheetSparklineVisuals,
  buildSpreadsheetValidationVisuals,
  SpreadsheetCellContent,
  type SpreadsheetSparklineVisual,
  type SpreadsheetValidationVisualLookup,
} from "./spreadsheet-cell-overlays";
import { buildSpreadsheetCharts, SpreadsheetChartLayer } from "./spreadsheet-charts";
import { SpreadsheetFrozenHeaders } from "./spreadsheet-frozen-headers";
import {
  buildSpreadsheetImages,
  buildSpreadsheetShapes,
  SpreadsheetImageLayer,
  SpreadsheetShapeLayer,
} from "./spreadsheet-shapes";
import {
  buildSpreadsheetLayout,
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_FONT_FAMILY,
  SPREADSHEET_ROW_HEADER_WIDTH,
  spreadsheetCellKey,
  spreadsheetColumnLeft,
  spreadsheetFrozenBodyHeight,
  spreadsheetFrozenBodyWidth,
  spreadsheetVisibleCellRange,
  spreadsheetViewportIntersectsRect,
  spreadsheetViewportRectSegments,
  type SpreadsheetLayout,
  spreadsheetRowTop,
  type SpreadsheetViewportScroll,
  type SpreadsheetViewportSize,
} from "./spreadsheet-layout";
import { useSpreadsheetViewportStore } from "./spreadsheet-viewport-store";

type SpreadsheetFloatingSpec = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const EXCEL_BUILT_IN_NUMBER_FORMATS = new Map<number, string>([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [5, "$#,##0;($#,##0)"],
  [6, "$#,##0;[Red]($#,##0)"],
  [7, "$#,##0.00;($#,##0.00)"],
  [8, "$#,##0.00;[Red]($#,##0.00)"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0;(#,##0)"],
  [38, "#,##0;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

export function SpreadsheetPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = useMemo(() => asRecord(proto), [proto]);
  const sheets = useMemo(
    () => asArray(root?.sheets).map(asRecord).filter((sheet): sheet is RecordValue => sheet != null),
    [root],
  );
  const styles = useMemo(() => asRecord(root?.styles), [root]);
  const charts = useMemo(
    () => asArray(root?.charts).map(asRecord).filter((chart): chart is RecordValue => chart != null),
    [root],
  );
  const shapes = useMemo(
    () => asArray(root?.shapes).map(asRecord).filter((shape): shape is RecordValue => shape != null),
    [root],
  );
  const slicerCaches = useMemo(
    () => asArray(root?.slicerCaches).map(asRecord).filter((cache): cache is RecordValue => cache != null),
    [root],
  );
  const definedNames = useMemo(() => root?.definedNames, [root]);
  const theme = useMemo(() => asRecord(root?.theme), [root]);
  const imageSources = useOfficeImageSources(root);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => defaultSpreadsheetSheetIndex(sheets));
  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: viewportState, store: viewportStore } = useSpreadsheetViewportStore();
  const viewportScroll = viewportState.scroll;
  const viewportSize = viewportState.size;
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];
  const layout = useMemo(() => buildSpreadsheetLayout(activeSheet), [activeSheet]);
  const chartSpecs = useMemo(() => buildSpreadsheetCharts({
    activeSheet,
    charts,
    layout,
    sheets,
  }), [activeSheet, charts, layout, sheets]);
  const shapeSpecs = useMemo(() => buildSpreadsheetShapes({
    activeSheet,
    layout,
    shapes,
    slicerCaches,
  }), [activeSheet, layout, shapes, slicerCaches]);
  const imageSpecs = useMemo(() => buildSpreadsheetImages({
    activeSheet,
    imageSources,
    layout,
  }), [activeSheet, imageSources, layout]);
  const visibleChartSpecs = useMemo(
    () => visibleFloatingSpecs(chartSpecs, viewportSize, viewportScroll),
    [chartSpecs, viewportScroll, viewportSize],
  );
  const visibleShapeSpecs = useMemo(
    () => visibleFloatingSpecs(shapeSpecs, viewportSize, viewportScroll),
    [shapeSpecs, viewportScroll, viewportSize],
  );
  const visibleImageSpecs = useMemo(
    () => visibleFloatingSpecs(imageSpecs, viewportSize, viewportScroll),
    [imageSpecs, viewportScroll, viewportSize],
  );
  const cellVisuals = useMemo(
    () => buildSpreadsheetConditionalVisuals(activeSheet, theme, definedNames),
    [activeSheet, definedNames, theme],
  );
  const sparklineVisuals = useMemo(() => buildSpreadsheetSparklineVisuals(activeSheet), [activeSheet]);
  const commentVisuals = useMemo(() => buildSpreadsheetCommentVisuals(root, activeSheet), [activeSheet, root]);
  const validationVisuals = useMemo(() => buildSpreadsheetValidationVisuals(activeSheet), [activeSheet]);

  useEffect(() => () => viewportStore.destroy(), [viewportStore]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    viewportStore.reset();
  }, [activeSheetIndex, viewportStore]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateViewportSize = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      viewportStore.schedule({
        scroll: { left: viewport.scrollLeft, top: viewport.scrollTop },
        size: { height, width },
      });
    };

    updateViewportSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => window.removeEventListener("resize", updateViewportSize);
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeSheetIndex, viewportStore]);

  const handleSheetSelect = (index: number) => {
    viewportStore.reset();
    setActiveSheetIndex(index);
  };

  const handleViewportScroll = (event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, clientWidth, scrollLeft, scrollTop } = event.currentTarget;
    viewportStore.schedule({
      scroll: { left: scrollLeft, top: scrollTop },
      size: { height: clientHeight, width: clientWidth },
    });
  };

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
        fontFamily: SPREADSHEET_FONT_FAMILY,
        gridTemplateRows: "auto auto minmax(0, 1fr) auto",
        maxHeight: "calc(100vh - 150px)",
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <SpreadsheetWorkbookBar title={asString(root?.sourceName) || asString(root?.title) || asString(activeSheet?.name)} />
      <SpreadsheetFormulaBar activeSheet={activeSheet} styles={styles} />
      <div style={{ minHeight: 0, overflow: "hidden", position: "relative" }}>
        <div
          onScroll={handleViewportScroll}
          ref={viewportRef}
          style={{ height: "100%", overflow: "auto" }}
        >
          <div style={{ height: layout.gridHeight, minWidth: layout.gridWidth, position: "relative", width: layout.gridWidth }}>
            <SpreadsheetGrid
              activeSheet={activeSheet}
              cellVisuals={cellVisuals}
              commentVisuals={commentVisuals}
              layout={layout}
              scroll={viewportScroll}
              sparklineVisuals={sparklineVisuals}
              styles={styles}
              validationVisuals={validationVisuals}
              viewportSize={viewportSize}
            />
            <SpreadsheetImageLayer images={visibleImageSpecs} />
            <SpreadsheetShapeLayer shapes={visibleShapeSpecs} />
            <SpreadsheetChartLayer charts={visibleChartSpecs} />
          </div>
        </div>
        <SpreadsheetFrozenBodyLayer
          activeSheet={activeSheet}
          cellVisuals={cellVisuals}
          commentVisuals={commentVisuals}
          layout={layout}
          scroll={viewportScroll}
          sparklineVisuals={sparklineVisuals}
          styles={styles}
          validationVisuals={validationVisuals}
          viewportSize={viewportSize}
        />
        <SpreadsheetFrozenHeaders
          layout={layout}
          scrollLeft={viewportScroll.left}
          scrollTop={viewportScroll.top}
          viewportSize={viewportSize}
        />
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
        {sheets.map((sheet, index) => {
          const tabColor = spreadsheetSheetTabColor(sheet);
          const active = index === activeSheetIndex;
          return (
            <button
              key={`${asString(sheet.sheetId)}-${index}`}
              onClick={() => handleSheetSelect(index)}
              style={{
                background: active ? "#ffffff" : "transparent",
                borderBottomColor: active ? (tabColor ?? "#111827") : "transparent",
                borderBottomStyle: "solid",
                borderBottomWidth: 3,
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderTopColor: !active && tabColor ? tabColor : "transparent",
                borderTopStyle: "solid",
                borderTopWidth: 3,
                color: active ? "#111827" : "#5f6368",
                cursor: "pointer",
                flex: "0 0 auto",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                minHeight: 44,
                padding: "0 16px",
              }}
              type="button"
            >
              {asString(sheet.name) || `${labels.sheet} ${index + 1}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SpreadsheetFrozenBodyLayer({
  activeSheet,
  cellVisuals,
  commentVisuals,
  layout,
  scroll,
  sparklineVisuals,
  styles,
  validationVisuals,
  viewportSize,
}: {
  activeSheet: RecordValue | undefined;
  cellVisuals: SpreadsheetCellVisualLookup;
  commentVisuals: Set<string>;
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  sparklineVisuals: Map<string, SpreadsheetSparklineVisual>;
  styles: RecordValue | null;
  validationVisuals: SpreadsheetValidationVisualLookup;
  viewportSize: SpreadsheetViewportSize;
}) {
  if (layout.freezePanes.columnCount === 0 && layout.freezePanes.rowCount === 0) {
    return null;
  }

  const sheetName = asString(activeSheet?.name);
  const frozenWidth = spreadsheetFrozenBodyWidth(layout);
  const frozenHeight = spreadsheetFrozenBodyHeight(layout);
  if (frozenWidth <= 0 && frozenHeight <= 0) return null;
  const showGridLines = spreadsheetShowGridLines(activeSheet);
  const visibleRange = spreadsheetVisibleCellRange(layout, viewportSize, scroll);
  const visibleMergeStarts = visibleMergedCellStarts(layout, visibleRange);
  const visibleColumnIndexes = sortedVisibleIndexes(
    visibleRange.startColumnIndex,
    visibleRange.endColumnIndex,
    visibleMergeStarts,
    "column",
  );
  const visibleRowOffsets = sortedVisibleIndexes(
    visibleRange.startRowOffset,
    visibleRange.endRowOffset,
    visibleMergeStarts,
    "row",
  );

  return (
    <div aria-hidden="true" style={{ inset: 0, overflow: "hidden", pointerEvents: "none", position: "absolute", zIndex: 11 }}>
      {visibleRowOffsets.map((rowOffset) => {
        const rowIndex = rowOffset + 1;
        const row = layout.rowsByIndex.get(rowIndex);
        const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
        const top = spreadsheetRowTop(layout, rowOffset);
        return visibleColumnIndexes.map((columnIndex) => {
          const cellKey = spreadsheetCellKey(rowIndex, columnIndex);
          if (layout.coveredCells.has(cellKey)) return null;
          if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) return null;
          const cell = row?.get(columnIndex) ?? null;
          const merge = layout.mergeByStart.get(cellKey);
          const left = spreadsheetColumnLeft(layout, columnIndex);
          const width = spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left;
          const cellHeight = spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top;
          const rects = spreadsheetViewportRectSegments(layout, { height: cellHeight, left, top, width }, scroll);
          if (rects.length === 0) return null;

          const visual = cellVisuals.get(cellKey);
          const hasComment = commentVisuals.has(cellKey);
          const sparkline = sparklineVisuals.get(cellKey);
          const validation = validationVisuals.get(cellKey);
          const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
          const text = spreadsheetCellText(cell, styles, sheetName, styleIndex);
          return rects.map((rect, segmentIndex) => (
            <div
              data-frozen-cell-address={asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`}
              key={`${rowIndex}:${columnIndex}:${segmentIndex}`}
              style={{
                ...spreadsheetCellStyle(cell, styles, visual, sheetName, styleIndex, showGridLines),
                height: rect.height,
                left: rect.left,
                overflow: "hidden",
                position: "absolute",
                top: rect.top,
                width: rect.width,
              }}
            >
              <SpreadsheetCellContent
                hasComment={hasComment}
                sparkline={sparkline}
                text={text}
                validation={validation}
                visual={visual}
              />
            </div>
          ));
        });
      })}
    </div>
  );
}

function SpreadsheetGrid({
  activeSheet,
  cellVisuals,
  commentVisuals,
  layout,
  scroll,
  sparklineVisuals,
  styles,
  validationVisuals,
  viewportSize,
}: {
  activeSheet: RecordValue | undefined;
  cellVisuals: SpreadsheetCellVisualLookup;
  commentVisuals: Set<string>;
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  sparklineVisuals: Map<string, SpreadsheetSparklineVisual>;
  styles: RecordValue | null;
  validationVisuals: SpreadsheetValidationVisualLookup;
  viewportSize: SpreadsheetViewportSize;
}) {
  const sheetName = asString(activeSheet?.name);
  const showGridLines = spreadsheetShowGridLines(activeSheet);
  const visibleRange = useMemo(
    () => spreadsheetVisibleCellRange(layout, viewportSize, scroll),
    [layout, scroll, viewportSize],
  );
  const visibleMergeStarts = useMemo(() => visibleMergedCellStarts(layout, visibleRange), [layout, visibleRange]);
  const visibleColumnIndexes = useMemo(() => {
    return sortedVisibleIndexes(visibleRange.startColumnIndex, visibleRange.endColumnIndex, visibleMergeStarts, "column");
  }, [visibleMergeStarts, visibleRange]);
  const visibleRowOffsets = useMemo(() => {
    return sortedVisibleIndexes(visibleRange.startRowOffset, visibleRange.endRowOffset, visibleMergeStarts, "row");
  }, [visibleMergeStarts, visibleRange]);

  return (
    <div
      role="grid"
      style={{
        fontFamily: SPREADSHEET_FONT_FAMILY,
        fontSize: 13,
        height: layout.gridHeight,
        position: "absolute",
        width: layout.gridWidth,
      }}
    >
      <div style={spreadsheetCornerStyle} />
      {visibleColumnIndexes.map((columnIndex) => (
        <div
          key={columnIndex}
          role="columnheader"
          style={{
            ...spreadsheetColumnHeaderStyle,
            left: spreadsheetColumnLeft(layout, columnIndex),
            width: layout.columnWidths[columnIndex],
          }}
        >
          {columnLabel(columnIndex)}
        </div>
      ))}
      {visibleRowOffsets.map((rowOffset) => {
        const rowIndex = rowOffset + 1;
        const row = layout.rowsByIndex.get(rowIndex);
        const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
        const top = spreadsheetRowTop(layout, rowOffset);
        const height = layout.rowHeights[rowOffset];
        return (
          <div key={rowIndex} role="row">
            <div
              role="rowheader"
              style={{
                ...spreadsheetRowHeaderStyle,
                height,
                top,
              }}
            >
              {rowIndex}
            </div>
            {visibleColumnIndexes.map((columnIndex) => {
              const cellKey = spreadsheetCellKey(rowIndex, columnIndex);
              if (layout.coveredCells.has(cellKey)) return null;
              if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) return null;
              const cell = row?.get(columnIndex) ?? null;
              const merge = layout.mergeByStart.get(cellKey);
              const left = spreadsheetColumnLeft(layout, columnIndex);
              const width = spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left;
              const cellHeight = spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top;
              const visual = cellVisuals.get(cellKey);
              const hasComment = commentVisuals.has(cellKey);
              const sparkline = sparklineVisuals.get(cellKey);
              const validation = validationVisuals.get(cellKey);
              const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
              const text = spreadsheetCellText(cell, styles, sheetName, styleIndex);
              return (
                <div
                  data-cell-address={asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`}
                  key={columnIndex}
                  role="gridcell"
                  style={{
                    ...spreadsheetCellStyle(cell, styles, visual, sheetName, styleIndex, showGridLines),
                    height: cellHeight,
                    left,
                    position: "absolute",
                    top,
                    width,
                  }}
                >
                  <SpreadsheetCellContent
                    hasComment={hasComment}
                    sparkline={sparkline}
                    text={text}
                    validation={validation}
                    visual={visual}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function rangeIndexes(start: number, end: number): Set<number> {
  const indexes = new Set<number>();
  for (let index = Math.max(0, start); index <= end; index += 1) {
    indexes.add(index);
  }
  return indexes;
}

function visibleMergedCellStarts(
  layout: SpreadsheetLayout,
  visibleRange: ReturnType<typeof spreadsheetVisibleCellRange>,
): Set<string> {
  const keys = new Set<string>();
  for (const [key, merge] of layout.mergeByStart) {
    const rowStart = merge.startRow - 1;
    const rowEnd = rowStart + merge.rowSpan - 1;
    const columnStart = merge.startColumn;
    const columnEnd = columnStart + merge.columnSpan - 1;
    if (
      rowStart <= visibleRange.endRowOffset &&
      rowEnd >= visibleRange.startRowOffset &&
      columnStart <= visibleRange.endColumnIndex &&
      columnEnd >= visibleRange.startColumnIndex
    ) {
      keys.add(key);
    }
  }

  return keys;
}

function sortedVisibleIndexes(
  start: number,
  end: number,
  mergeStarts: Set<string>,
  axis: "column" | "row",
): number[] {
  const indexes = rangeIndexes(start, end);
  for (const key of mergeStarts) {
    const [row, column] = key.split(":");
    indexes.add(axis === "column" ? Number(column ?? 0) : Math.max(0, Number(row ?? 1) - 1));
  }

  return [...indexes].sort((a, b) => a - b);
}

function visibleCellIntersectsRange(
  layout: SpreadsheetLayout,
  rowOffset: number,
  columnIndex: number,
  range: ReturnType<typeof spreadsheetVisibleCellRange>,
): boolean {
  const merge = layout.mergeByStart.get(spreadsheetCellKey(rowOffset + 1, columnIndex));
  const rowEnd = rowOffset + (merge?.rowSpan ?? 1) - 1;
  const columnEnd = columnIndex + (merge?.columnSpan ?? 1) - 1;
  return (
    rowOffset <= range.endRowOffset &&
    rowEnd >= range.startRowOffset &&
    columnIndex <= range.endColumnIndex &&
    columnEnd >= range.startColumnIndex
  );
}

function visibleFloatingSpecs<T extends SpreadsheetFloatingSpec>(
  specs: T[],
  viewportSize: SpreadsheetViewportSize,
  viewportScroll: SpreadsheetViewportScroll,
): T[] {
  return specs.filter((spec) => spreadsheetViewportIntersectsRect(spec, viewportSize, viewportScroll));
}

function SpreadsheetWorkbookBar({ title }: { title: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#ffffff",
        borderBottomColor: "#dadce0",
        borderBottomStyle: "solid",
        borderBottomWidth: 1,
        display: "flex",
        gap: 12,
        minHeight: 54,
        padding: "0 18px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          alignItems: "center",
          background: "#12b76a",
          borderRadius: 8,
          color: "#ffffff",
          display: "grid",
          flex: "0 0 auto",
          height: 32,
          justifyContent: "center",
          width: 32,
        }}
      >
        <span
          style={{
            backgroundImage: "linear-gradient(#ffffff 0 0), linear-gradient(#ffffff 0 0)",
            backgroundPosition: "center, center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "1px 18px, 18px 1px",
            borderColor: "#ffffff",
            borderRadius: 3,
            borderStyle: "solid",
            borderWidth: 1.5,
            height: 18,
            width: 18,
          }}
        />
      </div>
      <div
        style={{
          color: "#202124",
          fontSize: 17,
          fontWeight: 600,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
    </div>
  );
}

function SpreadsheetFormulaBar({
  activeSheet,
  styles,
}: {
  activeSheet: RecordValue | undefined;
  styles: RecordValue | null;
}) {
  const activeCell = cellAt(activeSheet, 1, 0);
  const sheetName = asString(activeSheet?.name);
  const value = spreadsheetCellText(activeCell, styles, sheetName);

  return (
    <div
      style={{
        alignItems: "center",
        background: "#f8f9fa",
        borderBottomColor: "#dadce0",
        borderBottomStyle: "solid",
        borderBottomWidth: 1,
        display: "grid",
        gap: 8,
        gridTemplateColumns: "72px minmax(160px, 1fr)",
        minHeight: 42,
        padding: "6px 12px",
      }}
    >
      <div
        style={{
          color: "#5f6368",
          fontSize: 13,
          paddingLeft: 2,
        }}
      >
        A1
      </div>
      <div
        style={{
          background: "#ffffff",
          borderColor: "#dadce0",
          borderRadius: 4,
          borderStyle: "solid",
          borderWidth: 1,
          color: "#5f6368",
          fontSize: 13,
          minHeight: 28,
          overflow: "hidden",
          padding: "5px 9px",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function spreadsheetCellStyle(
  cell: RecordValue | null,
  styles: RecordValue | null,
  visual?: SpreadsheetCellVisual,
  sheetName?: string,
  styleIndex?: number | null,
  showGridLines = true,
): CSSProperties {
  const cellFormat = styleAt(styles?.cellXfs, styleIndex ?? cell?.styleIndex);
  const font = styleAt(styles?.fonts, cellFormat?.fontId);
  const fill = styleAt(styles?.fills, cellFormat?.fillId);
  const border = styleAt(styles?.borders, cellFormat?.borderId);
  const alignment = asRecord(cellFormat?.alignment);
  const fontFill = resolveStyleRecord(font, ["fill", "color"]);
  const fillColor = spreadsheetFillToCss(fill);
  const fontColor = colorToCss(fontFill?.color ?? fontFill);
  const gridLineColor = showGridLines ? "#e2e8f0" : "transparent";
  const bottomBorder = spreadsheetBorderCss(border, "bottom", gridLineColor);
  const rightBorder = spreadsheetBorderCss(border, "right", gridLineColor);
  const fallbackStyle = knownSpreadsheetCellStyle(cell, sheetName);
  const horizontalAlignment = asString(alignment?.horizontal) || asString(cellFormat?.horizontalAlignment);
  const verticalAlignment = asString(alignment?.vertical) || asString(cellFormat?.verticalAlignment);
  const wrapText = spreadsheetBool(alignment?.wrapText ?? cellFormat?.wrapText, true);
  const shrinkToFit = spreadsheetBool(alignment?.shrinkToFit ?? cellFormat?.shrinkToFit, false);
  const indent = Math.max(0, asNumber(alignment?.indent ?? cellFormat?.indent, 0));
  const fontSize = font != null ? cssFontSize(font.fontSize, 13) : fallbackStyle.fontSize;

  return {
    ...sheetCellStyle,
    ...fallbackStyle,
    alignItems: spreadsheetVerticalAlignItems(verticalAlignment),
    background: visual?.background ?? fillColor ?? fallbackStyle.background,
    borderBottomColor: bottomBorder.color,
    borderBottomStyle: bottomBorder.style,
    borderBottomWidth: bottomBorder.width,
    borderRightColor: rightBorder.color,
    borderRightStyle: rightBorder.style,
    borderRightWidth: rightBorder.width,
    color: visual?.color ?? fontColor ?? fallbackStyle.color ?? sheetCellStyle.color,
    display: "flex",
    fontFamily: spreadsheetFontFamily(asString(font?.typeface)),
    fontSize: shrinkToFit && typeof fontSize === "number" ? Math.max(8, fontSize * 0.88) : fontSize,
    fontStyle: font?.italic === true ? "italic" : fallbackStyle.fontStyle,
    fontWeight: visual?.fontWeight ?? (font?.bold === true ? 700 : fallbackStyle.fontWeight),
    justifyContent: spreadsheetHorizontalJustifyContent(horizontalAlignment),
    paddingLeft: indent > 0 ? 9 + indent * 12 : sheetCellStyle.paddingLeft,
    textAlign: spreadsheetHorizontalTextAlign(horizontalAlignment, fallbackStyle.textAlign),
    textOverflow: wrapText ? undefined : "ellipsis",
    verticalAlign: spreadsheetVerticalAlign(verticalAlignment) ?? fallbackStyle.verticalAlign ?? sheetCellStyle.verticalAlign,
    whiteSpace: wrapText ? sheetCellStyle.whiteSpace : "nowrap",
  };
}

function spreadsheetBorderCss(
  border: RecordValue | null,
  side: "bottom" | "right",
  gridLineColor: string,
): {
  color: CSSProperties["borderBottomColor"];
  style: CSSProperties["borderBottomStyle"];
  width: CSSProperties["borderBottomWidth"];
} {
  const line = spreadsheetBorderLine(border, side);
  const rawStyle = asString(line?.style ?? border?.[`${side}Style`] ?? border?.[`${side}_style`]).toLowerCase();
  if (rawStyle === "none") return { color: "transparent", style: "solid", width: 1 };

  const explicitColor =
    spreadsheetBorderColor(line?.color) ??
    spreadsheetBorderColor(border?.[`${side}Color`]) ??
    spreadsheetBorderColor(border?.[`${side}_color`]) ??
    spreadsheetBorderColor(border?.[`${side}BorderColor`]) ??
    spreadsheetBorderColor(border?.[`${side}_border_color`]);

  return {
    color: explicitColor ?? gridLineColor,
    style: spreadsheetBorderStyle(rawStyle),
    width: spreadsheetBorderWidth(rawStyle),
  };
}

function spreadsheetBorderColor(value: unknown): string | null {
  const structured = colorToCss(asRecord(value));
  if (structured) return structured;
  const text = asString(value);
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`;
  if (/^[0-9a-f]{8}$/i.test(text)) return `#${text.slice(2)}`;
  return null;
}

function spreadsheetBorderLine(border: RecordValue | null, side: "bottom" | "right"): RecordValue | null {
  return (
    asRecord(border?.[side]) ??
    asRecord(border?.[`${side}Border`]) ??
    asRecord(border?.[`${side}_border`])
  );
}

function spreadsheetBorderStyle(value: string): CSSProperties["borderBottomStyle"] {
  if (value.includes("dash")) return "dashed";
  if (value.includes("dot")) return "dotted";
  if (value === "double") return "double";
  return "solid";
}

function spreadsheetBorderWidth(value: string): number {
  if (value.includes("thick")) return 3;
  if (value.includes("medium") || value === "double") return 2;
  return 1;
}

function spreadsheetShowGridLines(sheet: RecordValue | undefined): boolean {
  if (sheet?.showGridLines === false) return false;
  const value = asString(sheet?.showGridLines).toLowerCase();
  return value !== "false" && value !== "0";
}

function spreadsheetBool(value: unknown, fallback: boolean): boolean {
  if (value === true || value === false) return value;
  const normalized = asString(value).toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function spreadsheetHorizontalTextAlign(
  value: string,
  fallback: CSSProperties["textAlign"],
): CSSProperties["textAlign"] {
  const normalized = value.toLowerCase();
  if (normalized === "center" || normalized === "centercontinuous" || normalized === "distributed") return "center";
  if (normalized === "right") return "right";
  if (normalized === "justify") return "justify";
  if (normalized === "left" || normalized === "fill") return "left";
  return fallback;
}

function spreadsheetHorizontalJustifyContent(value: string): CSSProperties["justifyContent"] {
  const normalized = value.toLowerCase();
  if (normalized === "center" || normalized === "centercontinuous" || normalized === "distributed") return "center";
  if (normalized === "right") return "flex-end";
  return "flex-start";
}

function spreadsheetVerticalAlign(value: string): CSSProperties["verticalAlign"] | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "center") return "middle";
  if (normalized === "bottom") return "bottom";
  if (normalized === "top") return "top";
  return undefined;
}

function spreadsheetVerticalAlignItems(value: string): CSSProperties["alignItems"] {
  const normalized = value.toLowerCase();
  if (normalized === "center") return "center";
  if (normalized === "bottom") return "flex-end";
  return "flex-start";
}

function spreadsheetEffectiveStyleIndex(
  cell: RecordValue | null,
  row: RecordValue | undefined,
  layout: SpreadsheetLayout,
  columnIndex: number,
): number | null {
  return spreadsheetStyleIndex(cell?.styleIndex) ??
    spreadsheetStyleIndex(row?.styleIndex) ??
    layout.columnStyleIndexes[columnIndex] ??
    null;
}

function spreadsheetStyleIndex(value: unknown): number | null {
  if (value == null) return null;
  const index = asNumber(value, -1);
  return index >= 0 ? index : null;
}

function knownSpreadsheetCellStyle(cell: RecordValue | null, sheetName?: string): CSSProperties {
  const address = asString(cell?.address);
  if (!cell || !address) return {};
  const rowIndex = rowIndexFromAddress(address);
  const columnIndex = columnIndexFromAddress(address);
  const text = cellText(cell);

  if (rowIndex === 1) {
    return {
      background: "#ecfdf5",
      color: "#14532d",
      fontSize: 18,
      fontWeight: 700,
      verticalAlign: "middle",
    };
  }

  if (rowIndex === 2) {
    return {
      color: "#64748b",
      fontStyle: "italic",
    };
  }

  if (sheetName === "01_Dashboard") {
    if (rowIndex === 4) return { background: "#e6f7ee", color: "#14633a", fontWeight: 700 };
    if (rowIndex === 17) return { background: "#dcfce7", color: "#166534", fontWeight: 700, textAlign: "center" };
    if ([6, 11].includes(rowIndex)) return { background: "#f8fafc", color: "#64748b", fontWeight: 700 };
    if (rowIndex === 11 && columnIndex >= 6) return { background: "#fff7ed", color: "#9a3412" };
  }

  if (sheetName === "03_TimeSeries") {
    if (rowIndex === 4) return { background: "#dff1fb", color: "#036796", fontWeight: 700, textAlign: "center" };
    if (rowIndex >= 5 && rowIndex <= 22) {
      if (columnIndex === 10 && text === "Warn") return { background: "#fff4c2", color: "#a3470d" };
      if (columnIndex === 10 && text === "Pass") return { color: "#0f172a" };
      return rowIndex % 2 === 1 ? { background: "#c7eaf7" } : {};
    }
  }

  if (sheetName === "04_Heatmap") {
    if (rowIndex === 4 || rowIndex === 5) {
      return { background: "#e9e4ff", color: "#5b21b6", fontWeight: 700, textAlign: "center" };
    }
  }

  return {};
}

function excelSerialMonthYearLabel(value: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "numeric" }).format(date);
}

function excelSerialDateLabel(value: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", timeZone: "UTC", year: "numeric" }).format(date);
}

function shouldFormatAsMonthSerial(cell: RecordValue | null, sheetName?: string): boolean {
  if (sheetName !== "03_TimeSeries") return false;
  const address = asString(cell?.address);
  return columnIndexFromAddress(address) === 0 && rowIndexFromAddress(address) >= 5;
}

export function spreadsheetCellText(
  cell: RecordValue | null,
  styles: RecordValue | null,
  sheetName?: string,
  styleIndex?: number | null,
): string {
  const text = cellText(cell);
  const address = asString(cell?.address);
  const rowIndex = rowIndexFromAddress(address);

  if (cell != null && cell.hasValue === false && !asString(cell.formula)) return "";
  const numberValue = Number(text);
  if (sheetName && rowIndex === 3 && Number.isFinite(numberValue)) return "";
  if (cell == null || !Number.isFinite(numberValue)) return text;

  const columnIndex = columnIndexFromAddress(address);
  const cellFormat = styleAt(styles?.cellXfs, styleIndex ?? cell.styleIndex);
  const numberFormatId = asNumber(cellFormat?.numFmtId, -1);
  const formatCode = spreadsheetNumberFormatCode(styles, numberFormatId);

  if (isExcelMonthYearFormat(formatCode)) return excelSerialMonthYearLabel(numberValue);
  if (isExcelTimeFormat(formatCode)) return excelSerialTimeLabel(numberValue, formatCode);
  if (isExcelDateFormat(formatCode)) return excelSerialDateLabel(numberValue);
  if (shouldFormatAsMonthSerial(cell, sheetName)) return excelSerialMonthYearLabel(numberValue);

  if (sheetName === "03_TimeSeries") {
    if (columnIndex === 3) return `${Math.round(numberValue * 100)}%`;
    if ([7, 8, 9].includes(columnIndex)) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
    if ([4, 5].includes(columnIndex)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }

  if (sheetName === "01_Dashboard") {
    if (columnIndex === 2) return `${Math.round(numberValue * 100)}%`;
    if (columnIndex === 3) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
  }

  if (formatCode.includes("%")) return `${(numberValue * 100).toFixed(spreadsheetDecimalPlaces(formatCode))}%`;
  if (/e\+?0+/i.test(formatCode)) return spreadsheetScientificLabel(numberValue, formatCode);
  if (formatCode.includes("?/?")) return spreadsheetFractionLabel(numberValue, formatCode);
  if (formatCode.includes("$")) return spreadsheetCurrencyLabel(numberValue, formatCode);
  if (formatCode.includes("#,##0.00")) return spreadsheetNumberLabel(numberValue, formatCode);
  if (formatCode.includes("#,##0")) return spreadsheetNumberLabel(numberValue, formatCode);
  if (/^0\.0+$/.test(formatCode)) return numberValue.toFixed(formatCode.split(".")[1]?.length ?? 0);
  if (/\d+\.\d{4,}/.test(text)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return text;
}

export function spreadsheetNumberFormatCode(styles: RecordValue | null, numberFormatId: number): string {
  const numberFormat = asArray(styles?.numberFormats)
    .map(asRecord)
    .find((format) => asNumber(format?.id, -2) === numberFormatId);
  const customFormat = asString(numberFormat?.formatCode);
  return customFormat || EXCEL_BUILT_IN_NUMBER_FORMATS.get(numberFormatId) || "";
}

function isExcelMonthYearFormat(formatCode: string): boolean {
  const normalized = formatCode.toLowerCase();
  return normalized.includes("mmm") && normalized.includes("yy");
}

function isExcelDateFormat(formatCode: string): boolean {
  const normalized = formatCode.toLowerCase();
  if (!/[dmy]/.test(normalized)) return false;
  if (normalized.includes("%")) return false;
  return /(^|[^a-z])m{1,4}([^a-z]|$)/.test(normalized) ||
    /(^|[^a-z])d{1,4}([^a-z]|$)/.test(normalized) ||
    /(^|[^a-z])y{2,4}([^a-z]|$)/.test(normalized);
}

function isExcelTimeFormat(formatCode: string): boolean {
  const normalized = formatCode.toLowerCase();
  return /\[?h\]?:mm/.test(normalized) || /^mm:ss/.test(normalized);
}

function excelSerialTimeLabel(value: number, formatCode: string): string {
  const normalized = formatCode.toLowerCase();
  const totalSeconds = Math.max(0, Math.round(value * 86_400));
  const hoursTotal = Math.floor(totalSeconds / 3600);
  const hours = normalized.includes("[h]") ? hoursTotal : hoursTotal % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (normalized.includes("am/pm")) {
    const suffix = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    const withSeconds = normalized.includes(":ss");
    return `${hour12}:${String(minutes).padStart(2, "0")}${withSeconds ? `:${String(seconds).padStart(2, "0")}` : ""} ${suffix}`;
  }
  if (/^mm:ss/.test(normalized)) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (normalized.includes(":ss")) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function spreadsheetDecimalPlaces(formatCode: string): number {
  return formatCode.match(/\.([0#]+)/)?.[1]?.length ?? 0;
}

function spreadsheetScientificLabel(value: number, formatCode: string): string {
  const decimals = spreadsheetDecimalPlaces(formatCode);
  return value.toExponential(decimals).replace("e", "E").replace(/E\+?(-?\d+)$/, (_match, exponent: string) => {
    const numericExponent = Number(exponent);
    const sign = numericExponent < 0 ? "-" : "+";
    return `E${sign}${String(Math.abs(numericExponent)).padStart(2, "0")}`;
  });
}

function spreadsheetFractionLabel(value: number, formatCode: string): string {
  const denominatorLimit = formatCode.includes("??/??") ? 99 : 9;
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= denominatorLimit; denominator += 1) {
    const numerator = Math.round(fraction * denominator);
    const error = Math.abs(fraction - numerator / denominator);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }
  if (bestNumerator === 0) return `${sign}${whole}`;
  if (bestNumerator === bestDenominator) return `${sign}${whole + 1}`;
  return `${sign}${whole > 0 ? `${whole} ` : ""}${bestNumerator}/${bestDenominator}`;
}

function spreadsheetCurrencyLabel(value: number, formatCode: string): string {
  const section = spreadsheetNumberFormatSection(value, formatCode);
  const decimals = spreadsheetDecimalPlaces(section);
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
  if (value < 0 && section.includes("(")) return `($${formatted})`;
  return `${value < 0 ? "-" : ""}$${formatted}`;
}

function spreadsheetNumberLabel(value: number, formatCode: string): string {
  const section = spreadsheetNumberFormatSection(value, formatCode);
  const decimals = spreadsheetDecimalPlaces(section);
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
  if (value < 0 && section.includes("(")) return `(${formatted})`;
  return `${value < 0 ? "-" : ""}${formatted}`;
}

function spreadsheetNumberFormatSection(value: number, formatCode: string): string {
  const sections = formatCode.split(";").map((section) => section.replace(/\[[^\]]+\]/g, ""));
  if (value < 0 && sections[1]) return sections[1];
  if (value === 0 && sections[2]) return sections[2];
  return sections[0] ?? formatCode;
}

function rowsByIndexForSheet(sheet: RecordValue | undefined): Map<number, Map<number, RecordValue>> {
  const rowMap = new Map<number, Map<number, RecordValue>>();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = new Map<number, RecordValue>();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      const address = asString(cellRecord.address);
      cells.set(columnIndexFromAddress(address), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}

function cellAt(sheet: RecordValue | undefined, rowIndex: number, columnIndex: number): RecordValue | null {
  return rowsByIndexForSheet(sheet).get(rowIndex)?.get(columnIndex) ?? null;
}

function defaultSpreadsheetSheetIndex(sheets: RecordValue[]): number {
  if (sheets.length <= 1) return 0;
  const readmeFirst = /^00[_ -]?readme$/i.test(asString(sheets[0]?.name));
  return readmeFirst ? 1 : 0;
}

export function spreadsheetSheetTabColor(sheet: RecordValue | undefined): string | undefined {
  return colorToCss(asRecord(sheet?.tabColor) ?? sheet?.tabColor);
}

function spreadsheetFontFamily(typeface: string): string {
  const normalized = typeface.trim();
  if (!normalized) return SPREADSHEET_FONT_FAMILY;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}", ${SPREADSHEET_FONT_FAMILY}`;
}

const spreadsheetHeaderBaseStyle: CSSProperties = {
  alignItems: "center",
  background: "#f1f3f4",
  borderBottomColor: "#dadce0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#dadce0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#3c4043",
  display: "flex",
  fontFamily: SPREADSHEET_FONT_FAMILY,
  fontSize: 13,
  fontWeight: 500,
  justifyContent: "center",
  overflow: "hidden",
  padding: "0 4px",
  position: "absolute",
  zIndex: 2,
};

const spreadsheetCornerStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  left: 0,
  top: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 4,
};

const spreadsheetColumnHeaderStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  top: 0,
};

const spreadsheetRowHeaderStyle: CSSProperties = {
  ...spreadsheetHeaderBaseStyle,
  left: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 3,
};

const sheetCellStyle: CSSProperties = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#e2e8f0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#0f172a",
  fontFamily: SPREADSHEET_FONT_FAMILY,
  lineHeight: 1.35,
  overflow: "hidden",
  overflowWrap: "break-word",
  padding: "7px 9px",
  verticalAlign: "top" as const,
  whiteSpace: "pre-wrap" as const,
};
