import {
  asArray,
  asNumber,
  asRecord,
  asString,
  type CellMerge,
  columnIndexFromAddress,
  parseCellRange,
  type RecordValue,
} from "./office-preview-utils";

export const SPREADSHEET_ROW_HEADER_WIDTH = 40;
export const SPREADSHEET_COLUMN_HEADER_HEIGHT = 20;
export const SPREADSHEET_DEFAULT_COLUMN_WIDTH = 88;
export const SPREADSHEET_DEFAULT_ROW_HEIGHT = 20;
export const SPREADSHEET_EMU_PER_PIXEL = 9525;
export const SPREADSHEET_FONT_FAMILY = "Arial, Helvetica, sans-serif";

const EXCEL_POINTS_TO_PX = 96 / 72;

export type SpreadsheetLayout = {
  columnCount: number;
  columnOffsets: number[];
  columnWidths: number[];
  coveredCells: Set<string>;
  gridHeight: number;
  gridWidth: number;
  maxColumn: number;
  mergeByStart: Map<string, CellMerge>;
  rowCount: number;
  rowHeights: number[];
  rowOffsets: number[];
  rows: RecordValue[];
  rowsByIndex: Map<number, Map<number, RecordValue>>;
};

export function buildSpreadsheetLayout(sheet: RecordValue | undefined): SpreadsheetLayout {
  const rows = asArray(sheet?.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  let maxColumn = 0;
  const rowRecordsByIndex = new Map<number, RecordValue>();
  const rowsByIndex = new Map<number, Map<number, RecordValue>>();

  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = new Map<number, RecordValue>();
    rowRecordsByIndex.set(rowIndex, row);
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      const address = asString(cellRecord?.address);
      const columnIndex = columnIndexFromAddress(address);
      maxColumn = Math.max(maxColumn, columnIndex);
      if (cellRecord) cells.set(columnIndex, cellRecord);
    }
    rowsByIndex.set(rowIndex, cells);
  }

  const columnWidthByIndex = new Map<number, number>();
  const columns = asArray(sheet?.columns).map(asRecord).filter((column): column is RecordValue => column != null);
  for (const column of columns) {
    const min = Math.max(1, asNumber(column.min, asNumber(column.index, 1)));
    const max = Math.max(min, asNumber(column.max, min));
    const width = asNumber(column.width, asNumber(sheet?.defaultColWidth, 10));
    for (let index = min - 1; index <= max - 1; index += 1) {
      columnWidthByIndex.set(index, excelColumnWidthPx(width));
      maxColumn = Math.max(maxColumn, index);
    }
  }

  if (columns.length === 0) {
    for (const [index, width] of knownSpreadsheetColumnWidths(asString(sheet?.name))) {
      columnWidthByIndex.set(index, width);
      maxColumn = Math.max(maxColumn, index);
    }
  }

  const mergeByStart = new Map<string, CellMerge>();
  const coveredCells = new Set<string>();
  for (const mergeRecord of asArray(sheet?.mergedCells)) {
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
    mergeByStart.set(spreadsheetCellKey(merge.startRow, merge.startColumn), merge);
    maxColumn = Math.max(maxColumn, merge.startColumn + merge.columnSpan - 1);
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) {
      for (let column = merge.startColumn; column < merge.startColumn + merge.columnSpan; column += 1) {
        if (row === merge.startRow && column === merge.startColumn) continue;
        coveredCells.add(spreadsheetCellKey(row, column));
      }
    }
  }

  const rowCount = Math.min(Math.max(...rowsByIndex.keys(), 1), 80);
  const columnCount = Math.min(Math.max(maxColumn + 1, 6), 32);
  const columnWidths = Array.from(
    { length: columnCount },
    (_, index) => columnWidthByIndex.get(index) ?? SPREADSHEET_DEFAULT_COLUMN_WIDTH,
  );
  const rowHeights = Array.from({ length: rowCount }, (_, index) => {
    const row = rowRecordsByIndex.get(index + 1);
    return excelRowHeightPx(asNumber(row?.height));
  });
  const columnOffsets = prefixSums(SPREADSHEET_ROW_HEADER_WIDTH, columnWidths);
  const rowOffsets = prefixSums(SPREADSHEET_COLUMN_HEADER_HEIGHT, rowHeights);

  return {
    columnCount,
    columnOffsets,
    columnWidths,
    coveredCells,
    gridHeight: rowOffsets[rowOffsets.length - 1] ?? SPREADSHEET_COLUMN_HEADER_HEIGHT,
    gridWidth: columnOffsets[columnOffsets.length - 1] ?? SPREADSHEET_ROW_HEADER_WIDTH,
    maxColumn,
    mergeByStart,
    rowCount,
    rowHeights,
    rowOffsets,
    rows,
    rowsByIndex,
  };
}

export function spreadsheetCellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

export function spreadsheetColumnLeft(layout: SpreadsheetLayout, columnIndex: number): number {
  return layout.columnOffsets[columnIndex] ?? layout.gridWidth;
}

export function spreadsheetRowTop(layout: SpreadsheetLayout, zeroBasedRowIndex: number): number {
  return layout.rowOffsets[zeroBasedRowIndex] ?? layout.gridHeight;
}

export function spreadsheetEmuToPx(value: unknown): number {
  const numericValue = typeof value === "string" ? Number(value) : asNumber(value, 0);
  return Number.isFinite(numericValue) ? numericValue / SPREADSHEET_EMU_PER_PIXEL : 0;
}

function prefixSums(initial: number, sizes: number[]): number[] {
  const offsets = [initial];
  for (const size of sizes) {
    offsets.push((offsets[offsets.length - 1] ?? initial) + size);
  }
  return offsets;
}

function excelColumnWidthPx(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return SPREADSHEET_DEFAULT_COLUMN_WIDTH;
  return Math.max(32, Math.min(560, Math.floor(width * 7 + 5)));
}

function excelRowHeightPx(heightPoints: number): number {
  return heightPoints && heightPoints > 0
    ? Math.max(18, Math.round(heightPoints * EXCEL_POINTS_TO_PX))
    : SPREADSHEET_DEFAULT_ROW_HEIGHT;
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
