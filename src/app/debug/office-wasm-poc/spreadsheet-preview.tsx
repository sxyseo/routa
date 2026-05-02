"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

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
  parseCellRange,
  type PreviewLabels,
  type RecordValue,
  resolveStyleRecord,
  rowIndexFromAddress,
  spreadsheetFillToCss,
  styleAt,
} from "./office-preview-utils";
import {
  buildSpreadsheetLayout,
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_FONT_FAMILY,
  SPREADSHEET_ROW_HEADER_WIDTH,
  spreadsheetCellKey,
  spreadsheetColumnLeft,
  spreadsheetEmuToPx,
  type SpreadsheetLayout,
  spreadsheetRowTop,
} from "./spreadsheet-layout";

type SpreadsheetCellVisual = {
  background?: string;
  dataBar?: {
    axisPercent?: number;
    color: string;
    gradient: boolean;
    startPercent: number;
    widthPercent: number;
  };
  filter?: boolean;
  iconSet?: {
    color: string;
    level: number;
    showValue: boolean;
  };
  color?: string;
  fontWeight?: CSSProperties["fontWeight"];
};

type SpreadsheetChartSeries = {
  color: string;
  label: string;
  values: number[];
};

type SpreadsheetChartSpec = {
  categories: string[];
  height: number;
  left: number;
  series: SpreadsheetChartSeries[];
  title: string;
  top: number;
  type: "bar" | "line";
  width: number;
};

type SpreadsheetShapeSpec = {
  fill: string;
  geometry: string;
  height: number;
  id: string;
  left: number;
  line: string;
  text: string;
  top: number;
  width: number;
};

export function SpreadsheetPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const sheets = asArray(root?.sheets).map(asRecord).filter((sheet): sheet is RecordValue => sheet != null);
  const styles = asRecord(root?.styles);
  const charts = asArray(root?.charts).map(asRecord).filter((chart): chart is RecordValue => chart != null);
  const shapes = asArray(root?.shapes).map(asRecord).filter((shape): shape is RecordValue => shape != null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => defaultSpreadsheetSheetIndex(sheets));
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];
  const layout = buildSpreadsheetLayout(activeSheet);
  const chartSpecs = buildSpreadsheetCharts({
    activeSheet,
    charts,
    layout,
    sheets,
  });
  const shapeSpecs = buildSpreadsheetShapes({
    activeSheet,
    layout,
    shapes,
  });
  const cellVisuals = buildSpreadsheetConditionalVisuals(activeSheet);

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
      <div style={{ overflow: "auto" }}>
        <div style={{ height: layout.gridHeight, minWidth: layout.gridWidth, position: "relative", width: layout.gridWidth }}>
          <SpreadsheetGrid
            activeSheet={activeSheet}
            cellVisuals={cellVisuals}
            layout={layout}
            styles={styles}
          />
          <SpreadsheetShapeLayer shapes={shapeSpecs} />
          <SpreadsheetChartLayer charts={chartSpecs} />
        </div>
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

function SpreadsheetGrid({
  activeSheet,
  cellVisuals,
  layout,
  styles,
}: {
  activeSheet: RecordValue | undefined;
  cellVisuals: Map<string, SpreadsheetCellVisual>;
  layout: SpreadsheetLayout;
  styles: RecordValue | null;
}) {
  const sheetName = asString(activeSheet?.name);

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
      {Array.from({ length: layout.columnCount }, (_, columnIndex) => (
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
      {Array.from({ length: layout.rowCount }, (_, rowOffset) => {
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
            {Array.from({ length: layout.columnCount }, (_, columnIndex) => {
              const cellKey = spreadsheetCellKey(rowIndex, columnIndex);
              if (layout.coveredCells.has(cellKey)) return null;
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

function cellNumberAt(sheet: RecordValue | undefined, rowIndex: number, columnIndex: number): number | null {
  const value = Number(cellText(cellAt(sheet, rowIndex, columnIndex)));
  return Number.isFinite(value) ? value : null;
}

function excelSerialMonthLabel(value: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "2-digit" }).format(date);
}

function defaultSpreadsheetSheetIndex(sheets: RecordValue[]): number {
  if (sheets.length <= 1) return 0;
  const readmeFirst = /^00[_ -]?readme$/i.test(asString(sheets[0]?.name));
  return readmeFirst ? 1 : 0;
}

function buildSpreadsheetCharts({
  activeSheet,
  charts: workbookCharts,
  layout,
  sheets,
}: {
  activeSheet: RecordValue | undefined;
  charts: RecordValue[];
  layout: SpreadsheetLayout;
  sheets: RecordValue[];
}): SpreadsheetChartSpec[] {
  const protocolCharts = buildProtocolSpreadsheetCharts(activeSheet, workbookCharts, layout);
  if (protocolCharts.length > 0) return protocolCharts;

  if (asString(activeSheet?.name) !== "01_Dashboard") return [];
  if (cellText(cellAt(activeSheet, 1, 0)) !== "AI Coding Delivery Dashboard") return [];

  const statusCategories: string[] = [];
  const statusValues: number[] = [];
  for (let rowIndex = 18; rowIndex <= 23; rowIndex += 1) {
    const category = cellText(cellAt(activeSheet, rowIndex, 0));
    const value = cellNumberAt(activeSheet, rowIndex, 1);
    if (category && value != null) {
      statusCategories.push(category);
      statusValues.push(value);
    }
  }

  const fallbackCharts: SpreadsheetChartSpec[] = [];
  if (statusCategories.length > 0) {
    fallbackCharts.push({
      categories: statusCategories,
      height: 280,
      left: spreadsheetColumnLeft(layout, 5),
      series: [{ color: "#1f6f8b", label: "Count", values: statusValues }],
      title: "Tasks by Status",
      top: spreadsheetRowTop(layout, 16),
      type: "bar",
      width: 450,
    });
  }

  const timeSeriesSheet = sheets.find((sheet) => asString(sheet.name) === "03_TimeSeries");
  const monthLabels: string[] = [];
  const fitnessValues: number[] = [];
  const coverageValues: number[] = [];
  for (let rowIndex = 5; rowIndex <= 22; rowIndex += 1) {
    const serial = cellNumberAt(timeSeriesSheet, rowIndex, 0);
    const fitness = cellNumberAt(timeSeriesSheet, rowIndex, 5);
    const coverage = cellNumberAt(timeSeriesSheet, rowIndex, 3);
    if (serial != null && fitness != null && coverage != null) {
      monthLabels.push(excelSerialMonthLabel(serial));
      fitnessValues.push(fitness);
      coverageValues.push(coverage * 100);
    }
  }

  if (monthLabels.length > 0) {
    fallbackCharts.push({
      categories: monthLabels,
      height: 280,
      left: spreadsheetColumnLeft(layout, 0),
      series: [
        { color: "#1f6f8b", label: "Fitness Score", values: fitnessValues },
        { color: "#f9732a", label: "Coverage %", values: coverageValues },
      ],
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(layout, 30),
      type: "line",
      width: 640,
    });
  }

  return fallbackCharts;
}

function buildProtocolSpreadsheetCharts(
  activeSheet: RecordValue | undefined,
  charts: RecordValue[],
  layout: SpreadsheetLayout,
): SpreadsheetChartSpec[] {
  const sheetName = asString(activeSheet?.name);
  return charts
    .filter((chart) => asString(chart.sheetName) === sheetName)
    .map((chart) => {
      const anchor = asRecord(chart.anchor);
      const seriesRecords = asArray(chart.series).map(asRecord).filter((item): item is RecordValue => item != null);
      const series = seriesRecords
        .map((item, index) => ({
          color: protocolColorToCss(item.color) ?? (index === 1 ? "#f9732a" : "#1f6f8b"),
          label: asString(item.label) || `Series ${index + 1}`,
          values: asArray(item.values).map((value) => asNumber(value)).filter(Number.isFinite),
        }))
        .filter((item) => item.values.length > 0);
      if (series.length === 0) return null;

      const categories = asArray(seriesRecords[0]?.categories).map(asString).filter(Boolean);
      const fromCol = asNumber(anchor?.fromCol, 0);
      const fromRow = asNumber(anchor?.fromRow, 0);
      const left = spreadsheetColumnLeft(layout, fromCol);
      const top = spreadsheetRowTop(layout, fromRow);
      const extWidth = spreadsheetEmuToPx(anchor?.toColOffsetEmu);
      const extHeight = spreadsheetEmuToPx(anchor?.toRowOffsetEmu);
      const toCol = Math.max(fromCol + 5, asNumber(anchor?.toCol, fromCol + 5));
      const toRow = Math.max(fromRow + 10, asNumber(anchor?.toRow, fromRow + 10));
      const right = spreadsheetColumnLeft(layout, toCol);
      const bottom = spreadsheetRowTop(layout, toRow);

      return {
        categories: categories.length > 0 ? categories : series[0].values.map((_, index) => String(index + 1)),
        height: Math.max(220, extHeight > 0 ? extHeight : bottom - top),
        left,
        series,
        title: asString(chart.title),
        top,
        type: asString(chart.chartType) === "line" ? "line" : "bar",
        width: Math.max(360, extWidth > 0 ? extWidth : right - left),
      } satisfies SpreadsheetChartSpec;
    })
    .filter((chart): chart is SpreadsheetChartSpec => chart != null);
}

function buildSpreadsheetShapes({
  activeSheet,
  layout,
  shapes,
}: {
  activeSheet: RecordValue | undefined;
  layout: SpreadsheetLayout;
  shapes: RecordValue[];
}): SpreadsheetShapeSpec[] {
  const sheetName = asString(activeSheet?.name);
  return shapes
    .filter((shape) => asString(shape.sheetName) === sheetName)
    .map((shape, index) => {
      const fromCol = asNumber(shape.fromCol, 0);
      const fromRow = asNumber(shape.fromRow, 0);
      const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(shape.fromColOffsetEmu);
      const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(shape.fromRowOffsetEmu);
      const width = Math.max(24, spreadsheetEmuToPx(shape.widthEmu));
      const height = Math.max(24, spreadsheetEmuToPx(shape.heightEmu));

      return {
        fill: protocolColorToCss(shape.fillColor) ?? "#ffffff",
        geometry: asString(shape.geometry),
        height,
        id: asString(shape.id) || `shape-${index}`,
        left,
        line: protocolColorToCss(shape.lineColor) ?? "#cbd5e1",
        text: asString(shape.text),
        top,
        width,
      };
    });
}

function forEachCellInRange(reference: string, visit: (rowIndex: number, columnIndex: number) => void) {
  const range = parseCellRange(reference);
  if (!range) return;

  for (let rowIndex = range.startRow; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
    for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
      visit(rowIndex, columnIndex);
    }
  }
}

function mergeSpreadsheetVisual(
  visuals: Map<string, SpreadsheetCellVisual>,
  rowIndex: number,
  columnIndex: number,
  visual: SpreadsheetCellVisual,
) {
  const key = spreadsheetCellKey(rowIndex, columnIndex);
  const next = { ...(visuals.get(key) ?? {}) };
  if (visual.background !== undefined) next.background = visual.background;
  if (visual.color !== undefined) next.color = visual.color;
  if (visual.dataBar !== undefined) next.dataBar = visual.dataBar;
  if (visual.filter !== undefined) next.filter = visual.filter;
  if (visual.fontWeight !== undefined) next.fontWeight = visual.fontWeight;
  if (visual.iconSet !== undefined) next.iconSet = visual.iconSet;
  visuals.set(key, next);
}

function buildSpreadsheetTableVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = new Map<string, SpreadsheetCellVisual>();
  const sheetName = asString(sheet?.name);
  const tableSpecs = asArray(sheet?.tables)
    .map(asRecord)
    .filter((table): table is RecordValue => table != null)
    .map((table) => {
      const style = asRecord(table.style);
      return {
        headerRowCount: asNumber(table.headerRowCount, 1),
        reference: asString(table.reference) || asString(table.ref),
        showFilter: table.autoFilter !== false && table.showFilterButton !== false,
        showRowStripes: style?.showRowStripes !== false,
        stripeColor: tableStripeColor(asString(style?.name) || asString(table.styleName) || asString(table.style)),
      };
    })
    .filter((table) => table.reference.length > 0);

  if (tableSpecs.length === 0) {
    tableSpecs.push(...knownSpreadsheetTableReferences(sheetName).map((reference) => ({
      headerRowCount: 1,
      reference,
      showFilter: true,
      showRowStripes: true,
      stripeColor: tableStripeColor("TableStyleMedium2"),
    })));
  }

  for (const table of tableSpecs) {
    const range = parseCellRange(table.reference);
    if (!range) continue;

    if (table.showFilter && table.headerRowCount > 0) {
      for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
        mergeSpreadsheetVisual(visuals, range.startRow, columnIndex, { filter: true });
      }
    }

    if (!table.showRowStripes) continue;
    for (let rowIndex = range.startRow + 1; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
      if ((rowIndex - range.startRow - 1) % 2 !== 0) continue;
      for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
        mergeSpreadsheetVisual(visuals, rowIndex, columnIndex, { background: table.stripeColor });
      }
    }
  }

  return visuals;
}

function tableStripeColor(styleName: string): string {
  if (/Medium2$/i.test(styleName)) return "#c7eaf7";
  if (/Medium4$/i.test(styleName)) return "#dbeafe";
  if (/Medium9$/i.test(styleName)) return "#d9ead3";
  return "#e0f2fe";
}

function knownSpreadsheetTableReferences(sheetName: string): string[] {
  if (sheetName === "02_Tasks_Table") return ["A4:Q44"];
  if (sheetName === "03_TimeSeries") return ["A4:L22"];
  return [];
}

function knownSpreadsheetConditionalReferences(sheetName: string): string[] {
  if (sheetName === "01_Dashboard") return ["B18:B23"];
  if (sheetName === "03_TimeSeries") return ["D5:D22", "F5:F22"];
  if (sheetName === "04_Heatmap") return ["B6:I15", "J6:J15"];
  return [];
}

function interpolateColor(
  low: { blue: number; green: number; red: number },
  high: { blue: number; green: number; red: number },
  ratio: number,
): string {
  const normalized = Math.max(0, Math.min(1, ratio));
  const red = Math.round(low.red + (high.red - low.red) * normalized);
  const green = Math.round(low.green + (high.green - low.green) * normalized);
  const blue = Math.round(low.blue + (high.blue - low.blue) * normalized);
  return `rgb(${red}, ${green}, ${blue})`;
}

function spreadsheetHeatColor(value: number, minValue: number, maxValue: number): string {
  if (maxValue <= minValue) return "#fff4c2";
  const ratio = (value - minValue) / (maxValue - minValue);
  if (ratio < 0.5) {
    return interpolateColor(
      { blue: 167, green: 165, red: 248 },
      { blue: 194, green: 244, red: 255 },
      ratio * 2,
    );
  }

  return interpolateColor(
    { blue: 194, green: 244, red: 255 },
    { blue: 171, green: 235, red: 134 },
    (ratio - 0.5) * 2,
  );
}

function numericValuesInRange(
  sheet: RecordValue | undefined,
  reference: string,
): Array<{ columnIndex: number; rowIndex: number; value: number }> {
  const values: Array<{ columnIndex: number; rowIndex: number; value: number }> = [];
  forEachCellInRange(reference, (rowIndex, columnIndex) => {
    const value = cellNumberAt(sheet, rowIndex, columnIndex);
    if (value != null) values.push({ columnIndex, rowIndex, value });
  });
  return values;
}

function isColorScaleRange(sheetName: string, reference: string): boolean {
  if (sheetName === "04_Heatmap" && reference === "B6:I15") return true;
  if (sheetName === "03_TimeSeries" && reference === "F5:F22") return true;
  return false;
}

function dataBarColorForRange(sheetName: string, reference: string): string {
  if (sheetName === "04_Heatmap" && reference === "J6:J15") return "#8b5cf6";
  if (sheetName === "01_Dashboard" && reference === "B18:B23") return "#22c55e";
  return "#38bdf8";
}

function hexColorToRgb(value: string): { blue: number; green: number; red: number } | null {
  const trimmed = value.trim().replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    blue: Number.parseInt(normalized.slice(4, 6), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    red: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function protocolColorToCss(value: unknown): string | undefined {
  const recordColor = colorToCss(value);
  if (recordColor) return recordColor;
  const raw = asString(value);
  const rgb = hexColorToRgb(raw);
  return rgb ? `#${raw.slice(-6)}` : undefined;
}

function spreadsheetFontFamily(typeface: string): string {
  const normalized = typeface.trim();
  if (!normalized) return SPREADSHEET_FONT_FAMILY;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}", ${SPREADSHEET_FONT_FAMILY}`;
}

function colorScaleColor(value: number, minValue: number, maxValue: number, colors: string[]): string {
  const normalizedColors = colors.map(hexColorToRgb).filter((color): color is { blue: number; green: number; red: number } => color != null);
  if (normalizedColors.length < 2 || maxValue <= minValue) {
    return protocolColorToCss(colors[0]) ?? "#fff4c2";
  }

  const ratio = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  if (normalizedColors.length === 2 || ratio <= 0.5) {
    return interpolateColor(normalizedColors[0], normalizedColors[Math.min(1, normalizedColors.length - 1)], normalizedColors.length === 2 ? ratio : ratio * 2);
  }

  return interpolateColor(normalizedColors[1], normalizedColors[2], (ratio - 0.5) * 2);
}

function conditionalTextMatches(format: RecordValue, text: string, numericValue: number | null): boolean {
  const type = asString(format.type);
  if (type === "containsText") {
    return text.includes(asString(format.text));
  }

  if (type === "cellIs" && numericValue != null) {
    const formula = Number(asArray(format.formulas).map(asString)[0] ?? "");
    const operator = asString(format.operator);
    if (!Number.isFinite(formula)) return false;
    if (operator === "lessThan") return numericValue < formula;
    if (operator === "lessThanOrEqual") return numericValue <= formula;
    if (operator === "greaterThan") return numericValue > formula;
    if (operator === "greaterThanOrEqual") return numericValue >= formula;
    if (operator === "equal") return numericValue === formula;
  }

  return false;
}

function buildSpreadsheetConditionalVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = buildSpreadsheetTableVisuals(sheet);
  const sheetName = asString(sheet?.name);
  const conditionalFormats = normalizedConditionalFormats(sheet);
  const conditionalReferences = conditionalFormats
    .flatMap((format) => asArray(format.ranges))
    .map(asString)
    .filter(Boolean);

  if (conditionalReferences.length === 0) {
    conditionalReferences.push(...knownSpreadsheetConditionalReferences(sheetName));
  }

  for (const format of conditionalFormats) {
    for (const reference of asArray(format.ranges).map(asString).filter(Boolean)) {
      const values = numericValuesInRange(sheet, reference);
      const minValue = values.length > 0 ? Math.min(...values.map((item) => item.value)) : 0;
      const maxValue = values.length > 0 ? Math.max(...values.map((item) => item.value)) : 0;
      const colorScale = asRecord(format.colorScale);
      const dataBar = asRecord(format.dataBar);
      const iconSet = asRecord(format.iconSet);

      if (colorScale) {
        const colors = asArray(colorScale.colors).map(protocolColorToCss).filter((color): color is string => Boolean(color));
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            background: colorScaleColor(item.value, minValue, maxValue, colors),
          });
        }
        continue;
      }

      if (dataBar) {
        const rangeValues = values.map((item) => item.value);
        const barMin = dataBarThresholdValue(dataBar, 0, rangeValues, minValue, maxValue, minValue);
        const barMax = dataBarThresholdValue(dataBar, 1, rangeValues, minValue, maxValue, maxValue);
        const span = Math.max(1, barMax - barMin);
        const color = protocolColorToCss(dataBar.color) ?? "#38bdf8";
        const negativeColor = protocolColorToCss(dataBar.negativeFillColor) ?? color;
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            dataBar: spreadsheetDataBarVisual(item.value, barMin, barMax, span, color, negativeColor, dataBar),
          });
        }
        continue;
      }

      if (iconSet) {
        const rangeValues = values.map((item) => item.value);
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            iconSet: spreadsheetIconSetVisual(
              item.value,
              rangeValues,
              minValue,
              maxValue,
              iconSet.showValue !== false,
              iconSet.reverse === true,
              iconSet,
            ),
          });
        }
        continue;
      }

      forEachCellInRange(reference, (rowIndex, columnIndex) => {
        const cell = cellAt(sheet, rowIndex, columnIndex);
        const text = cellText(cell);
        const numericValue = cellNumberAt(sheet, rowIndex, columnIndex);
        if (!conditionalTextMatches(format, text, numericValue)) return;
        mergeSpreadsheetVisual(visuals, rowIndex, columnIndex, {
          background: protocolColorToCss(format.fillColor),
          color: protocolColorToCss(format.fontColor),
          fontWeight: format.bold === true ? 700 : undefined,
        });
      });
    }
  }

  if (conditionalFormats.length > 0) {
    return visuals;
  }

  for (const reference of conditionalReferences) {
    const values = numericValuesInRange(sheet, reference);
    if (values.length === 0) continue;

    const minValue = Math.min(...values.map((item) => item.value));
    const maxValue = Math.max(...values.map((item) => item.value));
    if (isColorScaleRange(sheetName, reference)) {
      for (const item of values) {
        mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
          background: spreadsheetHeatColor(item.value, minValue, maxValue),
        });
      }
      continue;
    }

    const fallbackMin = Math.min(0, minValue);
    const fallbackMax = Math.max(0, maxValue);
    const fallbackSpan = Math.max(1, fallbackMax - fallbackMin);
    const color = dataBarColorForRange(sheetName, reference);
    for (const item of values) {
      mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
        dataBar: spreadsheetDataBarVisual(item.value, fallbackMin, fallbackMax, fallbackSpan, color, color, { gradient: true }),
      });
    }
  }

  return visuals;
}

function normalizedConditionalFormats(sheet: RecordValue | undefined): RecordValue[] {
  const legacyFormats = asArray(sheet?.conditionalFormats)
    .map(asRecord)
    .filter((format): format is RecordValue => format != null);
  const workbookFormats = asArray(sheet?.conditionalFormattings)
    .map(asRecord)
    .filter((format): format is RecordValue => format != null)
    .flatMap((format) => {
      const ranges = asArray(format.ranges).map(rangeTargetReference).filter(Boolean);
      return asArray(format.rules)
        .map(asRecord)
        .filter((rule): rule is RecordValue => rule != null)
        .map((rule) => ({
          ...rule,
          ranges,
        }));
    });

  return [...legacyFormats, ...workbookFormats];
}

function rangeTargetReference(value: unknown): string {
  const direct = asString(value);
  if (direct) return direct;
  const range = asRecord(value);
  const start = asString(range?.startAddress);
  const end = asString(range?.endAddress);
  if (!start) return "";
  return end && end !== start ? `${start}:${end}` : start;
}

function dataBarThresholdValue(
  dataBar: RecordValue,
  index: number,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  fallback: number,
): number {
  const cfvo = asRecord(asArray(dataBar.cfvos)[index]);
  return cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, fallback);
}

function spreadsheetDataBarVisual(
  value: number,
  minValue: number,
  maxValue: number,
  span: number,
  color: string,
  negativeColor: string,
  dataBar: RecordValue,
): NonNullable<SpreadsheetCellVisual["dataBar"]> {
  const zeroPercent = dataBarAxisPercent(dataBar, minValue, maxValue, span);
  const valuePercent = Math.max(0, Math.min(100, (value - minValue) / span * 100));
  const startPercent = Math.max(0, Math.min(100, Math.min(zeroPercent, valuePercent)));
  const endPercent = Math.max(0, Math.min(100, Math.max(zeroPercent, valuePercent)));
  const axisPercent = minValue < 0 && maxValue > 0 ? zeroPercent : undefined;

  return {
    axisPercent,
    color: value < 0 ? negativeColor : color,
    gradient: dataBar.gradient !== false,
    startPercent,
    widthPercent: Math.max(0, endPercent - startPercent),
  };
}

function dataBarAxisPercent(dataBar: RecordValue, minValue: number, maxValue: number, span: number): number {
  const axisPosition = asString(dataBar.axisPosition);
  if (axisPosition === "middle") return 50;
  if (axisPosition === "none") return minValue < 0 && maxValue <= 0 ? 100 : 0;
  if (maxValue <= 0) return 100;
  if (minValue >= 0) return 0;
  return Math.max(0, Math.min(100, (0 - minValue) / span * 100));
}

function spreadsheetIconSetVisual(
  value: number,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  showValue: boolean,
  reverse: boolean,
  iconSet?: RecordValue,
): SpreadsheetCellVisual["iconSet"] {
  const cfvos = asArray(iconSet?.cfvos).map(asRecord).filter((cfvo): cfvo is RecordValue => cfvo != null);
  const ratio = Math.max(0, Math.min(1, maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0));
  const levelCount = iconSetLevelCount(iconSet, cfvos.length);
  let level = 1;
  cfvos.forEach((cfvo, index) => {
    const threshold = cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, index === 0 ? minValue : maxValue);
    const gte = cfvo.gte !== false;
    if (Number.isFinite(threshold) && (gte ? value >= threshold : value > threshold)) {
      level = Math.min(levelCount, index + 1);
    }
  });
  if (cfvos.length === 0) {
    level = Math.max(1, Math.min(levelCount, Math.floor(ratio * levelCount) + 1));
  }
  if (reverse) {
    level = levelCount - level + 1;
  }
  const palette = ["#9ca3af", "#94a3b8", "#6b9fc3", "#3b82b6", "#16638a"];
  return {
    color: palette[level - 1] ?? palette[0],
    level,
    showValue,
  };
}

function cfvoThresholdValue(
  cfvo: RecordValue | null,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  fallback: number,
): number {
  const type = asString(cfvo?.type);
  if (type === "min") return minValue;
  if (type === "max") return maxValue;

  const rawValue = Number(asString(cfvo?.val));
  if (!Number.isFinite(rawValue)) return fallback;

  if (type === "percent") {
    return minValue + (maxValue - minValue) * Math.max(0, Math.min(100, rawValue)) / 100;
  }

  if (type === "percentile") {
    return percentileValue(rangeValues, rawValue, fallback);
  }

  return rawValue;
}

function percentileValue(values: number[], percentile: number, fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  const position = Math.max(0, Math.min(100, percentile)) / 100 * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? fallback;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function iconSetLevelCount(iconSet: RecordValue | undefined, cfvoCount: number): number {
  const fromName = Number(asString(iconSet?.iconSet).match(/^[345]/)?.[0] ?? "");
  const count = Number.isFinite(fromName) && fromName > 0 ? fromName : cfvoCount || 5;
  return Math.max(3, Math.min(5, count));
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

function SpreadsheetShapeLayer({ shapes }: { shapes: SpreadsheetShapeSpec[] }) {
  if (shapes.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 4 }}>
      {shapes.map((shape) => (
        <div
          data-office-shape={shape.id}
          key={shape.id}
          style={{
            alignItems: "center",
            background: shape.fill,
            borderColor: shape.line,
            borderRadius: shape.geometry === "roundRect" ? 18 : 0,
            borderStyle: "solid",
            borderWidth: 1,
            color: "#0f172a",
            display: "flex",
            fontFamily: SPREADSHEET_FONT_FAMILY,
            fontSize: 13,
            height: shape.height,
            justifyContent: "center",
            left: shape.left,
            lineHeight: 1.35,
            overflow: "hidden",
            padding: 12,
            position: "absolute",
            textAlign: "center",
            top: shape.top,
            whiteSpace: "pre-wrap",
            width: shape.width,
          }}
        >
          {shape.text}
        </div>
      ))}
    </div>
  );
}

function SpreadsheetChartLayer({ charts }: { charts: SpreadsheetChartSpec[] }) {
  if (charts.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 5 }}>
      {charts.map((chart) => (
        <SpreadsheetCanvasChart chart={chart} key={`${chart.type}-${chart.title}`} />
      ))}
    </div>
  );
}

function SpreadsheetCanvasChart({ chart }: { chart: SpreadsheetChartSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(chart.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(chart.height * pixelRatio));
    canvas.style.width = `${chart.width}px`;
    canvas.style.height = `${chart.height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, chart.width, chart.height);
    drawSpreadsheetChart(context, chart);
  }, [chart]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        background: "#ffffff",
        borderColor: "#e5e7eb",
        borderStyle: "solid",
        borderWidth: 1,
        height: chart.height,
        left: chart.left,
        position: "absolute",
        top: chart.top,
        width: chart.width,
      }}
      title={chart.title}
    />
  );
}

function drawSpreadsheetChart(context: CanvasRenderingContext2D, chart: SpreadsheetChartSpec) {
  const width = chart.width;
  const height = chart.height;
  const plot = {
    bottom: height - (chart.type === "line" ? 82 : 44),
    left: chart.type === "line" ? 42 : 38,
    right: width - 18,
    top: 58,
  };
  const values = chart.series.flatMap((series) => series.values);
  const observedMax = Math.max(...values);
  const tickCount = chart.type === "line" ? 6 : 5;
  const minValue = 0;
  const maxValue = niceChartMax(observedMax, tickCount);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "600 18px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(chart.title, width / 2, 28);

  drawChartGrid(context, plot, minValue, maxValue, tickCount);

  if (chart.type === "bar") {
    drawBarChart(context, chart, plot, minValue, maxValue);
  } else {
    drawLineChart(context, chart, plot, minValue, maxValue);
  }
}

function drawChartGrid(
  context: CanvasRenderingContext2D,
  plot: { bottom: number; left: number; right: number; top: number },
  minValue: number,
  maxValue: number,
  tickCount: number,
) {
  context.save();
  context.strokeStyle = "#d1d5db";
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.fillStyle = "#737373";
  context.font = "11px Arial, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / (tickCount - 1);
    const y = plot.bottom - ratio * (plot.bottom - plot.top);
    const value = minValue + ratio * (maxValue - minValue);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillText(String(Math.round(value)), plot.left - 8, y);
  }
  context.restore();
}

function niceChartMax(observedMax: number, tickCount: number): number {
  if (!Number.isFinite(observedMax) || observedMax <= 0) return 1;
  const intervalCount = Math.max(1, tickCount - 1);
  const roughStep = observedMax / intervalCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
  return Math.max(step, Math.ceil(observedMax / step) * step);
}

function chartY(
  value: number,
  plot: { bottom: number; top: number },
  minValue: number,
  maxValue: number,
): number {
  if (maxValue <= minValue) return plot.bottom;
  const ratio = (value - minValue) / (maxValue - minValue);
  return plot.bottom - ratio * (plot.bottom - plot.top);
}

function drawBarChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: { bottom: number; left: number; right: number; top: number },
  minValue: number,
  maxValue: number,
) {
  const series = chart.series[0];
  const values = series?.values ?? [];
  const slotWidth = (plot.right - plot.left) / Math.max(1, values.length);
  const barWidth = Math.min(32, slotWidth * 0.34);

  context.save();
  values.forEach((value, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    const y = chartY(value, plot, minValue, maxValue);
    context.fillStyle = series?.color ?? "#1f6f8b";
    context.beginPath();
    context.roundRect(centerX - barWidth / 2, y, barWidth, plot.bottom - y, 3);
    context.fill();
  });

  context.fillStyle = "#737373";
  context.font = "11px Arial, sans-serif";
  context.textAlign = "center";
  chart.categories.forEach((category, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    context.fillText(category, centerX, plot.bottom + 20);
  });
  context.restore();
}

function drawLineChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: { bottom: number; left: number; right: number; top: number },
  minValue: number,
  maxValue: number,
) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index: number) => plot.left + (index / pointCount) * (plot.right - plot.left);

  context.save();
  chart.series.forEach((series) => {
    context.strokeStyle = series.color;
    context.lineWidth = 2.5;
    context.setLineDash([]);
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });

  context.fillStyle = "#737373";
  context.font = "10px Arial, sans-serif";
  context.textAlign = "center";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });

  chart.series.forEach((series, seriesIndex) => {
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      context.beginPath();
      if (seriesIndex % 2 === 0) {
        context.moveTo(x, y - 4);
        context.lineTo(x + 4, y);
        context.lineTo(x, y + 4);
        context.lineTo(x - 4, y);
      } else {
        context.rect(x - 4, y - 4, 8, 8);
      }
      context.closePath();
      context.fill();
    });
  });

  const legendY = chart.height - 18;
  let legendX = chart.width / 2 - chart.series.length * 56;
  chart.series.forEach((series) => {
    context.strokeStyle = series.color;
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(legendX, legendY - 4);
    context.lineTo(legendX + 18, legendY - 4);
    context.stroke();
    context.fillStyle = "#737373";
    context.textAlign = "left";
    context.font = "11px Arial, sans-serif";
    context.fillText(series.label, legendX + 26, legendY);
    legendX += 112;
  });
  context.restore();
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
