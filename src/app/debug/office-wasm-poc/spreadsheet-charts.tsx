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

export type SpreadsheetChartSeries = {
  color: string;
  label: string;
  marker: "diamond" | "square";
  values: number[];
};

export type SpreadsheetChartSpec = {
  categories: string[];
  height: number;
  left: number;
  legendPosition: SpreadsheetChartLegendPosition;
  series: SpreadsheetChartSeries[];
  title: string;
  top: number;
  type: "bar" | "line";
  width: number;
  xAxis?: SpreadsheetChartAxisSpec;
  yAxis?: SpreadsheetChartAxisSpec;
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
      legendPosition: "none",
      series: [spreadsheetChartSeries("Count", statusValues, 0)],
      title: "Tasks by Status",
      top: spreadsheetRowTop(layout, 16),
      type: "bar",
      width: 450,
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
      legendPosition: "bottom",
      series: [
        spreadsheetChartSeries("Fitness Score", fitnessValues, 0),
        spreadsheetChartSeries("Coverage %", coverageValues, 1),
      ],
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(layout, 30),
      type: "line",
      width: 640,
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
    .map((drawing) => chartFromSheetDrawing(drawing, layout))
    .filter((chart): chart is SpreadsheetChartSpec => chart != null);
}

function chartFromSheetDrawing(drawing: RecordValue, layout: SpreadsheetLayout): SpreadsheetChartSpec | null {
  const chart = asRecord(drawing.chart);
  if (!chart) return null;

  const fromAnchor = asRecord(drawing.fromAnchor);
  const toAnchor = asRecord(drawing.toAnchor);
  const fromCol = protocolNumber(fromAnchor?.colId, 0);
  const fromRow = protocolNumber(fromAnchor?.rowId, 0);
  const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(fromAnchor?.colOffset);
  const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(fromAnchor?.rowOffset);
  const extentWidth = spreadsheetEmuToPx(drawing.extentCx);
  const extentHeight = spreadsheetEmuToPx(drawing.extentCy);
  const fallbackRight = anchorEdgePx(toAnchor?.colId, toAnchor?.colOffset, "column", layout);
  const fallbackBottom = anchorEdgePx(toAnchor?.rowId, toAnchor?.rowOffset, "row", layout);

  return chartFromRecord(chart, {
    height: chartDimension(extentHeight, fallbackBottom - top, 120),
    left,
    top,
    width: chartDimension(extentWidth, fallbackRight - left, 180),
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
    .map((chart) => {
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
      });
    })
    .filter((chart): chart is SpreadsheetChartSpec => chart != null);
}

function chartFromRecord(
  chart: RecordValue,
  bounds: { height: number; left: number; top: number; width: number },
): SpreadsheetChartSpec | null {
  const seriesRecords = asArray(chart.series).map(asRecord).filter((item): item is RecordValue => item != null);
  const series = seriesRecords
    .map((item, index) => spreadsheetChartSeries(
      asString(item.label) || asString(item.name) || `Series ${index + 1}`,
      asArray(item.values).map((value) => protocolNumber(value, Number.NaN)).filter(Number.isFinite),
      index,
      protocolColorToCss(item.color),
    ))
    .filter((item) => item.values.length > 0);
  if (series.length === 0) return null;

  const categories = asArray(seriesRecords[0]?.categories).map(asString).filter(Boolean);
  return {
    categories: categories.length > 0 ? categories : series[0].values.map((_, index) => String(index + 1)),
    height: bounds.height,
    left: bounds.left,
    legendPosition: spreadsheetLegendPosition(chart.legend),
    series,
    title: asString(chart.title),
    top: bounds.top,
    type: spreadsheetChartType(chart),
    width: bounds.width,
    xAxis: spreadsheetChartAxis(chart.xAxis),
    yAxis: spreadsheetChartAxis(chart.yAxis),
  };
}

function spreadsheetChartSeries(
  label: string,
  values: number[],
  index: number,
  color?: string,
): SpreadsheetChartSeries {
  const palette = ["#1f6f8b", "#f9732a", "#5b7f2a", "#9467bd", "#8c564b"];
  return {
    color: color ?? palette[index % palette.length] ?? "#1f6f8b",
    label,
    marker: index % 2 === 0 ? "diamond" : "square",
    values,
  };
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

function spreadsheetChartType(chart: RecordValue): "bar" | "line" {
  const chartType = asString(chart.chartType).toLowerCase();
  const chartTypeId = protocolNumber(chart.type, 0);
  if (chartType === "line" || chartTypeId === 13) return "line";
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

function anchorEdgePx(
  indexValue: unknown,
  offsetValue: unknown,
  axis: "column" | "row",
  layout: SpreadsheetLayout,
): number {
  const index = optionalProtocolNumber(indexValue);
  if (index == null) return Number.NaN;
  const offset = spreadsheetEmuToPx(offsetValue);
  return axis === "column"
    ? spreadsheetColumnLeft(layout, index) + offset
    : spreadsheetRowTop(layout, index) + offset;
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
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 5 }}>
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
  const observedMax = Math.max(...values);
  const tickCount = chart.type === "line" ? 6 : 5;
  const minValue = chart.yAxis?.minimum ?? 0;
  const maxValue = chart.yAxis?.maximum ?? niceChartMax(observedMax, tickCount);

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#111827";
  context.font = "600 18px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(chart.title, width / 2, 28);

  drawChartGrid(context, plot, minValue, maxValue, tickCount);

  if (chart.type === "bar") {
    drawBarChart(context, chart, plot, minValue, maxValue);
  } else {
    drawLineChart(context, chart, plot, minValue, maxValue);
  }

  drawChartLegend(context, chart, plot);
}

function spreadsheetChartPlotArea(chart: SpreadsheetChartSpec) {
  return {
    bottom: chart.height - (chart.legendPosition === "bottom" ? 82 : chart.type === "line" ? 52 : 44),
    left: chart.type === "line" ? 42 : 38,
    right: chart.width - (chart.legendPosition === "right" ? 118 : 18),
    top: 58,
  };
}

function drawChartGrid(
  context: CanvasRenderingContext2D,
  plot: { bottom: number; left: number; right: number; top: number },
  minValue: number,
  maxValue: number,
  tickCount: number,
) {
  context.save();
  context.strokeStyle = "#d1d5db";
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.fillStyle = "#737373";
  context.font = "11px Arial, sans-serif";
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / (tickCount - 1);
    const y = plot.bottom - ratio * (plot.bottom - plot.top);
    const value = minValue + ratio * (maxValue - minValue);
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.right, y);
    context.stroke();
    context.fillText(String(Math.round(value)), plot.left - 8, y);
  }
  context.restore();
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
  plot: { bottom: number; top: number },
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
  plot: { bottom: number; left: number; right: number; top: number },
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
  context.font = "11px Arial, sans-serif";
  context.textAlign = "center";
  chart.categories.forEach((category, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    context.fillText(category, centerX, plot.bottom + 20);
  });
  context.restore();
}

function drawLineChart(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: { bottom: number; left: number; right: number; top: number },
  minValue: number,
  maxValue: number,
) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index: number) => plot.left + (index / pointCount) * (plot.right - plot.left);

  context.save();
  chart.series.forEach((series) => {
    context.strokeStyle = series.color;
    context.lineWidth = 2.5;
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
  context.font = "10px Arial, sans-serif";
  context.textAlign = "center";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });

  chart.series.forEach((series) => {
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      context.beginPath();
      if (series.marker === "diamond") {
        context.moveTo(x, y - 4);
        context.lineTo(x + 4, y);
        context.lineTo(x, y + 4);
        context.lineTo(x - 4, y);
      } else {
        context.rect(x - 4, y - 4, 8, 8);
      }
      context.closePath();
      context.fill();
    });
  });
  context.restore();
}

function drawChartLegend(
  context: CanvasRenderingContext2D,
  chart: SpreadsheetChartSpec,
  plot: { bottom: number; left: number; right: number; top: number },
) {
  if (chart.legendPosition === "none") return;

  context.save();
  if (chart.legendPosition === "right") {
    let legendY = plot.top + 18;
    const legendX = plot.right + 18;
    chart.series.forEach((series) => {
      drawLegendEntry(context, series, legendX, legendY);
      legendY += 20;
    });
    context.restore();
    return;
  }

  const legendY = chart.legendPosition === "top" ? 48 : chart.height - 18;
  let legendX = chart.width / 2 - chart.series.length * 56;
  chart.series.forEach((series) => {
    drawLegendEntry(context, series, legendX, legendY);
    legendX += 112;
  });
  context.restore();
}

function drawLegendEntry(
  context: CanvasRenderingContext2D,
  series: SpreadsheetChartSeries,
  x: number,
  y: number,
) {
  context.strokeStyle = series.color;
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(x, y - 4);
  context.lineTo(x + 18, y - 4);
  context.stroke();
  context.fillStyle = "#737373";
  context.textAlign = "left";
  context.font = "11px Arial, sans-serif";
  context.fillText(series.label, x + 26, y);
}
