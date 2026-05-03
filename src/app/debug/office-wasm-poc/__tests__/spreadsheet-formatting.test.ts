import { describe, expect, it } from "vitest";

import {
  spreadsheetCellStyle,
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

  it("suppresses fallback gridlines without hiding explicit borders", () => {
    const explicitBorderStyles = {
      borders: [
        {
          bottom: { color: { value: "FF00AA00" } },
          right: { color: { value: "FFFF0000" } },
        },
      ],
      cellXfs: [{ borderId: 0 }],
    };

    expect(spreadsheetCellStyle(null, null, undefined, undefined, null, false).borderBottomColor).toBe("transparent");
    expect(spreadsheetCellStyle(null, null, undefined, undefined, null, true).borderBottomColor).toBe("#e2e8f0");
    expect(spreadsheetCellStyle({ styleIndex: 0 }, explicitBorderStyles, undefined, undefined, 0, false)).toMatchObject({
      borderBottomColor: "#00AA00",
      borderRightColor: "#FF0000",
    });
  });

  it("maps Excel alignment flags into viewport cell styles", () => {
    const styles = {
      cellXfs: [
        {
          alignment: {
            horizontal: "centerContinuous",
            indent: 2,
            shrinkToFit: true,
            vertical: "bottom",
            wrapText: false,
          },
          fontId: 0,
        },
      ],
      fonts: [{ fontSize: 20 }],
    };

    expect(spreadsheetCellStyle({ styleIndex: 0 }, styles, undefined, undefined, 0)).toMatchObject({
      alignItems: "flex-end",
      fontSize: 17.6,
      justifyContent: "center",
      paddingLeft: 33,
      textAlign: "center",
      textOverflow: "ellipsis",
      verticalAlign: "bottom",
      whiteSpace: "nowrap",
    });
  });
});
