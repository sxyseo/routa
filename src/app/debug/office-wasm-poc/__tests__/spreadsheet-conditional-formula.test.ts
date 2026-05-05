import { describe, expect, it } from "vitest";

import {
  conditionalFormulaMatches,
  conditionalFormulaValue,
  type ConditionalFormulaContext,
} from "../spreadsheet-conditional-formula";

function formulaContext(formula = "=TRUE"): ConditionalFormulaContext {
  return {
    columnIndex: 0,
    formulas: [formula],
    range: { startColumn: 0, startRow: 1 },
    rowsByIndex: new Map(),
    rowIndex: 1,
  };
}

describe("spreadsheet conditional formulas", () => {
  it("formats date and time values with TEXT", () => {
    const context = formulaContext();

    expect(conditionalFormulaValue("=TEXT(DATE(2026,5,1),\"yyyy-mm-dd\")", context)).toBe("2026-05-01");
    expect(conditionalFormulaValue("=TEXT(DATE(2026,5,1),\"mmm d\")", context)).toBe("May 1");
    expect(conditionalFormulaValue("=TEXT(TIME(6,30,0),\"h:mm\")", context)).toBe("6:30");
  });

  it("evaluates date and time conversion functions in conditional comparisons", () => {
    expect(conditionalFormulaMatches(formulaContext("=DATEVALUE(\"2026-05-01\")=DATE(2026,5,1)"))).toBe(true);
    expect(conditionalFormulaMatches(formulaContext("=TIMEVALUE(\"06:30:00\")=TIME(6,30,0)"))).toBe(true);
    expect(conditionalFormulaMatches(formulaContext("=TEXT(DATE(2026,5,1),\"yyyy-mm\")=\"2026-05\""))).toBe(true);
  });
});
