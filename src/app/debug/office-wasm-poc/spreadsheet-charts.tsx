"use client";

import { useEffect, useRef } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  columnIndexFromAddress,
  type RecordValue,
} from "./office-preview-utils";
import { protocolColorToCss } from "./spreadsheet-conditional-visuals";
import {
  spreadsheetColumnLeft,
  spreadsheetDrawingBounds,
  spreadsheetEmuToPx,
  type SpreadsheetLayout,
  spreadsheetRowTop,
} from "./spreadsheet-layout";

type SpreadsheetChartAxisSpec = {
  majorGridLines: boolean;
  majorUnit?: number;
  maximum?: number;
  minimum?: number;
  numberFormat: string;
  position: string;
};

type SpreadsheetChartLegendPosition = "bottom" | "left" | "none" | "right" | "top";
type SpreadsheetChartType = "area" | "bar" | "bubble" | "doughnut" | "line" | "pie" | "radar" | "scatter" | "surface";
type SpreadsheetChartLegendItem = {
  color: string;
  label: string;
  marker: SpreadsheetChartSeries["marker"];
  showLine: boolean;
};

const CHART_PALETTE = ["#1f6f8b", "#f9732a", "#5b7f2a", "#9467bd", "#8c564b", "#2ca02c", "#d62728"];

export type SpreadsheetChartPlotArea = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type SpreadsheetChartSeries = {
  color: string;
  label: string;
  marker: "diamond" | "square" | null;
  values: number[];
};

export type SpreadsheetChartSpec = {
  categories: string[];
  height: number;
  left: number;
  legendOverlay: boolean;
  legendPosition: SpreadsheetChartLegendPosition;
  series: SpreadsheetChartSeries[];
  title: string;
  top: number;
  type: SpreadsheetChartType;
  width: number;
  xAxis?: SpreadsheetChartAxisSpec;
  yAxis?: SpreadsheetChartAxisSpec;
  zIndex: number;
};

export function buildSpreadsheetCharts({
  activeSheet,
  charts: workbookCharts,
  layout,
  sheets,
}: {
  activeSheet: RecordValue | undefined;
  charts: RecordValue[];
  layout: SpreadsheetLayout;
  sheets: RecordValue[];
}): SpreadsheetChartSpec[] {
  const protocolCharts = [
    ...buildSheetDrawingCharts(activeSheet, layout),
    ...buildRootSpreadsheetCharts(activeSheet, workbookCharts, layout),
  ];
  if (protocolCharts.length > 0) return protocolCharts;

  if (asString(activeSheet?.name) !== "01_Dashboard") return [];
  if (cellText(cellAt(activeSheet, 1, 0)) !== "AI Coding Delivery Dashboard") return [];

  const statusCategories: string[] = [];
  const statusValues: number[] = [];
  for (let rowIndex = 18; rowIndex <= 23; rowIndex += 1) {
    const category = cellText(cellAt(activeSheet, rowIndex, 0));
    const value = cellNumberAt(activeSheet, rowIndex, 1);
    if (category && value != null) {
      statusCategories.push(category);
      statusValues.push(value);
    }
  }

  const fallbackCharts: SpreadsheetChartSpec[] = [];
  if (statusCategories.length > 0) {
    fallbackCharts.push({
      categories: statusCategories,
      height: 280,
      left: spreadsheetColumnLeft(layout, 5),
      legendOverlay: false,
      legendPosition: "none",
      series: [spreadsheetChartSeries("Count", statusValues, 0)],
      title: "Tasks by Status",
      top: spreadsheetRowTop(layout, 16),
      type: "bar",
      width: 450,
      zIndex: 0,
    });
  }

  const timeSeriesSheet = sheets.find((sheet) => asString(sheet.name) === "03_TimeSeries");
  const monthLabels: string[] = [];
  const fitnessValues: number[] = [];
  const coverageValues: number[] = [];
  for (let rowIndex = 5; rowIndex <= 22; rowIndex += 1) {
    const serial = cellNumberAt(timeSeriesSheet, rowIndex, 0);
    const fitness = cellNumberAt(timeSeriesSheet, rowIndex, 5);
    const coverage = cellNumberAt(timeSeriesSheet, rowIndex, 3);
    if (serial != null && fitness != null && coverage != null) {
      monthLabels.push(excelSerialMonthLabel(serial));
      fitnessValues.push(fitness);
      coverageValues.push(coverage * 100);
    }
  }

  if (monthLabels.length > 0) {
    fallbackCharts.push({
      categories: monthLabels,
      height: 280,
      left: spreadsheetColumnLeft(layout, 0),
      legendOverlay: false,
      legendPosition: "bottom",
      series: [
        spreadsheetChartSeries("Fitness Score", fitnessValues, 0),
        spreadsheetChartSeries("Coverage %", coverageValues, 1),
      ],
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(layout, 30),
      type: "line",
      width: 640,
      zIndex: fallbackCharts.length,
    });
  }

  return fallbackCharts;
}

function buildSheetDrawingCharts(
  activeSheet: RecordValue | undefined,
  layout: SpreadsheetLayout,
): SpreadsheetChartSpec[] {
  return asArray(activeSheet?.drawings)
    .map(asRecord)
    .filter((drawing): drawing is RecordValue => drawing != null)
    .map((drawing, index) => chartFromSheetDrawing(drawing, layout, index))
    .filter((chart): chart is SpreadsheetChartSpec => chart != null);
}

function chartFromSheetDrawing(
  drawing: RecordValue,
  layout: SpreadsheetLayout,
  zIndex: number,
): SpreadsheetChartSpec | null {
  const chart = asRecord(drawing.chart);
  if (!chart) return null;

  const bounds = spreadsheetDrawingBounds(layout, drawing);

  return chartFromRecord(chart, {
    height: chartDimension(bounds.height > 24 ? bounds.height : 0, 0, 120),
    left: bounds.left,
    top: bounds.top,
    width: chartDimension(bounds.width > 24 ? bounds.width : 0, 0, 180),
    zIndex,
  });
}

function buildRootSpreadsheetCharts(
  activeSheet: RecordValue | undefined,
  charts: RecordValue[],
  layout: SpreadsheetLayout,
): SpreadsheetChartSpec[] {
  const sheetName = asString(activeSheet?.name);
  return charts
    .filter((chart) => asString(chart.sheetName) === sheetName)
    .map((chart, index) => {
      const anchor = asRecord(chart.anchor);
      const fromCol = protocolNumber(anchor?.fromCol, 0);
      const fromRow = protocolNumber(anchor?.fromRow, 0);
      const left = spreadsheetColumnLeft(layout, fromCol);
      const top = spreadsheetRowTop(layout, fromRow);
      const extWidth = spreadsheetEmuToPx(anchor?.toColOffsetEmu);
      const extHeight = spreadsheetEmuToPx(anchor?.toRowOffsetEmu);
      const toCol = Math.max(fromCol + 5, protocolNumber(anchor?.toCol, fromCol + 5));
      const toRow = Math.max(fromRow + 10, protocolNumber(anchor?.toRow, fromRow + 10));
      const right = spreadsheetColumnLeft(layout, toCol);
      const bottom = spreadsheetRowTop(layout, toRow);

      return chartFromRecord(chart, {
        height: chartDimension(extHeight, bottom - top, 220),
        left,
        top,
        width: chartDimension(extWidth, right - left, 360),
        zIndex: 10_000 + index,
      });
    })
    .filter((chart): chart is SpreadsheetChartSpec => chart != null);
}

function chartFromRecord(
  chart: RecordValue,
  bounds: { height: number; left: number; top: number; width: number; zIndex: number },
): SpreadsheetChartSpec | null {
  const seriesRecords = asArray(chart.series).map(asRecord).filter((item): item is RecordValue => item != null);
  const series = seriesRecords
    .map((item, index) => spreadsheetChartSeries(
      asString(item.label) || asString(item.name) || `Series ${index + 1}`,
      asArray(item.values).map((value) => protocolNumber(value, Number.NaN)).filter(Number.isFinite),
      index,
      protocolColorToCss(item.color),
      chartSeriesHasMarker(item),
    ))
    .filter((item) => item.values.length > 0);
  if (series.length === 0) return null;

  const categories = asArray(seriesRecords[0]?.categories).map(asString).filter(Boolean);
  return {
    categories: categories.length > 0 ? categories : series[0].values.map((_, index) => String(index + 1)),
    height: bounds.height,
    left: bounds.left,
    legendOverlay: spreadsheetLegendOverlay(chart.legend),
    legendPosition: spreadsheetLegendPosition(chart.legend),
    series,
    title: asString(chart.title),
    top: bounds.top,
    type: spreadsheetChartType(chart),
    width: bounds.width,
    xAxis: spreadsheetChartAxis(chart.xAxis),
    yAxis: spreadsheetChartAxis(chart.yAxis),
    zIndex: bounds.zIndex,
  };
}

function spreadsheetChartSeries(
  label: string,
  values: number[],
  index: number,
  color?: string,
  markerVisible = true,
): SpreadsheetChartSeries {
  return {
    color: color ?? chartPalette(index),
    label,
    marker: markerVisible ? (index % 2 === 0 ? "diamond" : "square") : null,
    values,
  };
}

function chartSeriesHasMarker(series: RecordValue): boolean {
  return series.marker === true || asRecord(series.marker) != null;
}

function spreadsheetLegendPosition(value: unknown): SpreadsheetChartLegendPosition {
  const legend = asRecord(value);
  if (!legend) return "none";
  switch (asString(legend.position).toLowerCase()) {
    case "1":
    case "l":
    case "left":
      return "left";
    case "2":
    case "t":
    case "top":
      return "top";
    case "3":
    case "r":
    case "right":
      return "right";
    case "4":
    case "b":
    case "bottom":
      return "bottom";
    default:
      return "none";
  }
}

function spreadsheetLegendOverlay(value: unknown): boolean {
  const legend = asRecord(value);
  return legend?.overlay === true || asString(legend?.overlay).toLowerCase() === "true" || asString(legend?.overlay) === "1";
}

function spreadsheetChartType(chart: RecordValue): SpreadsheetChartType {
  const chartType = asString(chart.chartType).toLowerCase();
  const chartTypeId = protocolNumber(chart.type, 0);
  if (chartType === "area" || chartTypeId === 2) return "area";
  if (chartType === "bubble" || chartTypeId === 5) return "bubble";
  if (chartType === "doughnut" || chartTypeId === 8) return "doughnut";
  if (chartType === "line" || chartTypeId === 13) return "line";
  if (chartType === "pie" || chartTypeId === 16) return "pie";
  if (chartType === "radar" || chartTypeId === 17) return "radar";
  if (chartType === "scatter" || chartTypeId === 18) return "scatter";
  if (chartType === "surface" || chartTypeId === 22) return "surface";
  return "bar";
}

function spreadsheetChartAxis(value: unknown): SpreadsheetChartAxisSpec | undefined {
  const axis = asRecord(value);
  if (!axis) return undefined;
  const scaling = asRecord(axis.scaling) ?? {};

  return {
    majorGridLines: axis.majorGridLines === true || asRecord(axis.majorGridLines) != null,
    majorUnit: optionalProtocolNumber(axis.majorUnit ?? scaling.majorUnit),
    maximum: optionalProtocolNumber(axis.maximum ?? axis.max ?? scaling.maximum ?? scaling.max),
    minimum: optionalProtocolNumber(axis.minimum ?? axis.min ?? scaling.minimum ?? scaling.min),
    numberFormat: asString(axis.numberFormat),
    position: asString(axis.position ?? axis.axisPosition),
  };
}

function chartDimension(exactValue: number, fallbackValue: number, minimum: number): number {
  if (Number.isFinite(exactValue) && exactValue > 0) return Math.max(24, exactValue);
  if (Number.isFinite(fallbackValue) && fallbackValue > 0) return Math.max(24, fallbackValue);
  return minimum;
}

function optionalProtocolNumber(value: unknown): number | undefined {
  const number = protocolNumber(value, Number.NaN);
  return Number.isFinite(number) ? number : undefined;
}

function protocolNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
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

function excelSerialMonthLabel(value: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "2-digit" }).format(date);
}

export function SpreadsheetChartLayer({ charts }: { charts: SpreadsheetChartSpec[] }) {
  if (charts.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute" }}>
      {charts.map((chart, index) => (
        <SpreadsheetCanvasChart chart={chart} key={`${chart.type}-${chart.title}-${index}`} />
      ))}
    </div>
  );
}

function SpreadsheetCanvasChart({ chart }: { chart: SpreadsheetChartSpec }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(chart.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(chart.height * pixelRatio));
    canvas.style.width = `${chart.width}px`;
    canvas.style.height = `${chart.height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, chart.width, chart.height);
    drawSpreadsheetChart(context, chart);
  }, [chart]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        background: "#ffffff",
        borderColor: "#e5e7eb",
        borderStyle: "solid",
        borderWidth: 1,
        height: chart.height,
        left: chart.left,
        position: "absolute",
        top: chart.top,
        width: chart.width,
        zIndex: chart.zIndex,
      }}
      title={chart.title}
    />
  );
}

function drawSpreadsheetChart(context: CanvasRenderingContext2D, chart: SpreadsheetChartSpec) {
  const width = chart.width;
  const height = chart.height;
  const plot = spreadsheetChartPlotArea(chart);
  const values = chart.series.flatMap((series) => series.values);
  const ticks = spreadsheetChartTickValues(chart, values);
  const minValue = ticks[0] ?? 0;
  const maxValue = ticks[ticks.length - 1] ?? 1;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "600 18px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(chart.title, width / 2, 30);

  if (isCartesianChart(chart.type)) {
    drawChartGrid(context, chart, plot, ticks);
  }

  switch (chart.type) {
    case "area":
    case "surface":
      drawAreaChart(context, chart, plot, minValue, maxValue);
      break;
    case "bubble":
      drawScatterChart(context, chart, plot, minValue, maxValue, true);
      break;
    case "doughnut":
      drawPieChart(context, chart, plot, true);
      break;
    case "line":
      drawLineChart(context, chart, plot, minValue, maxValue);
      break;
    case "pie":
      drawPieChart(context, chart, plot, false);
      break;
    case "radar":
      drawRadarChart(context, chart, plot, ticks);
      break;
    case "scatter":
      drawScatterChart(context, chart, plot, minValue, maxValue, false);
      break;
    case "bar":
    default:
      drawBarChart(context, chart, plot, minValue, maxValue);
      break;
  }

  drawChartLegend(context, chart, plot);
}

export function spreadsheetChartPlotArea(chart: SpreadsheetChartSpec): SpreadsheetChartPlotArea {
  const reservesLegendSpace = chart.legendPosition !== "none" && !chart.legendOverlay;
  const hasBottomLegend = reservesLegendSpace && chart.legendPosition === "bottom";
  const hasTopLegend = reservesLegendSpace && chart.legendPosition === "top";
  const hasLeftLegend = reservesLegendSpace && chart.legendPosition === "left";
  const hasRightLegend = reservesLegendSpace && chart.legendPosition === "right";
  const categoryLabelHeight = isLineAxisChart(chart.type) ? 46 : isCircularChart(chart.type) || chart.type === "radar" ? 8 : 30;
  const legendHeight = hasBottomLegend ? 42 : 0;
  const top = (chart.title ? 58 : 24) + (hasTopLegend ? 28 : 0);
  const bottom = Math.max(top + 48, chart.height - categoryLabelHeight - legendHeight);

  return {
    bottom,
    left: (isLineAxisChart(chart.type) ? 64 : isCircularChart(chart.type) || chart.type === "radar" ? 28 : 52) + (hasLeftLegend ? 108 : 0),
    right: chart.width - (hasRightLegend ? 126 : 22),
    top,
  };
}

function drawChartGrid(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  ticks: number[],
) {
  context.save();
  context.strokeStyle = "#c7c7c7";
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.fillStyle = "#737373";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  const minValue = ticks[0] ?? 0;
  const maxValue = ticks[ticks.length - 1] ?? 1;
  const showHorizontalGrid = chart.yAxis?.majorGridLines !== false;
  for (const value of ticks) {
    const y = chartY(value, plot, minValue, maxValue);
    if (showHorizontalGrid) {
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
    }

    context.fillText(formatChartTick(value, chart.yAxis?.numberFormat), plot.left - 8, y);
  }

  if (isLineAxisChart(chart.type) && chart.categories.length > 0) {
    const pointCount = Math.max(1, chart.categories.length - 1);
    for (let index = 0; index < chart.categories.length; index += 1) {
      const x = plot.left + (index / pointCount) * (plot.right - plot.left);
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, plot.bottom);
      context.stroke();
    }
  }

  context.setLineDash([]);
  context.strokeStyle = "#111827";
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.bottom);
  context.lineTo(plot.right, plot.bottom);
  context.stroke();
  context.restore();
}

export function spreadsheetChartTickValues(chart: SpreadsheetChartSpec, values: number[]): number[] {
  const tickCount = isLineAxisChart(chart.type) || chart.type === "radar" ? 6 : 5;
  const minValue = chart.yAxis?.minimum ?? 0;
  const observedMax = Math.max(minValue, ...values.filter(Number.isFinite));
  const majorUnit = chart.yAxis?.majorUnit;
  let maxValue = chart.yAxis?.maximum ?? (
    majorUnit && majorUnit > 0
      ? Math.ceil(observedMax / majorUnit) * majorUnit
      : niceChartMax(observedMax, tickCount)
  );

  if (!Number.isFinite(maxValue) || maxValue <= minValue) {
    maxValue = minValue + 1;
  }

  if (majorUnit && majorUnit > 0) {
    const ticks: number[] = [];
    for (let value = minValue; value <= maxValue + majorUnit / 1000; value += majorUnit) {
      ticks.push(roundChartNumber(value));
    }
    return ticks.length >= 2 ? ticks : [minValue, maxValue];
  }

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / Math.max(1, tickCount - 1);
    return roundChartNumber(minValue + ratio * (maxValue - minValue));
  });
}

function niceChartMax(observedMax: number, tickCount: number): number {
  if (!Number.isFinite(observedMax) || observedMax <= 0) return 1;
  const intervalCount = Math.max(1, tickCount - 1);
  const roughStep = observedMax / intervalCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
  return Math.max(step, Math.ceil(observedMax / step) * step);
}

function chartY(
  value: number,
  plot: Pick<SpreadsheetChartPlotArea, "bottom" | "top">,
  minValue: number,
  maxValue: number,
): number {
  if (maxValue <= minValue) return plot.bottom;
  const ratio = (value - minValue) / (maxValue - minValue);
  return plot.bottom - ratio * (plot.bottom - plot.top);
}

function drawBarChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  minValue: number,
  maxValue: number,
) {
  const series = chart.series[0];
  const values = series?.values ?? [];
  const slotWidth = (plot.right - plot.left) / Math.max(1, values.length);
  const barWidth = Math.min(32, slotWidth * 0.34);

  context.save();
  values.forEach((value, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    const y = chartY(value, plot, minValue, maxValue);
    context.fillStyle = series?.color ?? "#1f6f8b";
    context.beginPath();
    context.roundRect(centerX - barWidth / 2, y, barWidth, plot.bottom - y, 3);
    context.fill();
  });

  context.fillStyle = "#737373";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  chart.categories.forEach((category, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    context.fillText(category, centerX, plot.bottom + 20);
  });
  context.restore();
}

function drawLineChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  minValue: number,
  maxValue: number,
) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index: number) => plot.left + (index / pointCount) * (plot.right - plot.left);

  context.save();
  chart.series.forEach((series) => {
    context.strokeStyle = series.color;
    context.lineWidth = 3;
    context.setLineDash([]);
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  });

  context.fillStyle = "#737373";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });

  chart.series.forEach((series) => {
    if (!series.marker) return;
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      context.beginPath();
      if (series.marker === "diamond") {
        context.moveTo(x, y - 5);
        context.lineTo(x + 5, y);
        context.lineTo(x, y + 5);
        context.lineTo(x - 5, y);
      } else {
        context.rect(x - 5, y - 5, 10, 10);
      }
      context.closePath();
      context.fill();
    });
  });
  context.restore();
}

function drawAreaChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  minValue: number,
  maxValue: number,
) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index: number) => plot.left + (index / pointCount) * (plot.right - plot.left);

  context.save();
  chart.series.forEach((series) => {
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(xForIndex(Math.max(0, series.values.length - 1)), plot.bottom);
    context.lineTo(xForIndex(0), plot.bottom);
    context.closePath();
    context.globalAlpha = 0.22;
    context.fillStyle = series.color;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = series.color;
    context.lineWidth = 2;
    context.stroke();
  });
  drawLineCategoryLabels(context, chart, plot);
  context.restore();
}

function drawPieChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  isDoughnut: boolean,
) {
  const values = chart.series[0]?.values.map((value) => Math.max(0, value)) ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;

  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2;
  const radius = Math.max(12, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.42);
  let startAngle = -Math.PI / 2;

  context.save();
  values.forEach((value, index) => {
    const angle = (value / total) * Math.PI * 2;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radius, startAngle, startAngle + angle);
    context.closePath();
    context.fillStyle = chartPalette(index);
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.stroke();
    startAngle += angle;
  });

  if (isDoughnut) {
    context.beginPath();
    context.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
  }
  context.restore();
}

function drawScatterChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  minValue: number,
  maxValue: number,
  isBubble: boolean,
) {
  const xValues = chart.categories.map((category, index) => {
    const numeric = Number(category);
    return Number.isFinite(numeric) ? numeric : index + 1;
  });
  const minX = Math.min(...xValues, 0);
  const maxX = Math.max(...xValues, 1);
  const xForValue = (value: number) => {
    if (maxX <= minX) return plot.left;
    return plot.left + ((value - minX) / (maxX - minX)) * (plot.right - plot.left);
  };

  context.save();
  chart.series.forEach((series) => {
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForValue(xValues[index] ?? index + 1);
      const y = chartY(value, plot, minValue, maxValue);
      const radius = isBubble ? 7 : 5;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1;
      context.stroke();
    });
  });
  drawLineCategoryLabels(context, chart, plot);
  context.restore();
}

function drawRadarChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
  ticks: number[],
) {
  const axisCount = Math.max(3, chart.categories.length, ...chart.series.map((series) => series.values.length));
  const maxValue = ticks[ticks.length - 1] ?? Math.max(...chart.series.flatMap((series) => series.values), 1);
  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2;
  const radius = Math.max(12, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.42);
  const pointFor = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index / axisCount) * Math.PI * 2;
    const ratio = maxValue > 0 ? Math.max(0, value) / maxValue : 0;
    return {
      x: centerX + Math.cos(angle) * radius * ratio,
      y: centerY + Math.sin(angle) * radius * ratio,
    };
  };
  const axisPoint = (index: number) => pointFor(index, maxValue);

  context.save();
  context.strokeStyle = "#d1d5db";
  context.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring += 1) {
    context.beginPath();
    for (let index = 0; index < axisCount; index += 1) {
      const point = pointFor(index, (maxValue * ring) / 4);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.stroke();
  }

  context.fillStyle = "#737373";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < axisCount; index += 1) {
    const point = axisPoint(index);
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(point.x, point.y);
    context.stroke();
    const label = chart.categories[index];
    if (label) {
      context.fillText(label, point.x, point.y);
    }
  }

  chart.series.forEach((series) => {
    context.beginPath();
    series.values.forEach((value, index) => {
      const point = pointFor(index, value);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.globalAlpha = 0.16;
    context.fillStyle = series.color;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = series.color;
    context.lineWidth = 2;
    context.stroke();
  });
  context.restore();
}

function drawLineCategoryLabels(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index: number) => plot.left + (index / pointCount) * (plot.right - plot.left);

  context.fillStyle = "#737373";
  context.font = "12px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });
}

function drawChartLegend(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: SpreadsheetChartPlotArea,
) {
  if (chart.legendPosition === "none") return;
  const items = chartLegendItems(chart);

  context.save();
  if (chart.legendPosition === "right") {
    let legendY = plot.top + 18;
    const legendX = plot.right + 18;
    items.forEach((item) => {
      drawLegendEntry(context, item, legendX, legendY);
      legendY += 20;
    });
    context.restore();
    return;
  }

  if (chart.legendPosition === "left") {
    let legendY = plot.top + 18;
    const legendX = 18;
    items.forEach((item) => {
      drawLegendEntry(context, item, legendX, legendY);
      legendY += 20;
    });
    context.restore();
    return;
  }

  const legendY = chart.legendPosition === "top" ? 48 : chart.height - 18;
  let legendX = chart.width / 2 - items.length * 56;
  items.forEach((item) => {
    drawLegendEntry(context, item, legendX, legendY);
    legendX += 112;
  });
  context.restore();
}

function chartLegendItems(chart: SpreadsheetChartSpec): SpreadsheetChartLegendItem[] {
  if (isCircularChart(chart.type)) {
    return chart.categories.map((label, index) => ({
      color: chartPalette(index),
      label,
      marker: "square",
      showLine: false,
    }));
  }

  return chart.series.map((series) => ({
    color: series.color,
    label: series.label,
    marker: series.marker,
    showLine: true,
  }));
}

function drawLegendEntry(
  context: CanvasRenderingContext2D,
  item: SpreadsheetChartLegendItem,
  x: number,
  y: number,
) {
  context.strokeStyle = item.color;
  context.lineWidth = 3;
  context.fillStyle = item.color;
  if (item.showLine) {
    context.beginPath();
    context.moveTo(x, y - 4);
    context.lineTo(x + 18, y - 4);
    context.stroke();
    if (item.marker) drawChartMarker(context, item.marker, x + 9, y - 4, 4);
  } else {
    context.fillRect(x, y - 10, 12, 12);
  }

  context.fillStyle = "#737373";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = "12px Arial, sans-serif";
  context.fillText(item.label, x + 26, y);
}

function drawChartMarker(
  context: CanvasRenderingContext2D,
  marker: SpreadsheetChartSeries["marker"],
  x: number,
  y: number,
  radius: number,
) {
  context.beginPath();
  if (marker === "diamond") {
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
  } else {
    context.rect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.closePath();
  context.fill();
}

function isCartesianChart(type: SpreadsheetChartType): boolean {
  return type === "area" || type === "bar" || type === "bubble" || type === "line" || type === "scatter" || type === "surface";
}

function isLineAxisChart(type: SpreadsheetChartType): boolean {
  return type === "area" || type === "bubble" || type === "line" || type === "scatter" || type === "surface";
}

function isCircularChart(type: SpreadsheetChartType): boolean {
  return type === "doughnut" || type === "pie";
}

function chartPalette(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? "#1f6f8b";
}

export function formatChartTick(value: number, numberFormat = ""): string {
  const normalized = numberFormat.toLowerCase();
  if (normalized.includes("%")) {
    const decimals = chartFormatDecimalPlaces(numberFormat);
    return `${(value * 100).toFixed(decimals)}%`;
  }

  if (numberFormat.includes("$")) {
    const decimals = chartFormatDecimalPlaces(numberFormat);
    const formatted = Math.abs(value).toLocaleString("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
    return `${value < 0 ? "-" : ""}$${formatted}`;
  }

  if (numberFormat.includes("#,##0.00")) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  if (numberFormat.includes("#,##0")) {
    return Math.round(value).toLocaleString("en-US");
  }

  if (/^0\.0+$/.test(numberFormat)) {
    return value.toFixed(chartFormatDecimalPlaces(numberFormat));
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function chartFormatDecimalPlaces(numberFormat: string): number {
  return numberFormat.match(/\.([0#]+)/)?.[1]?.length ?? 0;
}

function roundChartNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}
