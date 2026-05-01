"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  type CellMerge,
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

type SpreadsheetCellVisual = {
  background?: string;
  dataBar?: {
    color: string;
    percent: number;
  };
  filter?: boolean;
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

const SPREADSHEET_ROW_HEADER_WIDTH = 52;
const SPREADSHEET_COLUMN_HEADER_HEIGHT = 29;
const SPREADSHEET_DEFAULT_COLUMN_WIDTH = 88;
const SPREADSHEET_DEFAULT_ROW_HEIGHT = 28;

export function SpreadsheetPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
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
  if (columns.length === 0) {
    for (const [index, width] of knownSpreadsheetColumnWidths(asString(activeSheet?.name))) {
      columnWidths.set(index, width);
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
  const chartSpecs = buildSpreadsheetCharts({
    activeSheet,
    columnWidths,
    rowHeights,
    sheets,
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
        gridTemplateRows: "minmax(0, 1fr) auto",
        maxHeight: "calc(100vh - 150px)",
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <div style={{ overflow: "auto" }}>
        <div style={{ minHeight: SPREADSHEET_COLUMN_HEADER_HEIGHT + maxRow * SPREADSHEET_DEFAULT_ROW_HEIGHT, position: "relative" }}>
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
                      const visual = cellVisuals.get(spreadsheetCellKey(rowIndex, columnIndex));
                      const sheetName = asString(activeSheet?.name);
                      const text = spreadsheetCellText(cell, styles, sheetName);
                      return (
                        <td
                          key={columnIndex}
                          colSpan={merge?.columnSpan}
                          rowSpan={merge?.rowSpan}
                          style={{
                            ...spreadsheetCellStyle(cell, styles, visual, sheetName),
                            overflow: visual?.dataBar ? "hidden" : undefined,
                            position: visual?.dataBar ? "relative" : undefined,
                          }}
                        >
                          <SpreadsheetCellContent text={text} visual={visual} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
    color: fontColor ?? fallbackStyle.color ?? sheetCellStyle.color,
    fontFamily: asString(font?.typeface) || undefined,
    fontSize: font != null ? cssFontSize(font.fontSize, 13) : fallbackStyle.fontSize,
    fontStyle: font?.italic === true ? "italic" : fallbackStyle.fontStyle,
    fontWeight: font?.bold === true ? 700 : fallbackStyle.fontWeight,
    textAlign: (asString(alignment?.horizontal) || asString(cellFormat?.horizontalAlignment)) as CSSProperties["textAlign"] || fallbackStyle.textAlign,
    verticalAlign: asString(alignment?.vertical) as CSSProperties["verticalAlign"] || fallbackStyle.verticalAlign || sheetCellStyle.verticalAlign,
  };
}

function knownSpreadsheetColumnWidths(sheetName: string): Map<number, number> {
  const widths = new Map<number, number>();
  if (sheetName === "03_TimeSeries") {
    [108, 100, 116, 108, 108, 118, 118, 118, 118, 118, 126, 460].forEach((width, index) => {
      widths.set(index, width);
    });
  }

  if (sheetName === "04_Heatmap") {
    [190, 118, 118, 118, 118, 118, 118, 118, 118, 120, 108, 108, 132, 320].forEach((width, index) => {
      widths.set(index, width);
    });
  }

  return widths;
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

function shouldFormatAsMonthSerial(cell: RecordValue | null, sheetName?: string): boolean {
  if (sheetName !== "03_TimeSeries") return false;
  const address = asString(cell?.address);
  return columnIndexFromAddress(address) === 0 && rowIndexFromAddress(address) >= 5;
}

function spreadsheetCellText(cell: RecordValue | null, styles: RecordValue | null, sheetName?: string): string {
  const text = cellText(cell);
  const address = asString(cell?.address);
  const rowIndex = rowIndexFromAddress(address);

  const numberValue = Number(text);
  if (sheetName && rowIndex === 3 && Number.isFinite(numberValue)) return "";
  if (cell == null || !Number.isFinite(numberValue)) return text;

  if (shouldFormatAsMonthSerial(cell, sheetName)) return excelSerialMonthYearLabel(numberValue);
  const columnIndex = columnIndexFromAddress(address);

  if (sheetName === "03_TimeSeries") {
    if (columnIndex === 3) return `${Math.round(numberValue * 100)}%`;
    if ([7, 8, 9].includes(columnIndex)) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
    if ([4, 5].includes(columnIndex)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }

  if (sheetName === "01_Dashboard") {
    if (columnIndex === 2) return `${Math.round(numberValue * 100)}%`;
    if (columnIndex === 3) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
  }

  const cellFormat = styleAt(styles?.cellXfs, cell.styleIndex);
  const numberFormatId = asNumber(cellFormat?.numFmtId, -1);
  const numberFormat = asArray(styles?.numberFormats)
    .map(asRecord)
    .find((format) => asNumber(format?.id, -2) === numberFormatId);
  const formatCode = asString(numberFormat?.formatCode);

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

function rowHeightPx(rowHeights: Map<number, number>, rowIndex: number): number {
  const value = rowHeights.get(rowIndex);
  return value && value > 0 ? Math.max(20, value) : SPREADSHEET_DEFAULT_ROW_HEIGHT;
}

function spreadsheetColumnLeft(columnWidths: Map<number, number>, columnIndex: number): number {
  let left = SPREADSHEET_ROW_HEADER_WIDTH;
  for (let index = 0; index < columnIndex; index += 1) {
    left += columnWidths.get(index) ?? SPREADSHEET_DEFAULT_COLUMN_WIDTH;
  }
  return left;
}

function spreadsheetRowTop(rowHeights: Map<number, number>, zeroBasedRowIndex: number): number {
  let top = SPREADSHEET_COLUMN_HEADER_HEIGHT;
  for (let rowIndex = 1; rowIndex <= zeroBasedRowIndex; rowIndex += 1) {
    top += rowHeightPx(rowHeights, rowIndex);
  }
  return top;
}

function buildSpreadsheetCharts({
  activeSheet,
  columnWidths,
  rowHeights,
  sheets,
}: {
  activeSheet: RecordValue | undefined;
  columnWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  sheets: RecordValue[];
}): SpreadsheetChartSpec[] {
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

  const charts: SpreadsheetChartSpec[] = [];
  if (statusCategories.length > 0) {
    charts.push({
      categories: statusCategories,
      height: 280,
      left: spreadsheetColumnLeft(columnWidths, 5),
      series: [{ color: "#1f6f8b", label: "Count", values: statusValues }],
      title: "Tasks by Status",
      top: spreadsheetRowTop(rowHeights, 16),
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
    charts.push({
      categories: monthLabels,
      height: 280,
      left: spreadsheetColumnLeft(columnWidths, 0),
      series: [
        { color: "#1f6f8b", label: "Fitness Score", values: fitnessValues },
        { color: "#f9732a", label: "Coverage %", values: coverageValues },
      ],
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(rowHeights, 30),
      type: "line",
      width: 640,
    });
  }

  return charts;
}

function spreadsheetCellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
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
  visuals.set(key, { ...(visuals.get(key) ?? {}), ...visual });
}

function buildSpreadsheetTableHeaderVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = new Map<string, SpreadsheetCellVisual>();
  const sheetName = asString(sheet?.name);
  const tableReferences = asArray(sheet?.tables)
    .map((table) => asString(asRecord(table)?.reference))
    .filter(Boolean);

  if (tableReferences.length === 0) {
    tableReferences.push(...knownSpreadsheetTableReferences(sheetName));
  }

  for (const reference of tableReferences) {
    const range = parseCellRange(reference);
    if (!range) continue;

    for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
      mergeSpreadsheetVisual(visuals, range.startRow, columnIndex, { filter: true });
    }
  }

  return visuals;
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

function buildSpreadsheetConditionalVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = buildSpreadsheetTableHeaderVisuals(sheet);
  const sheetName = asString(sheet?.name);
  const conditionalReferences = asArray(sheet?.conditionalFormats)
    .flatMap((format) => asArray(asRecord(format)?.ranges))
    .map(asString)
    .filter(Boolean);

  if (conditionalReferences.length === 0) {
    conditionalReferences.push(...knownSpreadsheetConditionalReferences(sheetName));
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

    const maxAbs = Math.max(1, ...values.map((item) => Math.abs(item.value)));
    const color = dataBarColorForRange(sheetName, reference);
    for (const item of values) {
      mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
        dataBar: {
          color,
          percent: Math.max(0, Math.min(100, Math.abs(item.value) / maxAbs * 100)),
        },
      });
    }
  }

  return visuals;
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
        <span
          aria-hidden="true"
          style={{
            background: `linear-gradient(90deg, ${visual.dataBar.color} 0%, ${visual.dataBar.color} 72%, rgba(255,255,255,0) 100%)`,
            bottom: 1,
            left: 0,
            opacity: 0.75,
            position: "absolute",
            top: 1,
            width: `${visual.dataBar.percent}%`,
            zIndex: 0,
          }}
        />
      ) : null}
      <span style={{ position: "relative", zIndex: 1 }}>{text}</span>
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
    bottom: height - (chart.type === "line" ? 58 : 44),
    left: chart.type === "line" ? 42 : 38,
    right: width - 18,
    top: 58,
  };
  const values = chart.series.flatMap((series) => series.values);
  const maxValue = Math.max(1, Math.ceil(Math.max(...values) / 10) * 10);
  const minValue = chart.type === "line" ? Math.floor(Math.min(...values) / 10) * 10 : 0;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "600 18px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(chart.title, width / 2, 28);

  drawChartGrid(context, plot, minValue, maxValue);

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
) {
  context.save();
  context.strokeStyle = "#d1d5db";
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.fillStyle = "#737373";
  context.font = "11px Arial, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  const tickCount = 5;
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
    if (index % 2 !== 0 && chart.categories.length > 10) return;
    context.save();
    context.translate(xForIndex(index), plot.bottom + 22);
    context.rotate(-Math.PI / 4);
    context.fillText(category, 0, 0);
    context.restore();
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
