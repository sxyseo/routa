import {
  spreadsheetCellKey,
  spreadsheetColumnLeft,
  spreadsheetHitCellAtViewportPoint,
  spreadsheetRowTop,
  spreadsheetViewportRectSegments,
  type SpreadsheetLayout,
  type SpreadsheetViewportPoint,
  type SpreadsheetViewportRect,
  type SpreadsheetViewportScroll,
} from "./spreadsheet-layout";

export type SpreadsheetSelection = {
  columnIndex: number;
  rowIndex: number;
  rowOffset: number;
};

export function spreadsheetSelectionFromViewportPoint(
  layout: SpreadsheetLayout,
  point: SpreadsheetViewportPoint,
  scroll: SpreadsheetViewportScroll,
): SpreadsheetSelection | null {
  const hit = spreadsheetHitCellAtViewportPoint(layout, point, scroll);
  if (!hit) return null;

  return spreadsheetNormalizeSelection(layout, hit);
}

export function spreadsheetNormalizeSelection(
  layout: SpreadsheetLayout,
  selection: SpreadsheetSelection,
): SpreadsheetSelection {
  const mergeStart = spreadsheetMergeStartForCell(layout, selection.rowIndex, selection.columnIndex);
  return mergeStart ?? selection;
}

export function spreadsheetMergeStartForCell(
  layout: SpreadsheetLayout,
  rowIndex: number,
  columnIndex: number,
): SpreadsheetSelection | null {
  const ownKey = spreadsheetCellKey(rowIndex, columnIndex);
  if (layout.mergeByStart.has(ownKey)) {
    return {
      columnIndex,
      rowIndex,
      rowOffset: rowIndex - 1,
    };
  }

  if (!layout.coveredCells.has(ownKey)) return null;

  for (const merge of layout.mergeByStart.values()) {
    const rowEnd = merge.startRow + merge.rowSpan - 1;
    const columnEnd = merge.startColumn + merge.columnSpan - 1;
    if (
      rowIndex >= merge.startRow &&
      rowIndex <= rowEnd &&
      columnIndex >= merge.startColumn &&
      columnIndex <= columnEnd
    ) {
      return {
        columnIndex: merge.startColumn,
        rowIndex: merge.startRow,
        rowOffset: merge.startRow - 1,
      };
    }
  }

  return null;
}

export function spreadsheetSelectionWorldRect(
  layout: SpreadsheetLayout,
  selection: SpreadsheetSelection,
): SpreadsheetViewportRect {
  const key = spreadsheetCellKey(selection.rowIndex, selection.columnIndex);
  const merge = layout.mergeByStart.get(key);
  const left = spreadsheetColumnLeft(layout, selection.columnIndex);
  const top = spreadsheetRowTop(layout, selection.rowOffset);
  return {
    height: spreadsheetRowTop(layout, selection.rowOffset + (merge?.rowSpan ?? 1)) - top,
    left,
    top,
    width: spreadsheetColumnLeft(layout, selection.columnIndex + (merge?.columnSpan ?? 1)) - left,
  };
}

export function spreadsheetFrozenSelectionSegments(
  layout: SpreadsheetLayout,
  selection: SpreadsheetSelection,
  scroll: SpreadsheetViewportScroll,
): SpreadsheetViewportRect[] {
  return spreadsheetViewportRectSegments(layout, spreadsheetSelectionWorldRect(layout, selection), scroll);
}
