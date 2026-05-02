import { describe, expect, it } from "vitest";

import {
  spreadsheetFrozenColumnHeaderRect,
  spreadsheetFrozenRowHeaderRect,
} from "../spreadsheet-frozen-headers";
import { buildSpreadsheetLayout } from "../spreadsheet-layout";

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
});
