import { describe, expect, it } from "vitest";

import {
  spreadsheetFrozenColumnHeaderRect,
  spreadsheetFrozenRowHeaderRect,
} from "../spreadsheet-frozen-headers";
import {
  buildSpreadsheetLayout,
  spreadsheetFrozenBodyHeight,
  spreadsheetFrozenBodyWidth,
  spreadsheetHitCellAtViewportPoint,
  spreadsheetVisibleCellRange,
  spreadsheetViewportPointToWorld,
  spreadsheetViewportRectSegments,
} from "../spreadsheet-layout";

describe("spreadsheet frozen headers", () => {
  it("projects column and row headers from prefix-sum layout into viewport space", () => {
    const layout = buildSpreadsheetLayout({
      columns: [
        { max: 1, min: 1, width: 10 },
        { max: 2, min: 2, width: 20 },
      ],
      rows: [
        { cells: [{ address: "A1" }], height: 30, index: 1 },
        { cells: [{ address: "B2" }], index: 2 },
      ],
    });

    expect(spreadsheetFrozenColumnHeaderRect(layout, 1, 25)).toEqual({
      height: 20,
      left: 50,
      width: 145,
    });
    expect(spreadsheetFrozenRowHeaderRect(layout, 1, 15)).toEqual({
      height: 20,
      top: 25,
      width: 40,
    });
  });

  it("projects frozen worksheet body regions using Walnut-like viewport math", () => {
    const layout = buildSpreadsheetLayout({
      columns: [
        { max: 1, min: 1, width: 10 },
        { max: 2, min: 2, width: 20 },
      ],
      freezePanes: { columnCount: 2, rowCount: 2 },
      rows: [
        { cells: [{ address: "A1" }], height: 30, index: 1 },
        { cells: [{ address: "B2" }], index: 2 },
        { cells: [{ address: "C3" }], index: 3 },
      ],
    });

    expect(layout.freezePanes).toEqual({ columnCount: 2, rowCount: 2 });
    expect(spreadsheetFrozenBodyWidth(layout)).toBe(220);
    expect(spreadsheetFrozenBodyHeight(layout)).toBe(60);

    expect(spreadsheetViewportPointToWorld(layout, { x: 120, y: 65 }, { left: 200, top: 100 })).toEqual({
      x: 120,
      y: 65,
    });
    expect(spreadsheetViewportPointToWorld(layout, { x: 300, y: 120 }, { left: 200, top: 100 })).toEqual({
      x: 500,
      y: 220,
    });

    expect(spreadsheetHitCellAtViewportPoint(layout, { x: 120, y: 65 }, { left: 200, top: 100 })).toEqual({
      columnIndex: 1,
      rowIndex: 2,
      rowOffset: 1,
    });
  });

  it("splits frozen row and column rectangles into viewport hit regions", () => {
    const layout = buildSpreadsheetLayout({
      columns: [
        { max: 1, min: 1, width: 10 },
        { max: 2, min: 2, width: 20 },
      ],
      freezePanes: { columnCount: 2, rowCount: 2 },
      rows: [
        { cells: [{ address: "A1" }], height: 30, index: 1 },
        { cells: [{ address: "B2" }], index: 2 },
        { cells: [{ address: "C3" }], index: 3 },
      ],
    });

    expect(spreadsheetViewportRectSegments(
      layout,
      { height: 100, left: 115, top: 80, width: 300 },
      { left: 80, top: 30 },
    )).toEqual([
      {
        height: 70,
        left: 115,
        top: 80,
        width: 145,
      },
    ]);
  });

  it("finds visible cells from prefix sums with overscan", () => {
    const layout = buildSpreadsheetLayout({
      columns: Array.from({ length: 12 }, (_, index) => ({ max: index + 1, min: index + 1, width: 10 })),
      rows: Array.from({ length: 20 }, (_, index) => ({
        cells: [{ address: `A${index + 1}` }],
        index: index + 1,
      })),
    });

    expect(spreadsheetVisibleCellRange(
      layout,
      { height: 75, width: 260 },
      { left: 270, top: 105 },
      1,
    )).toEqual({
      endColumnIndex: 7,
      endRowOffset: 9,
      startColumnIndex: 2,
      startRowOffset: 3,
    });
  });
});
