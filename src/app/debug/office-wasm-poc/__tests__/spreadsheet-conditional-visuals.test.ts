import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSpreadsheetConditionalVisuals } from "../spreadsheet-conditional-visuals";

describe("spreadsheet conditional visuals", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses cfvo thresholds for color scale interpolation", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: [{ startAddress: "A1", endAddress: "A4" }],
          rules: [
            {
              colorScale: {
                cfvos: [
                  { type: "min" },
                  { type: "num", val: "50" },
                  { type: "max" },
                ],
                colors: ["FF0000", "FFFF00", "00FF00"],
              },
            },
          ],
        },
      ],
      name: "ColorScale",
      rows: [
        { cells: [{ address: "A1", value: "0" }], index: 1 },
        { cells: [{ address: "A2", value: "50" }], index: 2 },
        { cells: [{ address: "A3", value: "125" }], index: 3 },
        { cells: [{ address: "A4", value: "200" }], index: 4 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("rgb(255, 0, 0)");
    expect(visuals.get("2:0")?.background).toBe("rgb(255, 255, 0)");
    expect(visuals.get("3:0")?.background).toBe("rgb(128, 255, 0)");
    expect(visuals.get("4:0")?.background).toBe("rgb(0, 255, 0)");
  });

  it("applies table column stripes and edge-column emphasis", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      name: "Tables",
      rows: [],
      tables: [
        {
          headerRowCount: 1,
          reference: "A1:C4",
          style: {
            name: "TableStyleMedium4",
            showColumnStripes: true,
            showFirstColumn: true,
            showLastColumn: true,
            showRowStripes: false,
          },
          totalsRowCount: 1,
        },
      ],
    });

    expect(visuals.get("1:0")?.filter).toBe(true);
    expect(visuals.get("1:0")?.fontWeight).toBe(700);
    expect(visuals.get("1:0")?.background).toBe("#bfdbfe");
    expect(visuals.get("1:0")?.borderColor).toBe("#8ab4f8");
    expect(visuals.get("1:0")?.color).toBe("#1f2937");
    expect(visuals.get("2:0")?.background).toBe("#dbeafe");
    expect(visuals.get("2:0")?.fontWeight).toBe(700);
    expect(visuals.get("2:1")?.background).toBeUndefined();
    expect(visuals.get("2:2")?.fontWeight).toBe(700);
    expect(visuals.get("4:1")?.background).toBe("#bfdbfe");
    expect(visuals.get("4:1")?.fontWeight).toBe(700);
  });

  it("derives table stripe colors from workbook theme colors", () => {
    const visuals = buildSpreadsheetConditionalVisuals(
      {
        name: "Tables",
        rows: [],
        tables: [
          {
            headerRowCount: 1,
            reference: "A1:B4",
            style: {
              name: "TableStyleMedium2",
              showRowStripes: true,
            },
            totalsRowCount: 1,
          },
        ],
      },
      {
        colorScheme: {
          colors: [
            {
              color: { type: 1, value: "0F9ED5" },
              name: "accent4",
            },
          ],
        },
      },
    );

    expect(visuals.get("2:0")?.background).toBe("rgb(193, 230, 244)");
    expect(visuals.get("3:0")?.background).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("rgb(154, 214, 237)");
  });

  it("projects broader built-in medium table styles from theme accents", () => {
    const visuals = buildSpreadsheetConditionalVisuals(
      {
        name: "Tables",
        rows: [],
        tables: [
          {
            headerRowCount: 1,
            reference: "A1:B3",
            style: {
              name: "TableStyleMedium14",
              showRowStripes: true,
            },
          },
        ],
      },
      {
        colorScheme: {
          colors: [
            {
              color: { type: 1, value: "4472C4" },
              name: "accent2",
            },
          ],
        },
      },
    );

    expect(visuals.get("2:0")?.background).toBe("rgb(191, 207, 235)");
    expect(visuals.get("3:0")?.background).toBeUndefined();
    expect(visuals.get("3:0")?.borderColor).toBe("rgb(105, 142, 208)");
  });

  it("projects built-in light and dark table styles from theme accents", () => {
    const light = buildSpreadsheetConditionalVisuals(
      {
        name: "Tables",
        rows: [],
        tables: [
          {
            headerRowCount: 1,
            reference: "A1:B3",
            style: {
              name: "TableStyleLight13",
              showRowStripes: true,
            },
            totalsRowCount: 1,
          },
        ],
      },
      {
        colorScheme: {
          colors: [{ color: { type: 1, value: "70AD47" }, name: "accent6" }],
        },
      },
    );
    const dark = buildSpreadsheetConditionalVisuals(
      {
        name: "Tables",
        rows: [],
        tables: [
          {
            headerRowCount: 1,
            reference: "A1:B3",
            style: {
              name: "TableStyleDark6",
              showRowStripes: true,
            },
            totalsRowCount: 1,
          },
        ],
      },
      {
        colorScheme: {
          colors: [{ color: { type: 1, value: "4472C4" }, name: "accent1" }],
        },
      },
    );

    expect(light.get("2:0")?.background).toBe("rgb(235, 244, 229)");
    expect(light.get("2:0")?.borderColor).toBe("rgb(186, 216, 167)");
    expect(light.get("3:0")?.background).toBe("rgb(212, 230, 200)");
    expect(dark.get("1:0")?.color).toBe("#ffffff");
    expect(dark.get("2:0")?.background).toBe("rgb(135, 165, 217)");
    expect(dark.get("2:0")?.color).toBeUndefined();
    expect(dark.get("2:0")?.borderColor).toBe("rgb(68, 114, 196)");
    expect(dark.get("3:0")?.background).toBe("rgb(90, 131, 203)");
    expect(dark.get("3:0")?.color).toBe("#ffffff");
  });


  it("preserves icon set family metadata for renderer glyphs", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A2"],
          rules: [
            {
              iconSet: {
                cfvos: [
                  { type: "percent", val: "0" },
                  { type: "percent", val: "50" },
                ],
                iconSet: "5Rating",
                showValue: false,
              },
              type: "iconSet",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 1 }], index: 1 },
        { cells: [{ address: "A2", value: 9 }], index: 2 },
      ],
    });

    expect(visuals.get("1:0")?.iconSet).toMatchObject({
      iconSet: "5Rating",
      levelCount: 5,
      showValue: false,
    });
  });

  it("resolves sparse full-column-scale rules without dense materialization", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A:A"],
          rules: [
            {
              colorScale: {
                cfvos: [{ type: "min" }, { type: "max" }],
                colors: ["FF0000", "00FF00"],
              },
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 0 }], index: 1 },
        { cells: [{ address: "A1048576", value: 100 }], index: 1048576 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("rgb(255, 0, 0)");
    expect(visuals.get("1048576:0")?.background).toBe("rgb(0, 255, 0)");
    expect(visuals.get("1000:0")).toBeUndefined();
  });

  it("honors stop-if-true conditional format precedence", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A2"],
          rules: [
            {
              fillColor: "00FF00",
              formulas: ["0"],
              operator: "greaterThan",
              priority: 2,
              type: "cellIs",
            },
            {
              bold: true,
              fillColor: "FF0000",
              formulas: ["10"],
              operator: "greaterThan",
              priority: 1,
              stopIfTrue: true,
              type: "cellIs",
            },
          ],
        },
        {
          ranges: ["B1:B1"],
          rules: [
            {
              dataBar: {
                color: "63C384",
              },
              priority: 1,
              stopIfTrue: true,
            },
            {
              fillColor: "FFCC00",
              formulas: ["0"],
              operator: "greaterThan",
              priority: 2,
              type: "cellIs",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 12 }, { address: "B1", value: 12 }], index: 1 },
        { cells: [{ address: "A2", value: 5 }], index: 2 },
      ],
    });

    expect(visuals.get("1:0")).toMatchObject({
      background: "#FF0000",
      fontWeight: 700,
    });
    expect(visuals.get("2:0")?.background).toBe("#00FF00");
    expect(visuals.get("1:1")?.dataBar?.color).toBe("#63C384");
    expect(visuals.get("1:1")?.background).toBeUndefined();
  });

  it("applies common text and range conditional format rules", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A2"],
          rules: [
            {
              fillColor: "FFCC00",
              formulas: ["10", "20"],
              operator: "between",
              type: "cellIs",
            },
            {
              fillColor: "CC0000",
              formulas: ["10", "20"],
              operator: "notBetween",
              type: "cellIs",
            },
          ],
        },
        {
          ranges: ["A3:A3"],
          rules: [
            {
              fillColor: "00AA00",
              text: "Done",
              type: "beginsWith",
            },
          ],
        },
        {
          ranges: ["A4:A4"],
          rules: [
            {
              fillColor: "0000CC",
              text: "blocked",
              type: "notContainsText",
            },
          ],
        },
        {
          ranges: ["A5:A5"],
          rules: [
            {
              fillColor: "999999",
              type: "containsBlanks",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 15 }], index: 1 },
        { cells: [{ address: "A2", value: 25 }], index: 2 },
        { cells: [{ address: "A3", value: "Done today" }], index: 3 },
        { cells: [{ address: "A4", value: "still active" }], index: 4 },
        { cells: [{ address: "A5", value: "" }], index: 5 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("#FFCC00");
    expect(visuals.get("2:0")?.background).toBe("#CC0000");
    expect(visuals.get("3:0")?.background).toBe("#00AA00");
    expect(visuals.get("4:0")?.background).toBe("#0000CC");
    expect(visuals.get("5:0")?.background).toBe("#999999");
  });

  it("resolves cell, defined-name, and date formulas in cell-is rules", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const visuals = buildSpreadsheetConditionalVisuals(
      {
        conditionalFormattings: [
          {
            ranges: ["A2:A4"],
            rules: [
              {
                fillColor: "FDE68A",
                formulas: ["=$B$1"],
                operator: "greaterThan",
                type: "cellIs",
              },
            ],
          },
          {
            ranges: ["C2:C4"],
            rules: [
              {
                fillColor: "BAE6FD",
                formulas: ["Limit", "DATE(2026,5,4)"],
                operator: "between",
                type: "cellIs",
              },
            ],
          },
          {
            ranges: ["D2:D4"],
            rules: [
              {
                fillColor: "DCFCE7",
                formulas: ["TODAY()"],
                operator: "equal",
                type: "cellIs",
              },
            ],
          },
        ],
        rows: [
          { cells: [{ address: "B1", value: 10 }], index: 1 },
          { cells: [{ address: "A2", value: 12 }, { address: "C2", value: 46143 }, { address: "D2", value: 46146 }], index: 2 },
          { cells: [{ address: "A3", value: 8 }, { address: "C3", value: 46146 }, { address: "D3", value: 46145 }], index: 3 },
          { cells: [{ address: "A4", value: 15 }, { address: "C4", value: 46147 }, { address: "D4", value: 46147 }], index: 4 },
        ],
      },
      null,
      [{ name: "Limit", text: "46143" }],
    );

    expect(visuals.get("2:0")?.background).toBe("#FDE68A");
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#FDE68A");
    expect(visuals.get("2:2")?.background).toBe("#BAE6FD");
    expect(visuals.get("3:2")?.background).toBe("#BAE6FD");
    expect(visuals.get("4:2")).toBeUndefined();
    expect(visuals.get("2:3")?.background).toBe("#DCFCE7");
    expect(visuals.get("3:3")).toBeUndefined();
    expect(visuals.get("4:3")).toBeUndefined();
  });

  it("applies error-value conditional format rules", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A3"],
          rules: [
            {
              fillColor: "FCA5A5",
              type: "containsErrors",
            },
          ],
        },
        {
          ranges: ["B1:B3"],
          rules: [
            {
              fillColor: "BBF7D0",
              type: "notContainsErrors",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: "#DIV/0!" }, { address: "B1", value: "#REF!" }], index: 1 },
        { cells: [{ address: "A2", value: "#N/A" }, { address: "B2", value: "ok" }], index: 2 },
        { cells: [{ address: "A3", value: "ok" }, { address: "B3", value: 42 }], index: 3 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("#FCA5A5");
    expect(visuals.get("2:0")?.background).toBe("#FCA5A5");
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("1:1")).toBeUndefined();
    expect(visuals.get("2:1")?.background).toBe("#BBF7D0");
    expect(visuals.get("3:1")?.background).toBe("#BBF7D0");
  });

  it("applies duplicate and unique value conditional format rules", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A4"],
          rules: [
            {
              fillColor: "F87171",
              type: "duplicateValues",
            },
          ],
        },
        {
          ranges: ["B1:B4"],
          rules: [
            {
              fillColor: "60A5FA",
              type: "uniqueValues",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: "alpha" }, { address: "B1", value: "alpha" }], index: 1 },
        { cells: [{ address: "A2", value: "beta" }, { address: "B2", value: "beta" }], index: 2 },
        { cells: [{ address: "A3", value: "alpha" }, { address: "B3", value: "beta" }], index: 3 },
        { cells: [{ address: "A4", value: "gamma" }, { address: "B4", value: "gamma" }], index: 4 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("#F87171");
    expect(visuals.get("2:0")).toBeUndefined();
    expect(visuals.get("3:0")?.background).toBe("#F87171");
    expect(visuals.get("1:1")?.background).toBe("#60A5FA");
    expect(visuals.get("2:1")).toBeUndefined();
    expect(visuals.get("4:1")?.background).toBe("#60A5FA");
  });

  it("applies top-bottom and average conditional format rules", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A5"],
          rules: [
            {
              fillColor: "F97316",
              rank: 2,
              type: "top10",
            },
          ],
        },
        {
          ranges: ["B1:B5"],
          rules: [
            {
              bottom: true,
              fillColor: "A855F7",
              rank: 40,
              percent: true,
              type: "top10",
            },
          ],
        },
        {
          ranges: ["C1:C5"],
          rules: [
            {
              aboveAverage: false,
              equalAverage: true,
              fillColor: "14B8A6",
              type: "aboveAverage",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 1 }, { address: "B1", value: 1 }, { address: "C1", value: 1 }], index: 1 },
        { cells: [{ address: "A2", value: 2 }, { address: "B2", value: 2 }, { address: "C2", value: 2 }], index: 2 },
        { cells: [{ address: "A3", value: 3 }, { address: "B3", value: 3 }, { address: "C3", value: 3 }], index: 3 },
        { cells: [{ address: "A4", value: 4 }, { address: "B4", value: 4 }, { address: "C4", value: 4 }], index: 4 },
        { cells: [{ address: "A5", value: 5 }, { address: "B5", value: 5 }, { address: "C5", value: 5 }], index: 5 },
      ],
    });

    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#F97316");
    expect(visuals.get("5:0")?.background).toBe("#F97316");
    expect(visuals.get("1:1")?.background).toBe("#A855F7");
    expect(visuals.get("2:1")?.background).toBe("#A855F7");
    expect(visuals.get("3:2")?.background).toBe("#14B8A6");
    expect(visuals.get("4:2")).toBeUndefined();
  });

  it("applies Excel time-period conditional format rules", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A4"],
          rules: [
            {
              fillColor: "DBEAFE",
              timePeriod: "last7Days",
              type: "timePeriod",
            },
            {
              fillColor: "DCFCE7",
              timePeriod: "thisMonth",
              type: "timePeriod",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 46146 }], index: 1 },
        { cells: [{ address: "A2", value: 46143 }], index: 2 },
        { cells: [{ address: "A3", value: 46140 }], index: 3 },
        { cells: [{ address: "A4", value: 46138 }], index: 4 },
      ],
    });

    expect(visuals.get("1:0")?.background).toBe("#DCFCE7");
    expect(visuals.get("2:0")?.background).toBe("#DCFCE7");
    expect(visuals.get("3:0")?.background).toBe("#DBEAFE");
    expect(visuals.get("4:0")).toBeUndefined();
  });

  it("applies formula-driven conditional format rules with relative cell references", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["B2:B4"],
          rules: [
            {
              fillColor: "FACC15",
              formulas: ["=AND($A2=\"Open\",B2>10)"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["C2:C4"],
          rules: [
            {
              fillColor: "22C55E",
              formulas: ["=MOD(ROW(),2)=0"],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A2", value: "Open" }, { address: "B2", value: 12 }, { address: "C2", value: "even" }], index: 2 },
        { cells: [{ address: "A3", value: "Closed" }, { address: "B3", value: 30 }, { address: "C3", value: "odd" }], index: 3 },
        { cells: [{ address: "A4", value: "Open" }, { address: "B4", value: 8 }, { address: "C4", value: "even" }], index: 4 },
      ],
    });

    expect(visuals.get("2:1")?.background).toBe("#FACC15");
    expect(visuals.get("3:1")).toBeUndefined();
    expect(visuals.get("4:1")).toBeUndefined();
    expect(visuals.get("2:2")?.background).toBe("#22C55E");
    expect(visuals.get("3:2")).toBeUndefined();
    expect(visuals.get("4:2")?.background).toBe("#22C55E");
  });

  it("evaluates COUNTIF and COUNTIFS conditional format formulas over sparse ranges", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A2:A5"],
          rules: [
            {
              fillColor: "FCA5A5",
              formulas: ["=COUNTIF($A:$A,A2)>1"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["C2:C5"],
          rules: [
            {
              fillColor: "BFDBFE",
              formulas: ["=COUNTIFS($B$2:$B$5,\"Open\",$C$2:$C$5,C2)>1"],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A2", value: "alpha" }, { address: "B2", value: "Open" }, { address: "C2", value: "UI" }], index: 2 },
        { cells: [{ address: "A3", value: "beta" }, { address: "B3", value: "Closed" }, { address: "C3", value: "Design" }], index: 3 },
        { cells: [{ address: "A4", value: "alpha" }, { address: "B4", value: "Open" }, { address: "C4", value: "API" }], index: 4 },
        { cells: [{ address: "A5", value: "gamma" }, { address: "B5", value: "Open" }, { address: "C5", value: "UI" }], index: 5 },
      ],
    });

    expect(visuals.get("2:0")?.background).toBe("#FCA5A5");
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#FCA5A5");
    expect(visuals.get("2:2")?.background).toBe("#BFDBFE");
    expect(visuals.get("3:2")).toBeUndefined();
    expect(visuals.get("4:2")).toBeUndefined();
    expect(visuals.get("5:2")?.background).toBe("#BFDBFE");
  });

  it("evaluates common error and branch formula helpers in conditional formats", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A2:A4"],
          rules: [
            {
              fillColor: "FECACA",
              formulas: ["=ISERROR(A2)"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["B2:B4"],
          rules: [
            {
              fillColor: "C7D2FE",
              formulas: ["=IF($C2=\"Open\",ABS(B2)>10,FALSE)"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["D2:D4"],
          rules: [
            {
              fillColor: "BBF7D0",
              formulas: ["=IFERROR(D2,0)=0"],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A2", value: "#VALUE!" }, { address: "B2", value: -12 }, { address: "C2", value: "Open" }, { address: "D2", value: "#DIV/0!" }], index: 2 },
        { cells: [{ address: "A3", value: "#N/A" }, { address: "B3", value: 12 }, { address: "C3", value: "Closed" }, { address: "D3", value: 7 }], index: 3 },
        { cells: [{ address: "A4", value: "ok" }, { address: "B4", value: 8 }, { address: "C4", value: "Open" }, { address: "D4", value: 0 }], index: 4 },
      ],
    });

    expect(visuals.get("2:0")?.background).toBe("#FECACA");
    expect(visuals.get("3:0")?.background).toBe("#FECACA");
    expect(visuals.get("4:0")).toBeUndefined();
    expect(visuals.get("2:1")?.background).toBe("#C7D2FE");
    expect(visuals.get("3:1")).toBeUndefined();
    expect(visuals.get("4:1")).toBeUndefined();
    expect(visuals.get("2:3")?.background).toBe("#BBF7D0");
    expect(visuals.get("3:3")).toBeUndefined();
    expect(visuals.get("4:3")?.background).toBe("#BBF7D0");
  });

  it("evaluates SUMIF, SUMIFS, and AVERAGEIF conditional format formulas", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["D2:D5"],
          rules: [
            {
              fillColor: "FED7AA",
              formulas: ["=SUMIF($B$2:$B$5,\"Open\",$D$2:$D$5)>25"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["E2:E5"],
          rules: [
            {
              fillColor: "DDD6FE",
              formulas: ["=SUMIFS($D$2:$D$5,$B$2:$B$5,\"Open\",$C$2:$C$5,C2)>10"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["F2:F5"],
          rules: [
            {
              fillColor: "A7F3D0",
              formulas: ["=F2>AVERAGEIF($B$2:$B$5,\"Open\",$F$2:$F$5)"],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "B2", value: "Open" }, { address: "C2", value: "UI" }, { address: "D2", value: 12 }, { address: "E2", value: "UI" }, { address: "F2", value: 5 }], index: 2 },
        { cells: [{ address: "B3", value: "Closed" }, { address: "C3", value: "UI" }, { address: "D3", value: 40 }, { address: "E3", value: "UI" }, { address: "F3", value: 50 }], index: 3 },
        { cells: [{ address: "B4", value: "Open" }, { address: "C4", value: "API" }, { address: "D4", value: 8 }, { address: "E4", value: "API" }, { address: "F4", value: 15 }], index: 4 },
        { cells: [{ address: "B5", value: "Open" }, { address: "C5", value: "UI" }, { address: "D5", value: 9 }, { address: "E5", value: "UI" }, { address: "F5", value: 25 }], index: 5 },
      ],
    });

    expect(visuals.get("2:3")?.background).toBe("#FED7AA");
    expect(visuals.get("3:3")?.background).toBe("#FED7AA");
    expect(visuals.get("2:4")?.background).toBe("#DDD6FE");
    expect(visuals.get("4:4")).toBeUndefined();
    expect(visuals.get("5:4")?.background).toBe("#DDD6FE");
    expect(visuals.get("2:5")).toBeUndefined();
    expect(visuals.get("4:5")).toBeUndefined();
    expect(visuals.get("5:5")?.background).toBe("#A7F3D0");
  });

  it("evaluates common text helpers in conditional format formulas", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A2:A5"],
          rules: [
            {
              fillColor: "FBCFE8",
              formulas: ["=ISNUMBER(SEARCH(\"urgent\",A2))"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["B2:B5"],
          rules: [
            {
              fillColor: "BFDBFE",
              formulas: ["=LEFT(UPPER(TRIM(B2)),3)=\"RTA\""],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["C2:C5"],
          rules: [
            {
              fillColor: "FDE68A",
              formulas: ["=MID(C2,2,3)=\"123\""],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["D2:D5"],
          rules: [
            {
              fillColor: "DDD6FE",
              formulas: ["=RIGHT(D2,2)=\"OK\""],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A2", value: "Urgent follow-up" }, { address: "B2", value: " rta-1001 " }, { address: "C2", value: "X123Z" }, { address: "D2", value: "DONE-OK" }], index: 2 },
        { cells: [{ address: "A3", value: "normal" }, { address: "B3", value: "task-1" }, { address: "C3", value: "X999Z" }, { address: "D3", value: "DONE-NO" }], index: 3 },
        { cells: [{ address: "A4", value: "not urgent" }, { address: "B4", value: "RTA-1002" }, { address: "C4", value: "Y123Q" }, { address: "D4", value: "OK" }], index: 4 },
        { cells: [{ address: "A5", value: "plain" }, { address: "B5", value: "rtb-1003" }, { address: "C5", value: "123" }, { address: "D5", value: "pending" }], index: 5 },
      ],
    });

    expect(visuals.get("2:0")?.background).toBe("#FBCFE8");
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#FBCFE8");
    expect(visuals.get("2:1")?.background).toBe("#BFDBFE");
    expect(visuals.get("3:1")).toBeUndefined();
    expect(visuals.get("4:1")?.background).toBe("#BFDBFE");
    expect(visuals.get("2:2")?.background).toBe("#FDE68A");
    expect(visuals.get("3:2")).toBeUndefined();
    expect(visuals.get("4:2")?.background).toBe("#FDE68A");
    expect(visuals.get("2:3")?.background).toBe("#DDD6FE");
    expect(visuals.get("3:3")).toBeUndefined();
    expect(visuals.get("4:3")?.background).toBe("#DDD6FE");
  });

  it("evaluates date-part and parity helpers in conditional format formulas", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A2:A5"],
          rules: [
            {
              fillColor: "BAE6FD",
              formulas: ["=AND(YEAR(A2)=2026,MONTH(A2)=5,DAY(A2)=4)"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["B2:B5"],
          rules: [
            {
              fillColor: "FDE68A",
              formulas: ["=WEEKDAY(B2,2)>5"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["C2:C5"],
          rules: [
            {
              fillColor: "DDD6FE",
              formulas: ["=ISODD(ROW())"],
              type: "expression",
            },
          ],
        },
        {
          ranges: ["D2:D5"],
          rules: [
            {
              fillColor: "BBF7D0",
              formulas: ["=ISEVEN(D2)"],
              type: "expression",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A2", value: 46146 }, { address: "B2", value: 46144 }, { address: "C2", value: "row2" }, { address: "D2", value: 2 }], index: 2 },
        { cells: [{ address: "A3", value: 46147 }, { address: "B3", value: 46145 }, { address: "C3", value: "row3" }, { address: "D3", value: 3 }], index: 3 },
        { cells: [{ address: "A4", value: 46146 }, { address: "B4", value: 46146 }, { address: "C4", value: "row4" }, { address: "D4", value: 4 }], index: 4 },
        { cells: [{ address: "A5", value: 45782 }, { address: "B5", value: 46150 }, { address: "C5", value: "row5" }, { address: "D5", value: 5 }], index: 5 },
      ],
    });

    expect(visuals.get("2:0")?.background).toBe("#BAE6FD");
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#BAE6FD");
    expect(visuals.get("5:0")).toBeUndefined();
    expect(visuals.get("2:1")?.background).toBe("#FDE68A");
    expect(visuals.get("3:1")?.background).toBe("#FDE68A");
    expect(visuals.get("4:1")).toBeUndefined();
    expect(visuals.get("3:2")?.background).toBe("#DDD6FE");
    expect(visuals.get("5:2")?.background).toBe("#DDD6FE");
    expect(visuals.get("2:3")?.background).toBe("#BBF7D0");
    expect(visuals.get("3:3")).toBeUndefined();
    expect(visuals.get("4:3")?.background).toBe("#BBF7D0");
  });

  it("resolves table structured references in formula conditional formats", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["C2:C4"],
          rules: [
            {
              fillColor: "C6EFCE",
              formulas: ["=[@Status]=\"Open\""],
              type: "expression",
            },
          ],
        },
      ],
      name: "StructuredRefs",
      rows: [
        { cells: [{ address: "A1", value: "Status" }, { address: "B1", value: "Owner" }, { address: "C1", value: "Score" }], index: 1 },
        { cells: [{ address: "A2", value: "Open" }, { address: "B2", value: "Ava" }, { address: "C2", value: "12" }], index: 2 },
        { cells: [{ address: "A3", value: "Closed" }, { address: "B3", value: "Ben" }, { address: "C3", value: "8" }], index: 3 },
        { cells: [{ address: "A4", value: "Open" }, { address: "B4", value: "Cal" }, { address: "C4", value: "20" }], index: 4 },
      ],
      tables: [
        {
          columns: [{ name: "Status" }, { name: "Owner" }, { name: "Score" }],
          name: "Tasks",
          reference: "A1:C4",
        },
      ],
    });

    expect(visuals.get("2:2")?.background).toBe("#C6EFCE");
    expect(visuals.get("3:2")?.background).toBeUndefined();
    expect(visuals.get("3:2")?.borderColor).toBe("#93c5fd");
    expect(visuals.get("4:2")?.background).toBe("#C6EFCE");
  });

  it("resolves defined names in formula conditional formats", () => {
    const visuals = buildSpreadsheetConditionalVisuals(
      {
        conditionalFormattings: [
          {
            ranges: ["A2:A3"],
            rules: [
              {
                fillColor: "FACC15",
                formulas: ["=A2>Limit"],
                type: "expression",
              },
            ],
          },
        ],
        name: "DefinedNames",
        rows: [
          { cells: [{ address: "A2", value: "12" }, { address: "B2", value: "10" }], index: 2 },
          { cells: [{ address: "A3", value: "8" }], index: 3 },
        ],
      },
      null,
      [{ name: "Limit", text: "$B$2" }],
    );

    expect(visuals.get("2:0")?.background).toBe("#FACC15");
    expect(visuals.get("3:0")).toBeUndefined();
  });

  it("evaluates aggregate functions over ranges in formula conditional formats", () => {
    const visuals = buildSpreadsheetConditionalVisuals(
      {
        conditionalFormattings: [
          {
            ranges: ["A2:A4"],
            rules: [
              {
                fillColor: "DCFCE7",
                formulas: ["=A2>AVERAGE(TargetScores)"],
                type: "expression",
              },
            ],
          },
        ],
        name: "AggregateFormula",
        rows: [
          { cells: [{ address: "A2", value: "10" }, { address: "B2", value: "10" }], index: 2 },
          { cells: [{ address: "A3", value: "20" }, { address: "B3", value: "20" }], index: 3 },
          { cells: [{ address: "A4", value: "30" }, { address: "B4", value: "30" }], index: 4 },
        ],
      },
      null,
      [{ name: "TargetScores", text: "$B$2:$B$4" }],
    );

    expect(visuals.get("2:0")).toBeUndefined();
    expect(visuals.get("3:0")).toBeUndefined();
    expect(visuals.get("4:0")?.background).toBe("#DCFCE7");
  });

  it("uses data-bar direction, visibility, and length options", () => {
    const visuals = buildSpreadsheetConditionalVisuals({
      conditionalFormattings: [
        {
          ranges: ["A1:A2"],
          rules: [
            {
              dataBar: {
                axisColor: "111827",
                border: true,
                borderColor: "1D4ED8",
                cfvos: [{ type: "min" }, { type: "max" }],
                color: "3B82F6",
                direction: "rightToLeft",
                maxLength: 80,
                minLength: 20,
                negativeBorderColor: "991B1B",
                negativeFillColor: "EF4444",
                showValue: false,
              },
              type: "dataBar",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: -100 }], index: 1 },
        { cells: [{ address: "A2", value: 100 }], index: 2 },
      ],
    });

    expect(visuals.get("1:0")?.dataBar).toMatchObject({
      axisColor: "#111827",
      axisPercent: 50,
      border: true,
      borderColor: "#991B1B",
      color: "#EF4444",
      direction: "rightToLeft",
      showValue: false,
      startPercent: 50,
      widthPercent: 50,
    });
    expect(visuals.get("2:0")?.dataBar).toMatchObject({
      borderColor: "#1D4ED8",
      color: "#3B82F6",
      direction: "rightToLeft",
      startPercent: 0,
      widthPercent: 50,
    });
  });
});
