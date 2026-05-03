import {
  asArray,
  asString,
  cellText,
  columnIndexFromAddress,
  type RecordValue,
} from "./office-preview-utils";

type ConditionalFormulaRange = {
  startColumn: number;
  startRow: number;
};

type ConditionalFormulaContext = {
  columnIndex: number;
  formulas: unknown;
  range: ConditionalFormulaRange;
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>;
  rowIndex: number;
};

type CellReference = {
  columnAbsolute: boolean;
  columnIndex: number;
  rowAbsolute: boolean;
  rowIndex: number;
};

const CELL_REFERENCE_PATTERN = /^(?:'[^']+'|[A-Za-z0-9_ ]+!)?(\$?)([A-Z]{1,3})(\$?)(\d+)$/i;

export function conditionalFormulaMatches(context: ConditionalFormulaContext): boolean {
  const formula = asArray(context.formulas).map(asString).find(Boolean);
  if (!formula) return false;
  return valueToBoolean(evaluateFormulaExpression(stripFormulaPrefix(formula), context));
}

function evaluateFormulaExpression(expression: string, context: ConditionalFormulaContext): unknown {
  const trimmed = stripOuterParens(expression.trim());
  if (!trimmed) return "";

  const comparison = splitTopLevelComparison(trimmed);
  if (comparison) {
    const left = evaluateFormulaValue(comparison.left, context);
    const right = evaluateFormulaValue(comparison.right, context);
    return compareFormulaValues(left, right, comparison.operator);
  }

  return evaluateFormulaValue(trimmed, context);
}

function evaluateFormulaValue(expression: string, context: ConditionalFormulaContext): unknown {
  const trimmed = stripOuterParens(expression.trim());
  if (!trimmed) return "";

  const stringLiteral = trimmed.match(/^"((?:[^"]|"")*)"$/);
  if (stringLiteral) return stringLiteral[1].replaceAll("\"\"", "\"");

  if (/^(TRUE|FALSE)$/i.test(trimmed)) return /^TRUE$/i.test(trimmed);

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) return numericValue;

  const cellReference = parseCellReference(trimmed);
  if (cellReference) return cellValueAtReference(cellReference, context);

  const call = parseFunctionCall(trimmed);
  if (call) return evaluateFormulaFunction(call.name, call.args, context);

  return trimmed;
}

function evaluateFormulaFunction(name: string, args: string[], context: ConditionalFormulaContext): unknown {
  const normalizedName = name.toUpperCase();
  if (normalizedName === "AND") {
    return args.every((arg) => valueToBoolean(evaluateFormulaExpression(arg, context)));
  }
  if (normalizedName === "OR") {
    return args.some((arg) => valueToBoolean(evaluateFormulaExpression(arg, context)));
  }
  if (normalizedName === "NOT") {
    return !valueToBoolean(evaluateFormulaExpression(args[0] ?? "", context));
  }
  if (normalizedName === "ISBLANK") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().length === 0;
  }
  if (normalizedName === "ISNUMBER") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return Number.isFinite(Number(value)) && asString(value).trim().length > 0;
  }
  if (normalizedName === "ISTEXT") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return asString(value).trim().length > 0 && !Number.isFinite(Number(value));
  }
  if (normalizedName === "LEN") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).length;
  }
  if (normalizedName === "ROW") {
    return args.length > 0 ? resolvedCellReferenceValue(args[0], context, "row") : context.rowIndex;
  }
  if (normalizedName === "COLUMN") {
    return args.length > 0 ? resolvedCellReferenceValue(args[0], context, "column") + 1 : context.columnIndex + 1;
  }
  if (normalizedName === "MOD") {
    const dividend = Number(evaluateFormulaValue(args[0] ?? "", context));
    const divisor = Number(evaluateFormulaValue(args[1] ?? "", context));
    return Number.isFinite(dividend) && Number.isFinite(divisor) && divisor !== 0 ? dividend % divisor : Number.NaN;
  }

  return "";
}

function compareFormulaValues(left: unknown, right: unknown, operator: string): boolean {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const leftValue = numeric ? leftNumber : asString(left);
  const rightValue = numeric ? rightNumber : asString(right);

  if (operator === "=") return leftValue === rightValue;
  if (operator === "<>") return leftValue !== rightValue;
  if (operator === ">") return leftValue > rightValue;
  if (operator === ">=") return leftValue >= rightValue;
  if (operator === "<") return leftValue < rightValue;
  if (operator === "<=") return leftValue <= rightValue;
  return false;
}

function cellValueAtReference(reference: CellReference, context: ConditionalFormulaContext): string {
  const rowIndex = reference.rowAbsolute
    ? reference.rowIndex
    : context.rowIndex + reference.rowIndex - context.range.startRow;
  const columnIndex = reference.columnAbsolute
    ? reference.columnIndex
    : context.columnIndex + reference.columnIndex - context.range.startColumn;
  const cell = context.rowsByIndex.get(rowIndex)?.get(columnIndex) ?? null;
  return cellText(cell);
}

function resolvedCellReferenceValue(
  expression: string,
  context: ConditionalFormulaContext,
  axis: "column" | "row",
): number {
  const reference = parseCellReference(expression);
  if (!reference) return axis === "row" ? context.rowIndex : context.columnIndex;
  if (axis === "row") {
    return reference.rowAbsolute ? reference.rowIndex : context.rowIndex + reference.rowIndex - context.range.startRow;
  }
  return reference.columnAbsolute ? reference.columnIndex : context.columnIndex + reference.columnIndex - context.range.startColumn;
}

function parseCellReference(value: string): CellReference | null {
  const normalized = value.replace(/^.*!/, "");
  const match = normalized.match(CELL_REFERENCE_PATTERN);
  if (!match) return null;
  return {
    columnAbsolute: match[1] === "$",
    columnIndex: columnIndexFromAddress(match[2]),
    rowAbsolute: match[3] === "$",
    rowIndex: Math.max(1, Number.parseInt(match[4] ?? "1", 10)),
  };
}

function parseFunctionCall(value: string): { args: string[]; name: string } | null {
  const nameMatch = value.match(/^([A-Z][A-Z0-9.]*)\(/i);
  if (!nameMatch || !value.endsWith(")")) return null;
  const argsText = value.slice(nameMatch[0].length, -1);
  return {
    args: splitTopLevelArgs(argsText),
    name: nameMatch[1],
  };
}

function splitTopLevelComparison(value: string): { left: string; operator: string; right: string } | null {
  for (const operator of [">=", "<=", "<>", "=", ">", "<"]) {
    const index = findTopLevelOperator(value, operator);
    if (index < 0) continue;
    return {
      left: value.slice(0, index),
      operator,
      right: value.slice(index + operator.length),
    };
  }
  return null;
}

function findTopLevelOperator(value: string, operator: string): number {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index <= value.length - operator.length; index += 1) {
    const char = value[index];
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && value.slice(index, index + operator.length) === operator) return index;
  }
  return -1;
}

function splitTopLevelArgs(value: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\"") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char !== "," || depth !== 0) continue;
    args.push(value.slice(start, index).trim());
    start = index + 1;
  }
  const last = value.slice(start).trim();
  return last.length > 0 ? [...args, last] : args;
}

function stripFormulaPrefix(value: string): string {
  return value.trim().replace(/^=/, "");
}

function stripOuterParens(value: string): string {
  let current = value;
  while (current.startsWith("(") && current.endsWith(")") && enclosesWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}

function enclosesWholeExpression(value: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\"") quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function valueToBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = asString(value).trim();
  if (text.length === 0) return false;
  const numericValue = Number(text);
  return Number.isFinite(numericValue) ? numericValue !== 0 : /^TRUE$/i.test(text);
}
