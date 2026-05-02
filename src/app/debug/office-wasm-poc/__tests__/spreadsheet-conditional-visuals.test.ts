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
});
