import { describe, expect, it } from "vitest";

import { buildSpreadsheetCanvasCellPaints } from "../spreadsheet-canvas-paints";
import { buildSpreadsheetLayout } from "../spreadsheet-layout";

describe("spreadsheet canvas paints", () => {
  it("projects only visible cell paint state", () => {
    const layout = buildSpreadsheetLayout({
      rows: [
        { cells: [{ address: "A1", value: "visible" }], index: 1 },
        { cells: [{ address: "A20", value: "hidden" }], index: 20 },
      ],
    });
    const paints = buildSpreadsheetCanvasCellPaints({
      cellEdits: { "20:0": "edited hidden" },
      layout,
      project: {
        cellStyle: () => ({ background: "#ffffff", color: "#111111" }),
        cellText: (cell) => String(cell.value ?? ""),
      },
      visibleRange: {
        endColumnIndex: 1,
        endRowOffset: 4,
        startColumnIndex: 0,
        startRowOffset: 0,
      },
    });

    expect(paints.get("1:0")).toEqual({
      color: "#111111",
      fill: "#ffffff",
      text: "visible",
    });
    expect(paints.has("20:0")).toBe(false);
  });

  it("keeps visible preview edits even when the original cell is absent", () => {
    const layout = buildSpreadsheetLayout({
      rows: [{ cells: [{ address: "A1", value: "visible" }], index: 1 }],
    });
    const paints = buildSpreadsheetCanvasCellPaints({
      cellEdits: { "3:1": "new text" },
      layout,
      project: {
        cellStyle: () => ({}),
        cellText: () => "",
      },
      visibleRange: {
        endColumnIndex: 2,
        endRowOffset: 4,
        startColumnIndex: 0,
        startRowOffset: 0,
      },
    });

    expect(paints.get("3:1")).toEqual({ text: "new text" });
  });
});
