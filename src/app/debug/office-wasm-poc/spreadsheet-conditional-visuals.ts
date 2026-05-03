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
    iconSet: string;
    level: number;
    levelCount: number;
    showValue: boolean;
  };
  color?: string;
  fontWeight?: CSSProperties["fontWeight"];
};

export type SpreadsheetCellVisualLookup = {
  get(key: string): SpreadsheetCellVisual | undefined;
};

type SpreadsheetTableVisualSpec = {
  bodyEndRow: number;
  bodyStartRow: number;
  headerRowCount: number;
  lastColumnIndex: number;
  palette: { columnStripe: string; rowStripe: string; total: string };
  range: NonNullable<ReturnType<typeof parseCellRange>>;
  showColumnStripes: boolean;
  showFilter: boolean;
  showFirstColumn: boolean;
  showLastColumn: boolean;
  showRowStripes: boolean;
  totalsStartRow: number;
};

type SpreadsheetCellRange = NonNullable<ReturnType<typeof parseCellRange>>;

type SpreadsheetConditionalVisualSpec =
  | {
    kind: "colorScale";
    range: SpreadsheetCellRange;
    stops: ColorScaleStop[];
  }
  | {
    barMax: number;
    barMin: number;
    color: string;
    dataBar: RecordValue;
    kind: "dataBar";
    negativeColor: string;
    range: SpreadsheetCellRange;
    span: number;
  }
  | {
    iconSet: RecordValue;
    kind: "iconSet";
    maxValue: number;
    minValue: number;
    range: SpreadsheetCellRange;
    rangeValues: number[];
  }
  | {
    format: RecordValue;
    kind: "format";
    range: SpreadsheetCellRange;
  }
  | {
    kind: "fallbackColorScale";
    maxValue: number;
    minValue: number;
    range: SpreadsheetCellRange;
  }
  | {
    color: string;
    kind: "fallbackDataBar";
    maxValue: number;
    minValue: number;
    range: SpreadsheetCellRange;
    span: number;
  };

const MAX_CELL_VISUAL_CACHE_SIZE = 5_000;

export function buildSpreadsheetConditionalVisuals(
  sheet: RecordValue | undefined,
  theme?: RecordValue | null,
): SpreadsheetCellVisualLookup {
  const tableVisuals = buildSpreadsheetTableVisuals(sheet, theme);
  const conditionalVisuals: SpreadsheetConditionalVisualSpec[] = [];
  const rowsByIndex = rowsByIndexForSheet(sheet);
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
      const range = parseCellRange(reference);
      if (!range) continue;
      const values = numericValuesInRange(rowsByIndex, reference);
      const minValue = values.length > 0 ? Math.min(...values.map((item) => item.value)) : 0;
      const maxValue = values.length > 0 ? Math.max(...values.map((item) => item.value)) : 0;
      const colorScale = asRecord(format.colorScale);
      const dataBar = asRecord(format.dataBar);
      const iconSet = asRecord(format.iconSet);

      if (colorScale) {
        const colors = asArray(colorScale.colors).map(protocolColorToCss).filter((color): color is string => Boolean(color));
        const rangeValues = values.map((item) => item.value);
        const stops = colorScaleStops(colorScale, rangeValues, minValue, maxValue, colors);
        conditionalVisuals.push({ kind: "colorScale", range, stops });
        continue;
      }

      if (dataBar) {
        const rangeValues = values.map((item) => item.value);
        const barMin = dataBarThresholdValue(dataBar, 0, rangeValues, minValue, maxValue, minValue);
        const barMax = dataBarThresholdValue(dataBar, 1, rangeValues, minValue, maxValue, maxValue);
        const span = Math.max(1, barMax - barMin);
        const color = protocolColorToCss(dataBar.color) ?? "#38bdf8";
        const negativeColor = protocolColorToCss(dataBar.negativeFillColor) ?? color;
        conditionalVisuals.push({ barMax, barMin, color, dataBar, kind: "dataBar", negativeColor, range, span });
        continue;
      }

      if (iconSet) {
        const rangeValues = values.map((item) => item.value);
        conditionalVisuals.push({ iconSet, kind: "iconSet", maxValue, minValue, range, rangeValues });
        continue;
      }

      conditionalVisuals.push({ format, kind: "format", range });
    }
  }

  if (conditionalFormats.length > 0) {
    return spreadsheetVisualLookup(tableVisuals, conditionalVisuals, rowsByIndex);
  }

  for (const reference of conditionalReferences) {
    const range = parseCellRange(reference);
    if (!range) continue;
    const values = numericValuesInRange(rowsByIndex, reference);
    if (values.length === 0) continue;

    const minValue = Math.min(...values.map((item) => item.value));
    const maxValue = Math.max(...values.map((item) => item.value));
    if (isColorScaleRange(sheetName, reference)) {
      conditionalVisuals.push({ kind: "fallbackColorScale", maxValue, minValue, range });
      continue;
    }

    const fallbackMin = Math.min(0, minValue);
    const fallbackMax = Math.max(0, maxValue);
    const fallbackSpan = Math.max(1, fallbackMax - fallbackMin);
    const color = dataBarColorForRange(sheetName, reference);
    conditionalVisuals.push({
      color,
      kind: "fallbackDataBar",
      maxValue: fallbackMax,
      minValue: fallbackMin,
      range,
      span: fallbackSpan,
    });
  }

  return spreadsheetVisualLookup(tableVisuals, conditionalVisuals, rowsByIndex);
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

function cellAt(
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>,
  rowIndex: number,
  columnIndex: number,
): RecordValue | null {
  return rowsByIndex.get(rowIndex)?.get(columnIndex) ?? null;
}

function cellNumberAt(
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>,
  rowIndex: number,
  columnIndex: number,
): number | null {
  const cell = cellAt(rowsByIndex, rowIndex, columnIndex);
  if (!cell) return null;
  const text = cellText(cell);
  if (text.trim().length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function buildSpreadsheetTableVisuals(
  sheet: RecordValue | undefined,
  theme?: RecordValue | null,
): SpreadsheetTableVisualSpec[] {
  const sheetName = asString(sheet?.name);
  const tableSpecs = asArray(sheet?.tables)
    .map(asRecord)
    .filter((table): table is RecordValue => table != null)
    .map((table) => {
      const style = asRecord(table.style);
      const styleName = asString(style?.name) || asString(table.styleName) || asString(table.style);
      return {
        headerRowCount: asNumber(table.headerRowCount, 1),
        palette: tableStylePalette(styleName, theme),
        reference: asString(table.reference) || asString(table.ref),
        showFilter: table.autoFilter !== false && table.showFilterButton !== false,
        showColumnStripes: style?.showColumnStripes === true,
        showFirstColumn: style?.showFirstColumn === true,
        showLastColumn: style?.showLastColumn === true,
        showRowStripes: style?.showRowStripes !== false,
        totalsRowCount: asNumber(table.totalsRowCount, table.totalsRowShown === true ? 1 : 0),
      };
    })
    .filter((table) => table.reference.length > 0);

  if (tableSpecs.length === 0) {
    tableSpecs.push(...knownSpreadsheetTableReferences(sheetName).map((reference) => ({
      headerRowCount: 1,
      palette: tableStylePalette("TableStyleMedium2", theme),
      reference,
      showFilter: true,
      showColumnStripes: false,
      showFirstColumn: false,
      showLastColumn: false,
      showRowStripes: true,
      totalsRowCount: 0,
    })));
  }

  const visualSpecs: SpreadsheetTableVisualSpec[] = [];
  for (const table of tableSpecs) {
    const range = parseCellRange(table.reference);
    if (!range) continue;

    const headerRowCount = Math.max(0, table.headerRowCount);
    const totalsRowCount = Math.max(0, table.totalsRowCount);
    const bodyStartRow = range.startRow + headerRowCount;
    const bodyEndRow = Math.max(bodyStartRow, range.startRow + range.rowSpan - totalsRowCount);
    const lastColumnIndex = range.startColumn + range.columnSpan - 1;
    visualSpecs.push({
      bodyEndRow,
      bodyStartRow,
      headerRowCount,
      lastColumnIndex,
      palette: table.palette,
      range,
      showColumnStripes: table.showColumnStripes,
      showFilter: table.showFilter,
      showFirstColumn: table.showFirstColumn,
      showLastColumn: table.showLastColumn,
      showRowStripes: table.showRowStripes,
      totalsStartRow: bodyEndRow,
    });
  }

  return visualSpecs;
}

function spreadsheetVisualLookup(
  tableVisuals: SpreadsheetTableVisualSpec[],
  conditionalVisuals: SpreadsheetConditionalVisualSpec[],
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>,
): SpreadsheetCellVisualLookup {
  const visualCache = new Map<string, SpreadsheetCellVisual | null>();
  return {
    get(key: string) {
      if (visualCache.has(key)) {
        return visualCache.get(key) ?? undefined;
      }

      const [rowValue, columnValue] = key.split(":");
      const rowIndex = Number(rowValue);
      const columnIndex = Number(columnValue);
      const tableVisual = Number.isFinite(rowIndex) && Number.isFinite(columnIndex)
        ? spreadsheetTableCellVisual(tableVisuals, rowIndex, columnIndex)
        : undefined;
      const conditionalVisual = Number.isFinite(rowIndex) && Number.isFinite(columnIndex)
        ? spreadsheetConditionalCellVisual(conditionalVisuals, rowsByIndex, rowIndex, columnIndex)
        : undefined;
      const visual = mergeSpreadsheetCellVisuals(tableVisual, conditionalVisual);
      cacheSpreadsheetCellVisual(visualCache, key, visual);
      return visual;
    },
  };
}

function cacheSpreadsheetCellVisual(
  cache: Map<string, SpreadsheetCellVisual | null>,
  key: string,
  visual: SpreadsheetCellVisual | undefined,
) {
  if (cache.size >= MAX_CELL_VISUAL_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey != null) cache.delete(firstKey);
  }

  cache.set(key, visual ?? null);
}

function spreadsheetConditionalCellVisual(
  conditionalVisuals: SpreadsheetConditionalVisualSpec[],
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>,
  rowIndex: number,
  columnIndex: number,
): SpreadsheetCellVisual | undefined {
  let visual: SpreadsheetCellVisual | undefined;
  for (const rule of conditionalVisuals) {
    if (!cellRangeContains(rule.range, rowIndex, columnIndex)) continue;
    const value = cellNumberAt(rowsByIndex, rowIndex, columnIndex);
    switch (rule.kind) {
      case "colorScale":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, { background: colorScaleColor(value, rule.stops) });
        break;
      case "dataBar":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          dataBar: spreadsheetDataBarVisual(
            value,
            rule.barMin,
            rule.barMax,
            rule.span,
            rule.color,
            rule.negativeColor,
            rule.dataBar,
          ),
        });
        break;
      case "iconSet":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          iconSet: spreadsheetIconSetVisual(
            value,
            rule.rangeValues,
            rule.minValue,
            rule.maxValue,
            rule.iconSet.showValue !== false,
            rule.iconSet.reverse === true,
            rule.iconSet,
          ),
        });
        break;
      case "format": {
        const cell = cellAt(rowsByIndex, rowIndex, columnIndex);
        const text = cellText(cell);
        if (!conditionalTextMatches(rule.format, text, value)) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          background: protocolColorToCss(rule.format.fillColor),
          color: protocolColorToCss(rule.format.fontColor),
          fontWeight: rule.format.bold === true ? 700 : undefined,
        });
        break;
      }
      case "fallbackColorScale":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          background: spreadsheetHeatColor(value, rule.minValue, rule.maxValue),
        });
        break;
      case "fallbackDataBar":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          dataBar: spreadsheetDataBarVisual(value, rule.minValue, rule.maxValue, rule.span, rule.color, rule.color, { gradient: true }),
        });
        break;
    }
  }

  return visual;
}

function cellRangeContains(range: SpreadsheetCellRange, rowIndex: number, columnIndex: number): boolean {
  return rowIndex >= range.startRow &&
    rowIndex < range.startRow + range.rowSpan &&
    columnIndex >= range.startColumn &&
    columnIndex < range.startColumn + range.columnSpan;
}

function spreadsheetTableCellVisual(
  tableVisuals: SpreadsheetTableVisualSpec[],
  rowIndex: number,
  columnIndex: number,
): SpreadsheetCellVisual | undefined {
  let visual: SpreadsheetCellVisual | undefined;
  for (const table of tableVisuals) {
    if (
      rowIndex < table.range.startRow ||
      rowIndex >= table.range.startRow + table.range.rowSpan ||
      columnIndex < table.range.startColumn ||
      columnIndex >= table.range.startColumn + table.range.columnSpan
    ) {
      continue;
    }

    if (rowIndex < table.range.startRow + table.headerRowCount) {
      visual = mergeSpreadsheetCellVisuals(visual, {
        filter: table.showFilter && rowIndex === table.range.startRow + table.headerRowCount - 1 ? true : undefined,
        fontWeight: 700,
      });
      continue;
    }

    if (rowIndex >= table.totalsStartRow) {
      visual = mergeSpreadsheetCellVisuals(visual, {
        background: table.palette.total,
        fontWeight: 700,
      });
      continue;
    }

    if (rowIndex >= table.bodyStartRow && rowIndex < table.bodyEndRow) {
      const rowStripe = table.showRowStripes && (rowIndex - table.bodyStartRow) % 2 === 0;
      const columnStripe = table.showColumnStripes && (columnIndex - table.range.startColumn) % 2 === 0;
      visual = mergeSpreadsheetCellVisuals(visual, {
        background: columnStripe ? table.palette.columnStripe : rowStripe ? table.palette.rowStripe : undefined,
        fontWeight: (table.showFirstColumn && columnIndex === table.range.startColumn) || (table.showLastColumn && columnIndex === table.lastColumnIndex)
          ? 700
          : undefined,
      });
    }
  }

  return visual;
}

function mergeSpreadsheetCellVisuals(
  base: SpreadsheetCellVisual | undefined,
  override: SpreadsheetCellVisual | undefined,
): SpreadsheetCellVisual | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...definedSpreadsheetVisualFields(override),
  };
}

function definedSpreadsheetVisualFields(visual: SpreadsheetCellVisual): SpreadsheetCellVisual {
  const next: SpreadsheetCellVisual = {};
  if (visual.background !== undefined) next.background = visual.background;
  if (visual.color !== undefined) next.color = visual.color;
  if (visual.dataBar !== undefined) next.dataBar = visual.dataBar;
  if (visual.filter !== undefined) next.filter = visual.filter;
  if (visual.fontWeight !== undefined) next.fontWeight = visual.fontWeight;
  if (visual.iconSet !== undefined) next.iconSet = visual.iconSet;
  return next;
}

function tableStylePalette(
  styleName: string,
  theme?: RecordValue | null,
): { columnStripe: string; rowStripe: string; total: string } {
  const themeColor = tableStyleThemeColor(styleName, theme);
  if (themeColor) {
    return {
      columnStripe: mixCssColorWithWhite(themeColor, 0.82),
      rowStripe: mixCssColorWithWhite(themeColor, 0.74),
      total: mixCssColorWithWhite(themeColor, 0.58),
    };
  }

  if (/Medium4$/i.test(styleName)) {
    return { columnStripe: "#dbeafe", rowStripe: "#eff6ff", total: "#bfdbfe" };
  }

  if (/Medium9$/i.test(styleName)) {
    return { columnStripe: "#d9ead3", rowStripe: "#eef7e8", total: "#b7dfae" };
  }

  if (/Medium2$/i.test(styleName)) {
    return { columnStripe: "#d7f0f8", rowStripe: "#c7eaf7", total: "#9ed8ea" };
  }

  return { columnStripe: "#e0f2fe", rowStripe: "#f0f9ff", total: "#bae6fd" };
}

function tableStyleThemeColor(styleName: string, theme?: RecordValue | null): string | undefined {
  const styleIndex = Number(styleName.match(/Medium(\d+)/i)?.[1] ?? "");
  const colorName = tableStyleThemeColorName(styleIndex);
  const colorScheme = asRecord(theme?.colorScheme);
  const colors = asArray(colorScheme?.colors).map(asRecord).filter((color): color is RecordValue => color != null);
  const themeColor = colors.find((color) => asString(color.name).toLowerCase() === colorName);
  return colorToCss(themeColor?.color);
}

function tableStyleThemeColorName(styleIndex: number): string {
  if (styleIndex === 9) return "accent6";
  if (styleIndex === 4) return "accent1";
  if (styleIndex === 2) return "accent4";
  if (styleIndex >= 1 && styleIndex <= 6) return `accent${styleIndex}`;
  return "accent4";
}

function mixCssColorWithWhite(value: string, whiteRatio: number): string {
  const rgb = hexColorToRgb(value);
  if (!rgb) return value;
  const ratio = Math.max(0, Math.min(1, whiteRatio));
  const red = Math.round(rgb.red * (1 - ratio) + 255 * ratio);
  const green = Math.round(rgb.green * (1 - ratio) + 255 * ratio);
  const blue = Math.round(rgb.blue * (1 - ratio) + 255 * ratio);
  return `rgb(${red}, ${green}, ${blue})`;
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
  rowsByIndex: ReadonlyMap<number, ReadonlyMap<number, RecordValue>>,
  reference: string,
): Array<{ columnIndex: number; rowIndex: number; value: number }> {
  const values: Array<{ columnIndex: number; rowIndex: number; value: number }> = [];
  const range = parseCellRange(reference);
  if (!range) return values;

  for (const [rowIndex, cells] of rowsByIndex) {
    if (rowIndex < range.startRow || rowIndex >= range.startRow + range.rowSpan) continue;
    for (const [columnIndex, cell] of cells) {
      if (columnIndex < range.startColumn || columnIndex >= range.startColumn + range.columnSpan) continue;
      const value = Number(cellText(cell));
      if (Number.isFinite(value)) values.push({ columnIndex, rowIndex, value });
    }
  }
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

type RgbColor = { blue: number; green: number; red: number };

type ColorScaleStop = {
  color: RgbColor;
  threshold: number;
};

function colorScaleStops(
  colorScale: RecordValue,
  rangeValues: number[],
  minValue: number,
  maxValue: number,
  colors: string[],
): ColorScaleStop[] {
  const cfvos = asArray(colorScale.cfvos).map(asRecord);
  return colors
    .map((color, index) => {
      const rgb = hexColorToRgb(color);
      if (!rgb) return null;
      const fallback = colorScaleFallbackThreshold(index, colors.length, minValue, maxValue);
      const threshold = cfvoThresholdValue(cfvos[index] ?? null, rangeValues, minValue, maxValue, fallback);
      return {
        color: rgb,
        threshold: Number.isFinite(threshold) ? threshold : fallback,
      };
    })
    .filter((stop): stop is ColorScaleStop => stop != null)
    .sort((left, right) => left.threshold - right.threshold);
}

function colorScaleFallbackThreshold(index: number, stopCount: number, minValue: number, maxValue: number): number {
  if (stopCount <= 1 || maxValue <= minValue) return minValue;
  return minValue + (maxValue - minValue) * index / (stopCount - 1);
}

function colorScaleColor(value: number, stops: ColorScaleStop[]): string {
  if (stops.length === 0) {
    return "#fff4c2";
  }

  if (stops.length === 1) {
    return rgbColorToCss(stops[0].color);
  }

  if (value <= stops[0].threshold) {
    return rgbColorToCss(stops[0].color);
  }

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (value > current.threshold) continue;
    const span = current.threshold - previous.threshold;
    const ratio = span > 0 ? (value - previous.threshold) / span : 1;
    return interpolateColor(previous.color, current.color, ratio);
  }

  return rgbColorToCss(stops[stops.length - 1].color);
}

function rgbColorToCss(color: RgbColor): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
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
    iconSet: asString(iconSet?.iconSet),
    level,
    levelCount,
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
