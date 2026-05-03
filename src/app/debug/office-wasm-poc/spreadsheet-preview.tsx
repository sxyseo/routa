"use client";

import { type CSSProperties, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
} from "./spreadsheet-conditional-visuals";
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

type SpreadsheetViewportState = {
  scroll: SpreadsheetViewportScroll;
  size: SpreadsheetViewportSize;
};

type SpreadsheetFloatingSpec = {
  height: number;
  left: number;
  top: number;
  width: number;
};

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
  const theme = useMemo(() => asRecord(root?.theme), [root]);
  const imageSources = useOfficeImageSources(root);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => defaultSpreadsheetSheetIndex(sheets));
  const [viewportScroll, setViewportScroll] = useState({ left: 0, top: 0 });
  const [viewportSize, setViewportSize] = useState({ height: 0, width: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingViewportStateRef = useRef<SpreadsheetViewportState | null>(null);
  const viewportAnimationFrameRef = useRef<number | null>(null);
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
  }), [activeSheet, layout, shapes]);
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
  const cellVisuals = useMemo(() => buildSpreadsheetConditionalVisuals(activeSheet, theme), [activeSheet, theme]);

  const applyViewportState = useCallback((next: SpreadsheetViewportState) => {
    setViewportScroll((current) => {
      if (current.left === next.scroll.left && current.top === next.scroll.top) return current;
      return next.scroll;
    });
    setViewportSize((current) => (
      current.width === next.size.width && current.height === next.size.height
        ? current
        : next.size
    ));
  }, []);

  const flushViewportState = useCallback(() => {
    viewportAnimationFrameRef.current = null;
    const next = pendingViewportStateRef.current;
    pendingViewportStateRef.current = null;
    if (next) applyViewportState(next);
  }, [applyViewportState]);

  const scheduleViewportState = useCallback((next: SpreadsheetViewportState) => {
    pendingViewportStateRef.current = next;
    if (typeof window === "undefined") {
      flushViewportState();
      return;
    }

    if (viewportAnimationFrameRef.current == null) {
      viewportAnimationFrameRef.current = window.requestAnimationFrame(flushViewportState);
    }
  }, [flushViewportState]);

  const cancelPendingViewportState = useCallback(() => {
    pendingViewportStateRef.current = null;
    if (viewportAnimationFrameRef.current != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(viewportAnimationFrameRef.current);
      viewportAnimationFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingViewportState, [cancelPendingViewportState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }, [activeSheetIndex]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateViewportSize = () => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      setViewportSize((current) => current.width === width && current.height === height ? current : { height, width });
    };

    updateViewportSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => window.removeEventListener("resize", updateViewportSize);
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeSheetIndex]);

  const handleSheetSelect = (index: number) => {
    cancelPendingViewportState();
    setViewportScroll({ left: 0, top: 0 });
    setActiveSheetIndex(index);
  };

  const handleViewportScroll = (event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, clientWidth, scrollLeft, scrollTop } = event.currentTarget;
    scheduleViewportState({
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
              layout={layout}
              scroll={viewportScroll}
              styles={styles}
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
          layout={layout}
          scroll={viewportScroll}
          styles={styles}
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
        {sheets.map((sheet, index) => (
          <button
            key={`${asString(sheet.sheetId)}-${index}`}
            onClick={() => handleSheetSelect(index)}
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

function SpreadsheetFrozenBodyLayer({
  activeSheet,
  cellVisuals,
  layout,
  scroll,
  styles,
  viewportSize,
}: {
  activeSheet: RecordValue | undefined;
  cellVisuals: Map<string, SpreadsheetCellVisual>;
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  styles: RecordValue | null;
  viewportSize: SpreadsheetViewportSize;
}) {
  if (layout.freezePanes.columnCount === 0 && layout.freezePanes.rowCount === 0) {
    return null;
  }

  const sheetName = asString(activeSheet?.name);
  const frozenWidth = spreadsheetFrozenBodyWidth(layout);
  const frozenHeight = spreadsheetFrozenBodyHeight(layout);
  if (frozenWidth <= 0 && frozenHeight <= 0) return null;
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
          const text = spreadsheetCellText(cell, styles, sheetName);
          return rects.map((rect, segmentIndex) => (
            <div
              data-frozen-cell-address={asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`}
              key={`${rowIndex}:${columnIndex}:${segmentIndex}`}
              style={{
                ...spreadsheetCellStyle(cell, styles, visual, sheetName),
                height: rect.height,
                left: rect.left,
                overflow: "hidden",
                position: "absolute",
                top: rect.top,
                width: rect.width,
              }}
            >
              <SpreadsheetCellContent text={text} visual={visual} />
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
  layout,
  scroll,
  styles,
  viewportSize,
}: {
  activeSheet: RecordValue | undefined;
  cellVisuals: Map<string, SpreadsheetCellVisual>;
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  styles: RecordValue | null;
  viewportSize: SpreadsheetViewportSize;
}) {
  const sheetName = asString(activeSheet?.name);
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
              const text = spreadsheetCellText(cell, styles, sheetName);
              return (
                <div
                  data-cell-address={asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`}
                  key={columnIndex}
                  role="gridcell"
                  style={{
                    ...spreadsheetCellStyle(cell, styles, visual, sheetName),
                    height: cellHeight,
                    left,
                    position: "absolute",
                    top,
                    width,
                  }}
                >
                  <SpreadsheetCellContent text={text} visual={visual} />
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

function spreadsheetCellStyle(
  cell: RecordValue | null,
  styles: RecordValue | null,
  visual?: SpreadsheetCellVisual,
  sheetName?: string,
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
  const fallbackStyle = knownSpreadsheetCellStyle(cell, sheetName);

  return {
    ...sheetCellStyle,
    ...fallbackStyle,
    background: visual?.background ?? fillColor ?? fallbackStyle.background,
    borderBottomColor: borderColor,
    borderRightColor: borderColor,
    color: visual?.color ?? fontColor ?? fallbackStyle.color ?? sheetCellStyle.color,
    fontFamily: spreadsheetFontFamily(asString(font?.typeface)),
    fontSize: font != null ? cssFontSize(font.fontSize, 13) : fallbackStyle.fontSize,
    fontStyle: font?.italic === true ? "italic" : fallbackStyle.fontStyle,
    fontWeight: visual?.fontWeight ?? (font?.bold === true ? 700 : fallbackStyle.fontWeight),
    textAlign: (asString(alignment?.horizontal) || asString(cellFormat?.horizontalAlignment)) as CSSProperties["textAlign"] || fallbackStyle.textAlign,
    verticalAlign: asString(alignment?.vertical) as CSSProperties["verticalAlign"] || fallbackStyle.verticalAlign || sheetCellStyle.verticalAlign,
  };
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

function spreadsheetCellText(cell: RecordValue | null, styles: RecordValue | null, sheetName?: string): string {
  const text = cellText(cell);
  const address = asString(cell?.address);
  const rowIndex = rowIndexFromAddress(address);

  if (cell != null && cell.hasValue === false && !asString(cell.formula)) return "";
  const numberValue = Number(text);
  if (sheetName && rowIndex === 3 && Number.isFinite(numberValue)) return "";
  if (cell == null || !Number.isFinite(numberValue)) return text;

  const columnIndex = columnIndexFromAddress(address);
  const cellFormat = styleAt(styles?.cellXfs, cell.styleIndex);
  const numberFormatId = asNumber(cellFormat?.numFmtId, -1);
  const numberFormat = asArray(styles?.numberFormats)
    .map(asRecord)
    .find((format) => asNumber(format?.id, -2) === numberFormatId);
  const formatCode = asString(numberFormat?.formatCode);

  if (formatCode.includes("mmm") && formatCode.includes("yy")) return excelSerialMonthYearLabel(numberValue);
  if (formatCode.includes("yyyy") && formatCode.includes("dd")) return excelSerialDateLabel(numberValue);
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

  if (formatCode.includes("%")) return `${(numberValue * 100).toFixed(formatCode.includes(".0") ? 1 : 0)}%`;
  if (formatCode.includes("$")) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
  if (formatCode.includes("#,##0")) return Math.round(numberValue).toLocaleString("en-US");
  if (/\d+\.\d{4,}/.test(text)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return text;
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

function spreadsheetFontFamily(typeface: string): string {
  const normalized = typeface.trim();
  if (!normalized) return SPREADSHEET_FONT_FAMILY;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}", ${SPREADSHEET_FONT_FAMILY}`;
}

function SpreadsheetCellContent({
  text,
  visual,
}: {
  text: string;
  visual?: SpreadsheetCellVisual;
}) {
  return (
    <>
      {visual?.dataBar ? (
        <>
          <span
            aria-hidden="true"
            style={{
              background: visual.dataBar.gradient
                ? `linear-gradient(90deg, ${visual.dataBar.color} 0%, ${visual.dataBar.color} 72%, rgba(255,255,255,0) 100%)`
                : visual.dataBar.color,
              bottom: 1,
              left: `${visual.dataBar.startPercent}%`,
              opacity: 0.75,
              position: "absolute",
              top: 1,
              width: `${visual.dataBar.widthPercent}%`,
              zIndex: 0,
            }}
          />
          {visual.dataBar.axisPercent === undefined ? null : (
            <span
              aria-hidden="true"
              style={{
                background: "rgba(31, 41, 55, 0.45)",
                bottom: 1,
                left: `${visual.dataBar.axisPercent}%`,
                position: "absolute",
                top: 1,
                width: 1,
                zIndex: 1,
              }}
            />
          )}
        </>
      ) : null}
      {visual?.iconSet ? <SpreadsheetIconSet visual={visual.iconSet} /> : null}
      {visual?.iconSet?.showValue === false ? null : <span style={{ position: "relative", zIndex: 1 }}>{text}</span>}
      {visual?.filter ? (
        <span
          aria-hidden="true"
          style={{
            alignItems: "center",
            background: "#ffffff",
            borderColor: "#cbd5e1",
            borderRadius: 3,
            borderStyle: "solid",
            borderWidth: 1,
            color: "#64748b",
            display: "inline-flex",
            fontSize: 9,
            height: 14,
            justifyContent: "center",
            lineHeight: 1,
            marginLeft: 6,
            position: "relative",
            top: -1,
            verticalAlign: "middle",
            width: 14,
            zIndex: 1,
          }}
        >
          ▾
        </span>
      ) : null}
    </>
  );
}

function SpreadsheetIconSet({ visual }: { visual: NonNullable<SpreadsheetCellVisual["iconSet"]> }) {
  const glyph = spreadsheetIconSetGlyph(visual);
  if (glyph) {
    return (
      <span
        aria-hidden="true"
        style={{
          color: visual.color,
          display: "inline-block",
          fontSize: 15,
          fontWeight: 700,
          lineHeight: "14px",
          marginRight: visual.showValue ? 5 : 0,
          position: "relative",
          textAlign: "center",
          top: 1,
          width: 18,
          zIndex: 1,
        }}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "end",
        display: "inline-flex",
        gap: 1,
        height: 14,
        justifyContent: "center",
        marginRight: visual.showValue ? 5 : 0,
        position: "relative",
        top: 2,
        width: 18,
        zIndex: 1,
      }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          style={{
            background: index < visual.level ? visual.color : "#d1d5db",
            display: "inline-block",
            height: 3 + index * 2,
            opacity: index < visual.level ? 1 : 0.45,
            width: 2,
          }}
        />
      ))}
    </span>
  );
}

function spreadsheetIconSetGlyph(visual: NonNullable<SpreadsheetCellVisual["iconSet"]>): string {
  const iconSet = visual.iconSet.toLowerCase();
  const zeroBasedLevel = Math.max(0, Math.min(visual.levelCount - 1, visual.level - 1));
  if (iconSet.includes("rating") || iconSet.includes("quarter")) {
    return ["☆", "◔", "◑", "◕", "★"][zeroBasedLevel] ?? "★";
  }

  if (iconSet.includes("arrow")) {
    const arrows = visual.levelCount >= 5 ? ["▼", "↘", "→", "↗", "▲"] : ["▼", "→", "▲"];
    return arrows[Math.min(arrows.length - 1, zeroBasedLevel)] ?? "→";
  }

  if (iconSet.includes("traffic") || iconSet.includes("symbol") || iconSet.includes("sign")) {
    return "●";
  }

  return "";
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
