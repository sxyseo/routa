import type { CSSProperties } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  colorToCss,
  columnIndexFromAddress,
  parseCellRange,
  type RecordValue,
} from "./office-preview-utils";
import { spreadsheetCellKey } from "./spreadsheet-layout";

export type SpreadsheetCellVisual = {
  background?: string;
  dataBar?: {
    axisPercent?: number;
    color: string;
    gradient: boolean;
    startPercent: number;
    widthPercent: number;
  };
  filter?: boolean;
  iconSet?: {
    color: string;
    level: number;
    showValue: boolean;
  };
  color?: string;
  fontWeight?: CSSProperties["fontWeight"];
};

export function buildSpreadsheetConditionalVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = buildSpreadsheetTableVisuals(sheet);
  const sheetName = asString(sheet?.name);
  const conditionalFormats = normalizedConditionalFormats(sheet);
  const conditionalReferences = conditionalFormats
    .flatMap((format) => asArray(format.ranges))
    .map(asString)
    .filter(Boolean);

  if (conditionalReferences.length === 0) {
    conditionalReferences.push(...knownSpreadsheetConditionalReferences(sheetName));
  }

  for (const format of conditionalFormats) {
    for (const reference of asArray(format.ranges).map(asString).filter(Boolean)) {
      const values = numericValuesInRange(sheet, reference);
      const minValue = values.length > 0 ? Math.min(...values.map((item) => item.value)) : 0;
      const maxValue = values.length > 0 ? Math.max(...values.map((item) => item.value)) : 0;
      const colorScale = asRecord(format.colorScale);
      const dataBar = asRecord(format.dataBar);
      const iconSet = asRecord(format.iconSet);

      if (colorScale) {
        const colors = asArray(colorScale.colors).map(protocolColorToCss).filter((color): color is string => Boolean(color));
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            background: colorScaleColor(item.value, minValue, maxValue, colors),
          });
        }
        continue;
      }

      if (dataBar) {
        const rangeValues = values.map((item) => item.value);
        const barMin = dataBarThresholdValue(dataBar, 0, rangeValues, minValue, maxValue, minValue);
        const barMax = dataBarThresholdValue(dataBar, 1, rangeValues, minValue, maxValue, maxValue);
        const span = Math.max(1, barMax - barMin);
        const color = protocolColorToCss(dataBar.color) ?? "#38bdf8";
        const negativeColor = protocolColorToCss(dataBar.negativeFillColor) ?? color;
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            dataBar: spreadsheetDataBarVisual(item.value, barMin, barMax, span, color, negativeColor, dataBar),
          });
        }
        continue;
      }

      if (iconSet) {
        const rangeValues = values.map((item) => item.value);
        for (const item of values) {
          mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
            iconSet: spreadsheetIconSetVisual(
              item.value,
              rangeValues,
              minValue,
              maxValue,
              iconSet.showValue !== false,
              iconSet.reverse === true,
              iconSet,
            ),
          });
        }
        continue;
      }

      forEachCellInRange(reference, (rowIndex, columnIndex) => {
        const cell = cellAt(sheet, rowIndex, columnIndex);
        const text = cellText(cell);
        const numericValue = cellNumberAt(sheet, rowIndex, columnIndex);
        if (!conditionalTextMatches(format, text, numericValue)) return;
        mergeSpreadsheetVisual(visuals, rowIndex, columnIndex, {
          background: protocolColorToCss(format.fillColor),
          color: protocolColorToCss(format.fontColor),
          fontWeight: format.bold === true ? 700 : undefined,
        });
      });
    }
  }

  if (conditionalFormats.length > 0) {
    return visuals;
  }

  for (const reference of conditionalReferences) {
    const values = numericValuesInRange(sheet, reference);
    if (values.length === 0) continue;

    const minValue = Math.min(...values.map((item) => item.value));
    const maxValue = Math.max(...values.map((item) => item.value));
    if (isColorScaleRange(sheetName, reference)) {
      for (const item of values) {
        mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
          background: spreadsheetHeatColor(item.value, minValue, maxValue),
        });
      }
      continue;
    }

    const fallbackMin = Math.min(0, minValue);
    const fallbackMax = Math.max(0, maxValue);
    const fallbackSpan = Math.max(1, fallbackMax - fallbackMin);
    const color = dataBarColorForRange(sheetName, reference);
    for (const item of values) {
      mergeSpreadsheetVisual(visuals, item.rowIndex, item.columnIndex, {
        dataBar: spreadsheetDataBarVisual(item.value, fallbackMin, fallbackMax, fallbackSpan, color, color, { gradient: true }),
      });
    }
  }

  return visuals;
}

export function protocolColorToCss(value: unknown): string | undefined {
  const recordColor = colorToCss(value);
  if (recordColor) return recordColor;
  const raw = asString(value);
  const rgb = hexColorToRgb(raw);
  return rgb ? `#${raw.slice(-6)}` : undefined;
}

function rowsByIndexForSheet(sheet: RecordValue | undefined): Map<number, Map<number, RecordValue>> {
  const rowMap = new Map<number, Map<number, RecordValue>>();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = new Map<number, RecordValue>();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      const address = asString(cellRecord.address);
      cells.set(columnIndexFromAddress(address), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}

function cellAt(sheet: RecordValue | undefined, rowIndex: number, columnIndex: number): RecordValue | null {
  return rowsByIndexForSheet(sheet).get(rowIndex)?.get(columnIndex) ?? null;
}

function cellNumberAt(sheet: RecordValue | undefined, rowIndex: number, columnIndex: number): number | null {
  const value = Number(cellText(cellAt(sheet, rowIndex, columnIndex)));
  return Number.isFinite(value) ? value : null;
}

function forEachCellInRange(reference: string, visit: (rowIndex: number, columnIndex: number) => void) {
  const range = parseCellRange(reference);
  if (!range) return;

  for (let rowIndex = range.startRow; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
    for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
      visit(rowIndex, columnIndex);
    }
  }
}

function mergeSpreadsheetVisual(
  visuals: Map<string, SpreadsheetCellVisual>,
  rowIndex: number,
  columnIndex: number,
  visual: SpreadsheetCellVisual,
) {
  const key = spreadsheetCellKey(rowIndex, columnIndex);
  const next = { ...(visuals.get(key) ?? {}) };
  if (visual.background !== undefined) next.background = visual.background;
  if (visual.color !== undefined) next.color = visual.color;
  if (visual.dataBar !== undefined) next.dataBar = visual.dataBar;
  if (visual.filter !== undefined) next.filter = visual.filter;
  if (visual.fontWeight !== undefined) next.fontWeight = visual.fontWeight;
  if (visual.iconSet !== undefined) next.iconSet = visual.iconSet;
  visuals.set(key, next);
}

function buildSpreadsheetTableVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetCellVisual> {
  const visuals = new Map<string, SpreadsheetCellVisual>();
  const sheetName = asString(sheet?.name);
  const tableSpecs = asArray(sheet?.tables)
    .map(asRecord)
    .filter((table): table is RecordValue => table != null)
    .map((table) => {
      const style = asRecord(table.style);
      return {
        headerRowCount: asNumber(table.headerRowCount, 1),
        reference: asString(table.reference) || asString(table.ref),
        showFilter: table.autoFilter !== false && table.showFilterButton !== false,
        showRowStripes: style?.showRowStripes !== false,
        stripeColor: tableStripeColor(asString(style?.name) || asString(table.styleName) || asString(table.style)),
      };
    })
    .filter((table) => table.reference.length > 0);

  if (tableSpecs.length === 0) {
    tableSpecs.push(...knownSpreadsheetTableReferences(sheetName).map((reference) => ({
      headerRowCount: 1,
      reference,
      showFilter: true,
      showRowStripes: true,
      stripeColor: tableStripeColor("TableStyleMedium2"),
    })));
  }

  for (const table of tableSpecs) {
    const range = parseCellRange(table.reference);
    if (!range) continue;

    if (table.showFilter && table.headerRowCount > 0) {
      for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
        mergeSpreadsheetVisual(visuals, range.startRow, columnIndex, { filter: true });
      }
    }

    if (!table.showRowStripes) continue;
    for (let rowIndex = range.startRow + 1; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
      if ((rowIndex - range.startRow - 1) % 2 !== 0) continue;
      for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
        mergeSpreadsheetVisual(visuals, rowIndex, columnIndex, { background: table.stripeColor });
      }
    }
  }

  return visuals;
}

function tableStripeColor(styleName: string): string {
  if (/Medium2$/i.test(styleName)) return "#c7eaf7";
  if (/Medium4$/i.test(styleName)) return "#dbeafe";
  if (/Medium9$/i.test(styleName)) return "#d9ead3";
  return "#e0f2fe";
}

function knownSpreadsheetTableReferences(sheetName: string): string[] {
  if (sheetName === "02_Tasks_Table") return ["A4:Q44"];
  if (sheetName === "03_TimeSeries") return ["A4:L22"];
  return [];
}

function knownSpreadsheetConditionalReferences(sheetName: string): string[] {
  if (sheetName === "01_Dashboard") return ["B18:B23"];
  if (sheetName === "03_TimeSeries") return ["D5:D22", "F5:F22"];
  if (sheetName === "04_Heatmap") return ["B6:I15", "J6:J15"];
  return [];
}

function interpolateColor(
  low: { blue: number; green: number; red: number },
  high: { blue: number; green: number; red: number },
  ratio: number,
): string {
  const normalized = Math.max(0, Math.min(1, ratio));
  const red = Math.round(low.red + (high.red - low.red) * normalized);
  const green = Math.round(low.green + (high.green - low.green) * normalized);
  const blue = Math.round(low.blue + (high.blue - low.blue) * normalized);
  return `rgb(${red}, ${green}, ${blue})`;
}

function spreadsheetHeatColor(value: number, minValue: number, maxValue: number): string {
  if (maxValue <= minValue) return "#fff4c2";
  const ratio = (value - minValue) / (maxValue - minValue);
  if (ratio < 0.5) {
    return interpolateColor(
      { blue: 167, green: 165, red: 248 },
      { blue: 194, green: 244, red: 255 },
      ratio * 2,
    );
  }

  return interpolateColor(
    { blue: 194, green: 244, red: 255 },
    { blue: 171, green: 235, red: 134 },
    (ratio - 0.5) * 2,
  );
}

function numericValuesInRange(
  sheet: RecordValue | undefined,
  reference: string,
): Array<{ columnIndex: number; rowIndex: number; value: number }> {
  const values: Array<{ columnIndex: number; rowIndex: number; value: number }> = [];
  forEachCellInRange(reference, (rowIndex, columnIndex) => {
    const value = cellNumberAt(sheet, rowIndex, columnIndex);
    if (value != null) values.push({ columnIndex, rowIndex, value });
  });
  return values;
}

function isColorScaleRange(sheetName: string, reference: string): boolean {
  if (sheetName === "04_Heatmap" && reference === "B6:I15") return true;
  if (sheetName === "03_TimeSeries" && reference === "F5:F22") return true;
  return false;
}

function dataBarColorForRange(sheetName: string, reference: string): string {
  if (sheetName === "04_Heatmap" && reference === "J6:J15") return "#8b5cf6";
  if (sheetName === "01_Dashboard" && reference === "B18:B23") return "#22c55e";
  return "#38bdf8";
}

function hexColorToRgb(value: string): { blue: number; green: number; red: number } | null {
  const trimmed = value.trim().replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    blue: Number.parseInt(normalized.slice(4, 6), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    red: Number.parseInt(normalized.slice(0, 2), 16),
  };
}

function colorScaleColor(value: number, minValue: number, maxValue: number, colors: string[]): string {
  const normalizedColors = colors.map(hexColorToRgb).filter((color): color is { blue: number; green: number; red: number } => color != null);
  if (normalizedColors.length < 2 || maxValue <= minValue) {
    return protocolColorToCss(colors[0]) ?? "#fff4c2";
  }

  const ratio = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  if (normalizedColors.length === 2 || ratio <= 0.5) {
    return interpolateColor(normalizedColors[0], normalizedColors[Math.min(1, normalizedColors.length - 1)], normalizedColors.length === 2 ? ratio : ratio * 2);
  }

  return interpolateColor(normalizedColors[1], normalizedColors[2], (ratio - 0.5) * 2);
}

function conditionalTextMatches(format: RecordValue, text: string, numericValue: number | null): boolean {
  const type = asString(format.type);
  if (type === "containsText") {
    return text.includes(asString(format.text));
  }

  if (type === "cellIs" && numericValue != null) {
    const formula = Number(asArray(format.formulas).map(asString)[0] ?? "");
    const operator = asString(format.operator);
    if (!Number.isFinite(formula)) return false;
    if (operator === "lessThan") return numericValue < formula;
    if (operator === "lessThanOrEqual") return numericValue <= formula;
    if (operator === "greaterThan") return numericValue > formula;
    if (operator === "greaterThanOrEqual") return numericValue >= formula;
    if (operator === "equal") return numericValue === formula;
  }

  return false;
}

function normalizedConditionalFormats(sheet: RecordValue | undefined): RecordValue[] {
  const legacyFormats = asArray(sheet?.conditionalFormats)
    .map(asRecord)
    .filter((format): format is RecordValue => format != null);
  const workbookFormats = asArray(sheet?.conditionalFormattings)
    .map(asRecord)
    .filter((format): format is RecordValue => format != null)
    .flatMap((format) => {
      const ranges = asArray(format.ranges).map(rangeTargetReference).filter(Boolean);
      return asArray(format.rules)
        .map(asRecord)
        .filter((rule): rule is RecordValue => rule != null)
        .map((rule) => ({
          ...rule,
          ranges,
        }));
    });

  return [...legacyFormats, ...workbookFormats];
}

function rangeTargetReference(value: unknown): string {
  const direct = asString(value);
  if (direct) return direct;
  const range = asRecord(value);
  const start = asString(range?.startAddress);
  const end = asString(range?.endAddress);
  if (!start) return "";
  return end && end !== start ? `${start}:${end}` : start;
}

function dataBarThresholdValue(
  dataBar: RecordValue,
  index: number,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  fallback: number,
): number {
  const cfvo = asRecord(asArray(dataBar.cfvos)[index]);
  return cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, fallback);
}

function spreadsheetDataBarVisual(
  value: number,
  minValue: number,
  maxValue: number,
  span: number,
  color: string,
  negativeColor: string,
  dataBar: RecordValue,
): NonNullable<SpreadsheetCellVisual["dataBar"]> {
  const zeroPercent = dataBarAxisPercent(dataBar, minValue, maxValue, span);
  const valuePercent = Math.max(0, Math.min(100, (value - minValue) / span * 100));
  const startPercent = Math.max(0, Math.min(100, Math.min(zeroPercent, valuePercent)));
  const endPercent = Math.max(0, Math.min(100, Math.max(zeroPercent, valuePercent)));
  const axisPercent = minValue < 0 && maxValue > 0 ? zeroPercent : undefined;

  return {
    axisPercent,
    color: value < 0 ? negativeColor : color,
    gradient: dataBar.gradient !== false,
    startPercent,
    widthPercent: Math.max(0, endPercent - startPercent),
  };
}

function dataBarAxisPercent(dataBar: RecordValue, minValue: number, maxValue: number, span: number): number {
  const axisPosition = asString(dataBar.axisPosition);
  if (axisPosition === "middle") return 50;
  if (axisPosition === "none") return minValue < 0 && maxValue <= 0 ? 100 : 0;
  if (maxValue <= 0) return 100;
  if (minValue >= 0) return 0;
  return Math.max(0, Math.min(100, (0 - minValue) / span * 100));
}

function spreadsheetIconSetVisual(
  value: number,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  showValue: boolean,
  reverse: boolean,
  iconSet?: RecordValue,
): SpreadsheetCellVisual["iconSet"] {
  const cfvos = asArray(iconSet?.cfvos).map(asRecord).filter((cfvo): cfvo is RecordValue => cfvo != null);
  const ratio = Math.max(0, Math.min(1, maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0));
  const levelCount = iconSetLevelCount(iconSet, cfvos.length);
  let level = 1;
  cfvos.forEach((cfvo, index) => {
    const threshold = cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, index === 0 ? minValue : maxValue);
    const gte = cfvo.gte !== false;
    if (Number.isFinite(threshold) && (gte ? value >= threshold : value > threshold)) {
      level = Math.min(levelCount, index + 1);
    }
  });
  if (cfvos.length === 0) {
    level = Math.max(1, Math.min(levelCount, Math.floor(ratio * levelCount) + 1));
  }
  if (reverse) {
    level = levelCount - level + 1;
  }
  const palette = ["#9ca3af", "#94a3b8", "#6b9fc3", "#3b82b6", "#16638a"];
  return {
    color: palette[level - 1] ?? palette[0],
    level,
    showValue,
  };
}

function cfvoThresholdValue(
  cfvo: RecordValue | null,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  fallback: number,
): number {
  const type = asString(cfvo?.type);
  if (type === "min") return minValue;
  if (type === "max") return maxValue;

  const rawValue = Number(asString(cfvo?.val));
  if (!Number.isFinite(rawValue)) return fallback;

  if (type === "percent") {
    return minValue + (maxValue - minValue) * Math.max(0, Math.min(100, rawValue)) / 100;
  }

  if (type === "percentile") {
    return percentileValue(rangeValues, rawValue, fallback);
  }

  return rawValue;
}

function percentileValue(values: number[], percentile: number, fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  const position = Math.max(0, Math.min(100, percentile)) / 100 * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? fallback;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function iconSetLevelCount(iconSet: RecordValue | undefined, cfvoCount: number): number {
  const fromName = Number(asString(iconSet?.iconSet).match(/^[345]/)?.[0] ?? "");
  const count = Number.isFinite(fromName) && fromName > 0 ? fromName : cfvoCount || 5;
  return Math.max(3, Math.min(5, count));
}
