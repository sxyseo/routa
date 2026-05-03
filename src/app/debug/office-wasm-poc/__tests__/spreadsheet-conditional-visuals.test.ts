import { describe, expect, it } from "vitest";

import { buildSpreadsheetConditionalVisuals } from "../spreadsheet-conditional-visuals";

describe("spreadsheet conditional visuals", () => {
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
              bold: true,
              fillColor: "FF0000",
              formulas: ["10"],
              operator: "greaterThan",
              stopIfTrue: true,
              type: "cellIs",
            },
            {
              fillColor: "00FF00",
              formulas: ["0"],
              operator: "greaterThan",
              type: "cellIs",
            },
          ],
        },
      ],
      rows: [
        { cells: [{ address: "A1", value: 12 }], index: 1 },
        { cells: [{ address: "A2", value: 5 }], index: 2 },
      ],
    });

    expect(visuals.get("1:0")).toMatchObject({
      background: "#FF0000",
      fontWeight: 700,
    });
    expect(visuals.get("2:0")?.background).toBe("#00FF00");
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
});
