import { describe, expect, it } from "vitest";

import {
  spreadsheetCellText,
  spreadsheetNumberFormatCode,
} from "../spreadsheet-preview";

describe("spreadsheet cell formatting", () => {
  it("uses Excel built-in number formats when no custom number format is present", () => {
    const styles = {
      cellXfs: [
        { numFmtId: 14 },
        { numFmtId: 9 },
        { numFmtId: 4 },
        { numFmtId: 5 },
      ],
    };

    expect(spreadsheetNumberFormatCode(styles, 14)).toBe("m/d/yy");
    expect(spreadsheetCellText({ address: "A1", styleIndex: 0, value: 46023 }, styles)).toBe("Jan 01, 2026");
    expect(spreadsheetCellText({ address: "A2", styleIndex: 1, value: 0.42 }, styles)).toBe("42%");
    expect(spreadsheetCellText({ address: "A3", styleIndex: 2, value: 1234.5 }, styles)).toBe("1,234.50");
    expect(spreadsheetCellText({ address: "A4", styleIndex: 3, value: 1234.5 }, styles)).toBe("$1,235");
  });

  it("prefers custom number formats over built-in ids", () => {
    const styles = {
      cellXfs: [{ numFmtId: 165 }],
      numberFormats: [{ formatCode: "0.00%", id: 165 }],
    };

    expect(spreadsheetNumberFormatCode(styles, 165)).toBe("0.00%");
    expect(spreadsheetCellText({ address: "B1", styleIndex: 0, value: 0.125 }, styles)).toBe("12.50%");
  });
});
