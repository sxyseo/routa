import { describe, expect, it } from "vitest";

import { presentationTableGrid } from "../presentation-table-renderer";

describe("presentationTableGrid", () => {
  const rect = { height: 200, left: 0, top: 0, width: 400 };

  it("proportionally scales column widths to fill the rect", () => {
    const grid = presentationTableGrid(
      { columns: [1_000, 1_000], rows: [{ cells: [{}, {}], height: 1_000 }] },
      rect,
    );
    expect(grid.columns).toEqual([200, 200]);
    expect(grid.rows).toEqual([200]);
  });

  it("handles gridSpan by counting spanned columns", () => {
    const grid = presentationTableGrid(
      {
        columns: [2_000, 1_000, 1_000],
        rows: [
          { cells: [{ gridSpan: 2 }, {}], height: 2_000 },
          { cells: [{}, {}, {}], height: 1_000 },
        ],
      },
      rect,
    );
    // total EMU: 4000; scale = 400/4000 = 0.1
    expect(grid.columns).toEqual([200, 100, 100]);
    expect(grid.rows[0]).toBeCloseTo(133.3, 0);
    expect(grid.rows[1]).toBeCloseTo(66.7, 0);
  });

  it("accepts columnWidths and gridColumns as alternative field names", () => {
    const byColumnWidths = presentationTableGrid(
      { columnWidths: [1_000, 1_000], rows: [] },
      rect,
    );
    const byGridColumns = presentationTableGrid(
      { gridColumns: [1_000, 1_000], rows: [] },
      rect,
    );
    expect(byColumnWidths.columns).toEqual(byGridColumns.columns);
  });

  it("returns a single column/row when dimensions are missing", () => {
    const grid = presentationTableGrid(
      { rows: [{ cells: [{}], height: 1_000 }] },
      rect,
    );
    expect(grid.columns).toHaveLength(1);
    expect(grid.rows).toHaveLength(1);
  });

  it("returns empty rows array for empty table", () => {
    const grid = presentationTableGrid({}, rect);
    expect(grid.columns).toHaveLength(1);
    expect(grid.rows).toHaveLength(0);
  });
});
