import { describe, expect, it } from "vitest";

import { buildSpreadsheetCanvasCommands } from "../spreadsheet-canvas-commands";
import {
  buildSpreadsheetCanvasRenderPlan,
  spreadsheetCanvasBitmapSize,
} from "../spreadsheet-canvas-renderer";
import { buildSpreadsheetLayout } from "../spreadsheet-layout";

describe("spreadsheet canvas renderer", () => {
  it("syncs canvas bitmap size from viewport and device pixel ratio", () => {
    expect(spreadsheetCanvasBitmapSize({ height: 90.4, width: 140.6 }, 2)).toEqual({
      cssHeight: 90,
      cssWidth: 141,
      pixelHeight: 180,
      pixelRatio: 2,
      pixelWidth: 282,
    });
    expect(spreadsheetCanvasBitmapSize({ height: 0, width: 0 }, 0)).toEqual({
      cssHeight: 0,
      cssWidth: 0,
      pixelHeight: 1,
      pixelRatio: 1,
      pixelWidth: 1,
    });
  });

  it("projects visible worksheet commands into viewport canvas coordinates", () => {
    const layout = buildSpreadsheetLayout({
      columns: [
        { max: 1, min: 1, width: 10 },
        { max: 2, min: 2, width: 10 },
      ],
      rows: [
        { cells: [{ address: "A1" }], index: 1 },
        { cells: [{ address: "B2" }], index: 2 },
      ],
    });
    const commands = buildSpreadsheetCanvasCommands({
      layout,
      scroll: { left: 60, top: 20 },
      viewportSize: { height: 80, width: 180 },
    });

    const plan = buildSpreadsheetCanvasRenderPlan({
      commands,
      pixelRatio: 1,
      scroll: { left: 60, top: 20 },
      viewportSize: { height: 80, width: 180 },
    });

    expect(plan.columnHeaders[0]).toMatchObject({
      height: 20,
      left: -20,
      text: "A",
      top: 0,
      width: 75,
    });
    expect(plan.rowHeaders[0]).toMatchObject({
      height: 20,
      left: 0,
      text: "1",
      top: 0,
      width: 40,
    });
    expect(plan.cells[0]).toMatchObject({
      height: 20,
      left: -20,
      top: 0,
      width: 75,
    });
  });

  it("preserves cell text and paint commands for worker rendering", () => {
    const layout = buildSpreadsheetLayout({
      rows: [{ cells: [{ address: "A1" }], index: 1 }],
    });
    const commands = buildSpreadsheetCanvasCommands({
      cellPaints: new Map([["1:0", { color: "#222222", fill: "#fafafa", text: "Hello" }]]),
      layout,
      scroll: { left: 0, top: 0 },
      viewportSize: { height: 80, width: 180 },
    });

    const plan = buildSpreadsheetCanvasRenderPlan({
      commands,
      pixelRatio: 1,
      scroll: { left: 0, top: 0 },
      viewportSize: { height: 80, width: 180 },
    });

    expect(plan.cells[0]).toMatchObject({
      color: "#222222",
      fill: "#fafafa",
      text: "Hello",
    });
  });
});
