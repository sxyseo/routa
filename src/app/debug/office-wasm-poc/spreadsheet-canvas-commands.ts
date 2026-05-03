import { columnLabel } from "./office-preview-utils";
import {
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  spreadsheetColumnLeft,
  spreadsheetCellKey,
  type SpreadsheetLayout,
  spreadsheetRowTop,
} from "./spreadsheet-layout";
import {
  buildSpreadsheetRenderSnapshot,
  visibleCellIntersectsRange,
  type SpreadsheetRenderSnapshot,
} from "./spreadsheet-render-snapshot";
import type { SpreadsheetViewportScroll, SpreadsheetViewportSize } from "./spreadsheet-layout";

export type SpreadsheetCanvasCellCommand = {
  addressKey: string;
  color?: string;
  fill?: string;
  height: number;
  left: number;
  text?: string;
  top: number;
  width: number;
};

export type SpreadsheetCanvasHeaderCommand = {
  height: number;
  label: string;
  left: number;
  top: number;
  type: "column" | "row";
  width: number;
};

export type SpreadsheetCanvasCommands = {
  cells: SpreadsheetCanvasCellCommand[];
  headers: SpreadsheetCanvasHeaderCommand[];
  snapshot: SpreadsheetRenderSnapshot;
};

export type SpreadsheetCanvasCellPaint = {
  color?: string;
  fill?: string;
  text?: string;
};

export function buildSpreadsheetCanvasCommands({
  layout,
  scroll,
  viewportSize,
  cellPaints,
}: {
  cellPaints?: Map<string, SpreadsheetCanvasCellPaint>;
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  viewportSize: SpreadsheetViewportSize;
}): SpreadsheetCanvasCommands {
  const snapshot = buildSpreadsheetRenderSnapshot({ layout, scroll, viewportSize });
  const cells: SpreadsheetCanvasCellCommand[] = [];

  for (const rowOffset of snapshot.visibleRowOffsets) {
    const rowIndex = rowOffset + 1;
    const top = spreadsheetRowTop(layout, rowOffset);
    for (const columnIndex of snapshot.visibleColumnIndexes) {
      const addressKey = spreadsheetCellKey(rowIndex, columnIndex);
      if (layout.coveredCells.has(addressKey)) continue;
      if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, snapshot.visibleRange)) continue;
      const merge = layout.mergeByStart.get(addressKey);
      const left = spreadsheetColumnLeft(layout, columnIndex);
      const paint = cellPaints?.get(addressKey);
      cells.push({
        addressKey,
        color: paint?.color,
        fill: paint?.fill,
        height: spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top,
        left,
        text: paint?.text,
        top,
        width: spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left,
      });
    }
  }

  return {
    cells,
    headers: [
      ...snapshot.visibleColumnIndexes.map((columnIndex) => ({
        height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
        label: columnLabel(columnIndex),
        left: spreadsheetColumnLeft(layout, columnIndex),
        top: 0,
        type: "column" as const,
        width: layout.columnWidths[columnIndex] ?? 0,
      })),
      ...snapshot.visibleRowOffsets.map((rowOffset) => ({
        height: layout.rowHeights[rowOffset] ?? 0,
        label: String(rowOffset + 1),
        left: 0,
        top: spreadsheetRowTop(layout, rowOffset),
        type: "row" as const,
        width: SPREADSHEET_ROW_HEADER_WIDTH,
      })),
    ],
    snapshot,
  };
}
