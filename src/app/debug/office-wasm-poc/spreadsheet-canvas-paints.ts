import {
  asArray,
  asNumber,
  asRecord,
  columnIndexFromAddress,
  type RecordValue,
} from "./office-preview-utils";
import type { SpreadsheetCanvasCellPaint } from "./spreadsheet-canvas-commands";
import {
  spreadsheetCellKey,
  type SpreadsheetLayout,
} from "./spreadsheet-layout";

type SpreadsheetCellEdits = Record<string, string | undefined>;

type SpreadsheetCanvasPaintProjector = {
  cellStyle: (
    cell: RecordValue,
    row: RecordValue | undefined,
    columnIndex: number,
    key: string,
  ) => {
    background?: unknown;
    color?: unknown;
  };
  cellText: (
    cell: RecordValue,
    row: RecordValue | undefined,
    columnIndex: number,
    key: string,
  ) => string;
};

export function buildSpreadsheetCanvasCellPaints({
  cellEdits,
  layout,
  project,
}: {
  cellEdits: SpreadsheetCellEdits;
  layout: SpreadsheetLayout;
  project: SpreadsheetCanvasPaintProjector;
}): Map<string, SpreadsheetCanvasCellPaint> {
  const paints = new Map<string, SpreadsheetCanvasCellPaint>();

  for (const row of layout.rows) {
    const rowIndex = asNumber(row.index, 1);
    const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
    for (const cellRecord of asArray(row.cells)) {
      const cell = asRecord(cellRecord);
      const address = asString(cell?.address);
      const columnIndex = columnIndexFromAddress(address);
      if (!cell || columnIndex < 0) continue;
      const key = spreadsheetCellKey(rowIndex, columnIndex);
      const cellStyle = project.cellStyle(cell, rowRecord, columnIndex, key);
      paints.set(key, {
        color: asString(cellStyle.color),
        fill: asString(cellStyle.background),
        text: cellEdits[key] ?? project.cellText(cell, rowRecord, columnIndex, key),
      });
    }
  }

  for (const [key, text] of Object.entries(cellEdits)) {
    if (text == null || paints.has(key)) continue;
    paints.set(key, { text });
  }

  return paints;
}
