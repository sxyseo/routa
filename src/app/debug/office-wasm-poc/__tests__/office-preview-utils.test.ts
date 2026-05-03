import { describe, expect, it } from "vitest";

import {
  cellText,
  columnIndexFromAddress,
  EXCEL_MAX_COLUMN_COUNT,
  EXCEL_MAX_ROW_COUNT,
  parseCellRange,
  rowIndexFromAddress,
} from "../office-preview-utils";

describe("office preview cell references", () => {
  it("parses absolute and sheet-qualified cell addresses", () => {
    expect(columnIndexFromAddress("'Sheet 1'!$AB$12")).toBe(27);
    expect(rowIndexFromAddress("'Sheet 1'!$AB$12")).toBe(12);
    expect(parseCellRange("'Sheet 1'!$A$1:$B$2")).toEqual({
      columnSpan: 2,
      rowSpan: 2,
      startColumn: 0,
      startRow: 1,
    });
  });

  it("expands full-column and full-row ranges to Excel worksheet bounds", () => {
    expect(parseCellRange("A:A")).toEqual({
      columnSpan: 1,
      rowSpan: EXCEL_MAX_ROW_COUNT,
      startColumn: 0,
      startRow: 1,
    });
    expect(parseCellRange("1:1")).toEqual({
      columnSpan: EXCEL_MAX_COLUMN_COUNT,
      rowSpan: 1,
      startColumn: 0,
      startRow: 1,
    });
    expect(parseCellRange("$B:$D")).toEqual({
      columnSpan: 3,
      rowSpan: EXCEL_MAX_ROW_COUNT,
      startColumn: 1,
      startRow: 1,
    });
    expect(parseCellRange("Sheet1!3:5")).toEqual({
      columnSpan: EXCEL_MAX_COLUMN_COUNT,
      rowSpan: 3,
      startColumn: 0,
      startRow: 3,
    });
  });
});

describe("office preview cell text", () => {
  it("uses friendly text for hyperlink formulas without cached values", () => {
    expect(cellText({
      formula: 'HYPERLINK("https://github.com/phodal/routa","Routa repo")',
    })).toBe("Routa repo");
    expect(cellText({
      formula: 'HYPERLINK("https://example.com/a,b","OpenXML ""SDK""")',
    })).toBe('OpenXML "SDK"');
  });

  it("keeps non-hyperlink formulas visible when no cached value exists", () => {
    expect(cellText({ formula: "SUM(A1:A3)" })).toBe("=SUM(A1:A3)");
  });
});
