import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpreadsheetCellContent, spreadsheetIconSetShape } from "../spreadsheet-cell-overlays";

describe("spreadsheet cell overlays", () => {
  it("renders Excel icon sets as SVG shapes instead of font emoji glyphs", () => {
    const { container } = render(
      <SpreadsheetCellContent
        text=""
        visual={{ iconSet: { color: "#16638a", iconSet: "5Arrows", level: 5, levelCount: 5, showValue: false } }}
      />,
    );

    const icon = container.querySelector('[data-testid="spreadsheet-icon-set"]');
    expect(icon?.tagName.toLowerCase()).toBe("svg");
    expect(container.textContent).toBe("");
  });

  it("maps common Excel icon-set families to stable renderer shapes", () => {
    expect(spreadsheetIconSetShape({ color: "#16638a", iconSet: "5Rating", level: 4, levelCount: 5, showValue: false })).toBe("rating");
    expect(spreadsheetIconSetShape({ color: "#16638a", iconSet: "5Quarters", level: 4, levelCount: 5, showValue: false })).toBe("quarter");
    expect(spreadsheetIconSetShape({ color: "#16638a", iconSet: "3TrafficLights1", level: 2, levelCount: 3, showValue: false })).toBe("traffic");
  });
});
