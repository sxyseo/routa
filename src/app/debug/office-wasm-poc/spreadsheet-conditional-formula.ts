import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  columnIndexFromAddress,
  parseCellRange,
  type RecordValue,
} from "./office-preview-utils";

type ConditionalFormulaRange = {
  startColumn: number;
  startRow: number;
};

export type ConditionalFormulaContext = {
  columnIndex: number;
  definedNames?: unknown;
  formulas: unknown;
  range: ConditionalFormulaRange;
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>;
  rowIndex: number;
  tables?: unknown;
};

type CellReference = {
  columnAbsolute: boolean;
  columnIndex: number;
  rowAbsolute: boolean;
  rowIndex: number;
};

type FormulaCellValue = {
  columnIndex: number;
  rowIndex: number;
  value: string;
};

const CELL_REFERENCE_PATTERN = /^(?:'[^']+'|[A-Za-z0-9_ ]+!)?(\$?)([A-Z]{1,3})(\$?)(\d+)$/i;

export function conditionalFormulaMatches(context: ConditionalFormulaContext): boolean {
  const formula = asArray(context.formulas).map(asString).find(Boolean);
  if (!formula) return false;
  return valueToBoolean(evaluateFormulaExpression(stripFormulaPrefix(formula), context));
}

export function conditionalFormulaValue(formula: unknown, context: ConditionalFormulaContext): unknown {
  const expression = asString(formula);
  if (!expression) return "";
  return evaluateFormulaValue(stripFormulaPrefix(expression), context);
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

  const structuredReference = parseStructuredReference(trimmed);
  if (structuredReference) return structuredReferenceValue(structuredReference, context);

  const definedName = definedNameValue(trimmed, context);
  if (definedName != null) return definedName;

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
  if (normalizedName === "ISERROR") {
    return spreadsheetFormulaErrorMatches(asString(evaluateFormulaValue(args[0] ?? "", context)));
  }
  if (normalizedName === "ISNA") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().toUpperCase() === "#N/A";
  }
  if (normalizedName === "ISODD") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) && Math.abs(Math.floor(value)) % 2 === 1;
  }
  if (normalizedName === "ISEVEN") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) && Math.abs(Math.floor(value)) % 2 === 0;
  }
  if (normalizedName === "IF") {
    return valueToBoolean(evaluateFormulaExpression(args[0] ?? "", context))
      ? evaluateFormulaExpression(args[1] ?? "", context)
      : evaluateFormulaExpression(args[2] ?? "FALSE", context);
  }
  if (normalizedName === "IFERROR") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return spreadsheetFormulaErrorMatches(asString(value)) ? evaluateFormulaValue(args[1] ?? "", context) : value;
  }
  if (normalizedName === "LEN") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).length;
  }
  if (normalizedName === "LOWER") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).toLowerCase();
  }
  if (normalizedName === "UPPER") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).toUpperCase();
  }
  if (normalizedName === "TRIM") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().replace(/\s+/g, " ");
  }
  if (normalizedName === "LEFT") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    return value.slice(0, Number.isFinite(count) ? count : 1);
  }
  if (normalizedName === "RIGHT") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    return value.slice(value.length - (Number.isFinite(count) ? count : 1));
  }
  if (normalizedName === "MID") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const start = Math.max(1, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[2] ?? "0", context))));
    return value.slice(start - 1, start - 1 + (Number.isFinite(count) ? count : 0));
  }
  if (normalizedName === "SEARCH" || normalizedName === "FIND") {
    const needle = asString(evaluateFormulaValue(args[0] ?? "", context));
    const haystack = asString(evaluateFormulaValue(args[1] ?? "", context));
    const start = Math.max(1, Math.floor(Number(evaluateFormulaValue(args[2] ?? "1", context))));
    const index = normalizedName === "SEARCH"
      ? haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1)
      : haystack.indexOf(needle, start - 1);
    return index >= 0 ? index + 1 : "#VALUE!";
  }
  if (normalizedName === "ABS") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) ? Math.abs(value) : Number.NaN;
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
  if (normalizedName === "SUM") {
    return formulaNumericArgs(args, context).reduce((sum, value) => sum + value, 0);
  }
  if (normalizedName === "AVERAGE") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
  }
  if (normalizedName === "MIN") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? Math.min(...values) : Number.NaN;
  }
  if (normalizedName === "MAX") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? Math.max(...values) : Number.NaN;
  }
  if (normalizedName === "COUNT") {
    return formulaNumericArgs(args, context).length;
  }
  if (normalizedName === "COUNTIF") {
    return countIf(args, context);
  }
  if (normalizedName === "COUNTIFS") {
    return countIfs(args, context);
  }
  if (normalizedName === "SUMIF") {
    return aggregateIf(args, context, "sum");
  }
  if (normalizedName === "SUMIFS") {
    return aggregateIfs(args, context, "sum");
  }
  if (normalizedName === "AVERAGEIF") {
    return aggregateIf(args, context, "average");
  }
  if (normalizedName === "TODAY") {
    return currentExcelSerialDay();
  }
  if (normalizedName === "DATE") {
    const year = Number(evaluateFormulaValue(args[0] ?? "", context));
    const month = Number(evaluateFormulaValue(args[1] ?? "", context));
    const day = Number(evaluateFormulaValue(args[2] ?? "", context));
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return excelSerialDay(year, month, day);
    }
    return Number.NaN;
  }
  if (normalizedName === "YEAR" || normalizedName === "MONTH" || normalizedName === "DAY" || normalizedName === "WEEKDAY") {
    return excelSerialDatePart(Number(evaluateFormulaValue(args[0] ?? "", context)), normalizedName, Number(evaluateFormulaValue(args[1] ?? "1", context)));
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

function formulaNumericArgs(args: string[], context: ConditionalFormulaContext): number[] {
  const values: number[] = [];
  for (const arg of args) {
    const rangeValues = formulaRangeValues(arg, context);
    if (rangeValues) {
      values.push(...rangeValues.map(Number).filter(Number.isFinite));
      continue;
    }

    const value = Number(evaluateFormulaValue(arg, context));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function formulaRangeValues(expression: string, context: ConditionalFormulaContext): string[] | null {
  const cells = formulaRangeCells(expression, context);
  return cells ? cells.map((cell) => cell.value) : null;
}

function formulaRangeCells(expression: string, context: ConditionalFormulaContext): FormulaCellValue[] | null {
  const target = formulaRangeTarget(expression, context);
  if (!/[A-Z]+\$?\d/i.test(target) && !target.includes(":")) return null;
  const range = parseCellRange(target);
  if (!range) return null;

  const cells: FormulaCellValue[] = [];
  for (const [rowIndex, row] of context.rowsByIndex) {
    if (rowIndex < range.startRow || rowIndex >= range.startRow + range.rowSpan) continue;
    for (const [columnIndex, cell] of row) {
      if (columnIndex < range.startColumn || columnIndex >= range.startColumn + range.columnSpan) continue;
      cells.push({ columnIndex, rowIndex, value: cellText(cell) });
    }
  }
  return cells;
}

function formulaRangeTarget(expression: string, context: ConditionalFormulaContext): string {
  return definedNameTarget(stripFormulaPrefix(expression), context) ?? stripFormulaPrefix(expression);
}

function countIf(args: string[], context: ConditionalFormulaContext): number {
  const cells = formulaRangeCells(args[0] ?? "", context);
  if (!cells) return 0;
  const criterion = formulaCriteria(args[1] ?? "", context);
  return cells.filter((cell) => formulaCriteriaMatches(cell.value, criterion)).length;
}

function countIfs(args: string[], context: ConditionalFormulaContext): number {
  if (args.length < 2 || args.length % 2 !== 0) return 0;
  const firstRange = formulaRange(args[0] ?? "", context);
  const firstCells = firstRange ? formulaRangeCells(args[0] ?? "", context) : null;
  if (!firstRange || !firstCells) return 0;

  const criteria: FormulaCriteriaRange[] = [];
  for (let index = 0; index < args.length; index += 2) {
    const criteriaRange = formulaCriteriaRange(args[index] ?? "", args[index + 1] ?? "", context);
    if (!criteriaRange) return 0;
    criteria.push(criteriaRange);
  }

  return firstCells.filter((cell) => {
    const rowOffset = cell.rowIndex - firstRange.startRow;
    const columnOffset = cell.columnIndex - firstRange.startColumn;
    return criteria.every((item) => formulaCriteriaRangeMatches(item, rowOffset, columnOffset));
  }).length;
}

type FormulaCriteriaRange = {
  cellsByOffset: Map<string, string>;
  criterion: { operator: string; value: unknown };
  range: NonNullable<ReturnType<typeof parseCellRange>>;
};

function aggregateIf(args: string[], context: ConditionalFormulaContext, kind: "average" | "sum"): number {
  const criteriaRange = formulaCriteriaRange(args[0] ?? "", args[1] ?? "", context);
  if (!criteriaRange) return kind === "sum" ? 0 : Number.NaN;

  const sumRange = formulaRange(args[2] ?? "", context) ?? criteriaRange.range;
  const sumCells = formulaRangeCells(args[2] ?? args[0] ?? "", context);
  if (!sumCells) return kind === "sum" ? 0 : Number.NaN;
  const sumByOffset = cellsByOffset(sumCells, sumRange);
  const values = numericValuesMatchingCriteria(criteriaRange, sumByOffset);
  return aggregateNumericValues(values, kind);
}

function aggregateIfs(args: string[], context: ConditionalFormulaContext, kind: "sum"): number {
  if (args.length < 3 || args.length % 2 !== 1) return 0;
  const sumRange = formulaRange(args[0] ?? "", context);
  const sumCells = formulaRangeCells(args[0] ?? "", context);
  if (!sumRange || !sumCells) return 0;
  const sumByOffset = cellsByOffset(sumCells, sumRange);

  const criteria: FormulaCriteriaRange[] = [];
  for (let index = 1; index < args.length; index += 2) {
    const criteriaRange = formulaCriteriaRange(args[index] ?? "", args[index + 1] ?? "", context);
    if (!criteriaRange) return 0;
    criteria.push(criteriaRange);
  }

  const values: number[] = [];
  for (const [key, rawValue] of sumByOffset) {
    const [rowOffsetText, columnOffsetText] = key.split(":");
    const rowOffset = Number(rowOffsetText);
    const columnOffset = Number(columnOffsetText);
    if (!Number.isFinite(rowOffset) || !Number.isFinite(columnOffset)) continue;
    if (!criteria.every((item) => formulaCriteriaRangeMatches(item, rowOffset, columnOffset))) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) values.push(value);
  }
  return aggregateNumericValues(values, kind);
}

function numericValuesMatchingCriteria(criteriaRange: FormulaCriteriaRange, valuesByOffset: ReadonlyMap<string, string>): number[] {
  const values: number[] = [];
  for (const [key, candidate] of criteriaRange.cellsByOffset) {
    if (!formulaCriteriaMatches(candidate, criteriaRange.criterion)) continue;
    const value = Number(valuesByOffset.get(key) ?? "");
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function aggregateNumericValues(values: number[], kind: "average" | "sum"): number {
  if (kind === "average") return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
  return values.reduce((sum, value) => sum + value, 0);
}

function formulaCriteriaRange(rangeExpression: string, criterionExpression: string, context: ConditionalFormulaContext): FormulaCriteriaRange | null {
  const range = formulaRange(rangeExpression, context);
  const cells = formulaRangeCells(rangeExpression, context);
  if (!range || !cells) return null;
  return {
    cellsByOffset: cellsByOffset(cells, range),
    criterion: formulaCriteria(criterionExpression, context),
    range,
  };
}

function formulaCriteriaRangeMatches(criteriaRange: FormulaCriteriaRange, rowOffset: number, columnOffset: number): boolean {
  const value = criteriaRange.cellsByOffset.get(`${rowOffset}:${columnOffset}`) ?? "";
  return formulaCriteriaMatches(value, criteriaRange.criterion);
}

function formulaRange(expression: string, context: ConditionalFormulaContext): ReturnType<typeof parseCellRange> {
  return parseCellRange(formulaRangeTarget(expression, context));
}

function cellsByOffset(cells: FormulaCellValue[], range: NonNullable<ReturnType<typeof parseCellRange>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const cell of cells) {
    map.set(`${cell.rowIndex - range.startRow}:${cell.columnIndex - range.startColumn}`, cell.value);
  }
  return map;
}

function formulaCriteria(expression: string, context: ConditionalFormulaContext): { operator: string; value: unknown } {
  const value = evaluateFormulaValue(expression, context);
  const text = asString(value);
  const match = text.match(/^(>=|<=|<>|=|>|<)(.*)$/);
  if (!match) return { operator: "=", value };
  return {
    operator: match[1],
    value: match[2],
  };
}

function formulaCriteriaMatches(value: string, criterion: { operator: string; value: unknown }): boolean {
  const rawExpected = asString(criterion.value);
  const actualNumber = Number(value);
  const expectedNumber = Number(rawExpected);
  const numeric = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && rawExpected.trim().length > 0;
  const actual = numeric ? actualNumber : value.toLowerCase();
  const expected = numeric ? expectedNumber : rawExpected.toLowerCase();

  if (!numeric && /[*?]/.test(rawExpected)) {
    const wildcard = new RegExp(`^${escapeRegExp(rawExpected).replaceAll("\\*", ".*").replaceAll("\\?", ".")}$`, "i");
    return criterion.operator === "<>" ? !wildcard.test(value) : wildcard.test(value);
  }

  if (criterion.operator === "=") return actual === expected;
  if (criterion.operator === "<>") return actual !== expected;
  if (criterion.operator === ">") return actual > expected;
  if (criterion.operator === ">=") return actual >= expected;
  if (criterion.operator === "<") return actual < expected;
  if (criterion.operator === "<=") return actual <= expected;
  return false;
}

function spreadsheetFormulaErrorMatches(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return normalized === "#DIV/0!" ||
    normalized === "#N/A" ||
    normalized === "#NAME?" ||
    normalized === "#NULL!" ||
    normalized === "#NUM!" ||
    normalized === "#REF!" ||
    normalized === "#VALUE!" ||
    normalized === "#SPILL!" ||
    normalized === "#CALC!" ||
    normalized === "#FIELD!" ||
    normalized === "#GETTING_DATA";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function parseStructuredReference(value: string): { columnName: string; tableName: string } | null {
  const currentRowMatch = value.match(/^(?:(.+))?\[@([^\]]+)\]$/);
  if (currentRowMatch) {
    return {
      columnName: cleanStructuredReferenceName(currentRowMatch[2]),
      tableName: cleanStructuredReferenceName(currentRowMatch[1]),
    };
  }

  const thisRowMatch = value.match(/^(?:(.+))?\[\[#This Row\],\[([^\]]+)\]\]$/i);
  if (thisRowMatch) {
    return {
      columnName: cleanStructuredReferenceName(thisRowMatch[2]),
      tableName: cleanStructuredReferenceName(thisRowMatch[1]),
    };
  }

  const columnMatch = value.match(/^(.+)\[([^\]#@][^\]]*)\]$/);
  if (!columnMatch) return null;
  return {
    columnName: cleanStructuredReferenceName(columnMatch[2]),
    tableName: cleanStructuredReferenceName(columnMatch[1]),
  };
}

function structuredReferenceValue(
  reference: { columnName: string; tableName: string },
  context: ConditionalFormulaContext,
): string {
  const table = structuredReferenceTable(reference.tableName, context);
  if (!table || !reference.columnName) return "";

  const tableRange = parseCellRange(asString(table.reference) || asString(table.ref));
  if (!tableRange) return "";

  const headerRowCount = Math.max(0, asNumber(table.headerRowCount, 1));
  const totalsRowCount = Math.max(0, asNumber(table.totalsRowCount, table.totalsRowShown === true ? 1 : 0));
  const dataStartRow = tableRange.startRow + headerRowCount;
  const dataEndRow = tableRange.startRow + tableRange.rowSpan - totalsRowCount - 1;
  if (context.rowIndex < dataStartRow || context.rowIndex > dataEndRow) return "";

  const columnIndex = structuredReferenceColumnIndex(table, tableRange, reference.columnName, context);
  if (columnIndex == null) return "";
  return cellText(context.rowsByIndex.get(context.rowIndex)?.get(columnIndex) ?? null);
}

function structuredReferenceTable(tableName: string, context: ConditionalFormulaContext): RecordValue | null {
  const normalizedName = tableName.toLowerCase();
  for (const candidate of asArray(context.tables).map(asRecord).filter((table): table is RecordValue => table != null)) {
    const tableRange = parseCellRange(asString(candidate.reference) || asString(candidate.ref));
    if (!tableRange) continue;
    const candidateNames = [asString(candidate.name), asString(candidate.displayName)].map((name) => name.toLowerCase());
    const nameMatches = normalizedName.length > 0 && candidateNames.includes(normalizedName);
    const rowMatches = context.rowIndex >= tableRange.startRow && context.rowIndex < tableRange.startRow + tableRange.rowSpan;
    const columnMatches = context.columnIndex >= tableRange.startColumn &&
      context.columnIndex < tableRange.startColumn + tableRange.columnSpan;
    if (nameMatches || (!normalizedName && rowMatches && columnMatches)) return candidate;
  }
  return null;
}

function structuredReferenceColumnIndex(
  table: RecordValue,
  tableRange: NonNullable<ReturnType<typeof parseCellRange>>,
  columnName: string,
  context: ConditionalFormulaContext,
): number | null {
  const normalizedName = columnName.toLowerCase();
  const columnRecords = asArray(table.columns).map(asRecord).filter((column): column is RecordValue => column != null);
  const recordIndex = columnRecords.findIndex((column) => asString(column.name).toLowerCase() === normalizedName);
  if (recordIndex >= 0) return tableRange.startColumn + recordIndex;

  const headerCells = context.rowsByIndex.get(tableRange.startRow);
  for (let offset = 0; offset < tableRange.columnSpan; offset += 1) {
    const columnIndex = tableRange.startColumn + offset;
    if (cellText(headerCells?.get(columnIndex) ?? null).toLowerCase() === normalizedName) return columnIndex;
  }

  return null;
}

function definedNameValue(name: string, context: ConditionalFormulaContext): string | null {
  if (!/^[A-Z_][A-Z0-9_.]*$/i.test(name)) return null;
  const target = definedNameTarget(name, context);
  if (!target) return "";

  const range = /[A-Z]+\$?\d/i.test(target) ? parseCellRange(target) : null;
  if (range) {
    return cellText(context.rowsByIndex.get(range.startRow)?.get(range.startColumn) ?? null);
  }

  return target;
}

function definedNameTarget(name: string, context: ConditionalFormulaContext): string | null {
  const normalizedName = name.toLowerCase();
  const records = definedNameRecords(context.definedNames);
  const record = records.find((item) => asString(item.name).toLowerCase() === normalizedName);
  if (!record) return null;
  const target = asString(record.text) || asString(record.formula) || asString(record.value) || asString(record.reference);
  return target ? stripFormulaPrefix(target) : "";
}

function definedNameRecords(definedNames: unknown): RecordValue[] {
  const wrapper = asRecord(definedNames);
  return [
    ...asArray(definedNames),
    ...asArray(wrapper?.items),
    ...asArray(wrapper?.definedNames),
  ].map(asRecord).filter((item): item is RecordValue => item != null);
}

function cleanStructuredReferenceName(value: unknown): string {
  return asString(value).trim().replace(/^'|'$/g, "");
}

const DAY_MS = 86_400_000;
const EXCEL_SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function currentExcelSerialDay(): number {
  const now = new Date();
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - EXCEL_SERIAL_EPOCH_UTC) / DAY_MS);
}

function excelSerialDay(year: number, month: number, day: number): number {
  return Math.floor((Date.UTC(year, month - 1, day) - EXCEL_SERIAL_EPOCH_UTC) / DAY_MS);
}

function excelSerialDatePart(value: number, part: string, weekdayReturnType: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const date = new Date(EXCEL_SERIAL_EPOCH_UTC + Math.floor(value) * DAY_MS);
  if (part === "YEAR") return date.getUTCFullYear();
  if (part === "MONTH") return date.getUTCMonth() + 1;
  if (part === "DAY") return date.getUTCDate();
  const weekday = date.getUTCDay();
  if (weekdayReturnType === 2) return weekday === 0 ? 7 : weekday;
  if (weekdayReturnType === 3) return weekday === 0 ? 6 : weekday - 1;
  return weekday + 1;
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
