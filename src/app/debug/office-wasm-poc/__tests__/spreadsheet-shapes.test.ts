import { describe, expect, it } from "vitest";

import { buildSpreadsheetLayout, spreadsheetColumnLeft, spreadsheetRowTop } from "../spreadsheet-layout";
import { buildSpreadsheetShapes } from "../spreadsheet-shapes";

describe("spreadsheet shapes", () => {
  it("builds shape overlays from sheet drawing anchors", () => {
    const sheet = {
      drawings: [
        {
          extentCx: "952500",
          extentCy: "476250",
          fromAnchor: {
            colId: "2",
            colOffset: "9525",
            rowId: "3",
            rowOffset: "19050",
          },
          shape: {
            bbox: {
              heightEmu: "476250",
              widthEmu: "952500",
            },
            id: "shape-1",
            shape: {
              fill: { color: { value: "F0FDFA" } },
              geometry: 26,
              line: {
                fill: { color: { value: "14B8A6" } },
                widthEmu: "19050",
              },
            },
          },
        },
      ],
      name: "Shapes",
      rows: [{ cells: [{ address: "C4" }], index: 4 }],
    };
    const layout = buildSpreadsheetLayout(sheet);

    const shapes = buildSpreadsheetShapes({
      activeSheet: sheet,
      layout,
      shapes: [],
    });

    expect(shapes).toEqual([
      {
        fill: "#F0FDFA",
        geometry: 26,
        height: 50,
        id: "shape-1",
        left: spreadsheetColumnLeft(layout, 2) + 1,
        line: "#14B8A6",
        lineWidth: 2,
        text: "",
        top: spreadsheetRowTop(layout, 3) + 2,
        width: 100,
      },
    ]);
  });
});
