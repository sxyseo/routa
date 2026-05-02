import {
  asArray,
  asNumber,
  asRecord,
  asString,
  fillToCss,
  type RecordValue,
} from "./office-preview-utils";
import type { PresentationRect } from "./presentation-text-layout";

const PRESENTATION_CHART_COLORS = ["#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"];

type ChartSeries = {
  categories: string[];
  color: string;
  name: string;
  values: number[];
};

type ChartPlot = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function presentationChartById(charts: RecordValue[], id: string): RecordValue | null {
  if (!id) return null;
  return charts.find((chart) => presentationChartId(chart) === id) ?? null;
}

export function presentationChartId(chart: RecordValue): string {
  return (
    asString(chart.id) ||
    asString(chart.uri) ||
    asString(chart.chartId) ||
    asString(chart.relationshipId) ||
    asString(chart.name)
  );
}

export function presentationChartReferenceId(value: unknown): string {
  const record = asRecord(value);
  return (
    asString(record?.id) ||
    asString(record?.chartId) ||
    asString(record?.relationshipId) ||
    asString(record?.referenceId) ||
    asString(record?.ref)
  );
}

export function drawPresentationChart(
  context: CanvasRenderingContext2D,
  chart: RecordValue,
  rect: PresentationRect,
  slideScale: number,
): void {
  context.save();
  context.beginPath();
  context.rect(0, 0, rect.width, rect.height);
  context.clip();

  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.fillRect(0, 0, rect.width, rect.height);
  context.strokeStyle = "rgba(203, 213, 225, 0.9)";
  context.lineWidth = Math.max(1, slideScale);
  context.strokeRect(0, 0, rect.width, rect.height);

  const title = asString(chart.title);
  const titleHeight = title ? Math.max(18, 20 * slideScale) : 0;
  if (title) {
    context.fillStyle = "#111827";
    context.font = `600 ${Math.max(10, 14 * slideScale)}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(title, rect.width / 2, Math.max(4, 8 * slideScale), Math.max(1, rect.width - 16));
  }

  const series = presentationChartSeries(chart);
  if (series.length === 0) {
    context.restore();
    return;
  }

  const plot = {
    height: Math.max(1, rect.height - titleHeight - 44 * slideScale),
    left: Math.max(22, 38 * slideScale),
    top: titleHeight + Math.max(10, 18 * slideScale),
    width: Math.max(1, rect.width - Math.max(38, 58 * slideScale)),
  };

  const type = asNumber(chart.type);
  if (type === 16 || type === 8) {
    drawPieChart(context, series[0], plot, type === 8, slideScale);
  } else if (type === 13 || type === 2 || type === 18) {
    drawLineChart(context, series, plot, slideScale);
  } else {
    drawBarChart(context, series, plot, asNumber(chart.barDirection) === 2, slideScale);
  }

  if (chart.hasLegend === true || asNumber(chart.hasLegend) > 0) {
    drawChartLegend(context, series, rect, slideScale);
  }
  context.restore();
}

function presentationChartSeries(chart: RecordValue): ChartSeries[] {
  const chartCategories = asArray(chart.categories).map(asString).filter(Boolean);
  return asArray(chart.series)
    .map(asRecord)
    .filter((series): series is RecordValue => series != null)
    .map((series, index) => {
      const values = asArray(series.values ?? series.data)
        .map((value) => asNumber(value, Number.NaN))
        .filter(Number.isFinite);
      const seriesCategories = asArray(series.categories).map(asString).filter(Boolean);
      return {
        categories: seriesCategories.length > 0 ? seriesCategories : chartCategories,
        color: fillToCss(series.fill) ?? PRESENTATION_CHART_COLORS[index % PRESENTATION_CHART_COLORS.length] ?? "#156082",
        name: asString(series.name) || `Series ${index + 1}`,
        values,
      };
    })
    .filter((series) => series.values.length > 0);
}

function drawBarChart(
  context: CanvasRenderingContext2D,
  series: ChartSeries[],
  plot: ChartPlot,
  horizontal: boolean,
  slideScale: number,
): void {
  const values = series.flatMap((item) => item.values);
  const max = Math.max(1, ...values);
  drawChartGrid(context, plot, 0, max, slideScale);
  const categoryCount = Math.max(...series.map((item) => item.values.length));
  if (categoryCount <= 0) return;

  if (horizontal) {
    const rowHeight = plot.height / categoryCount;
    const barHeight = Math.max(1, (rowHeight * 0.72) / series.length);
    for (const [seriesIndex, item] of series.entries()) {
      context.fillStyle = item.color;
      for (const [index, value] of item.values.entries()) {
        const width = (Math.max(0, value) / max) * plot.width;
        const x = plot.left;
        const y = plot.top + index * rowHeight + rowHeight * 0.14 + seriesIndex * barHeight;
        context.fillRect(x, y, width, Math.max(1, barHeight * 0.82));
      }
    }
    drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, true, slideScale);
    return;
  }

  const columnWidth = plot.width / categoryCount;
  const barWidth = Math.max(1, (columnWidth * 0.72) / series.length);
  for (const [seriesIndex, item] of series.entries()) {
    context.fillStyle = item.color;
    for (const [index, value] of item.values.entries()) {
      const height = (Math.max(0, value) / max) * plot.height;
      const x = plot.left + index * columnWidth + columnWidth * 0.14 + seriesIndex * barWidth;
      const y = plot.top + plot.height - height;
      context.fillRect(x, y, Math.max(1, barWidth * 0.82), height);
    }
  }
  drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, false, slideScale);
}

function drawLineChart(context: CanvasRenderingContext2D, series: ChartSeries[], plot: ChartPlot, slideScale: number): void {
  const values = series.flatMap((item) => item.values);
  const range = chartAxisRange(values, false);
  drawChartGrid(context, plot, range.min, range.max, slideScale);
  const maxPoints = Math.max(...series.map((item) => item.values.length));
  const xStep = maxPoints <= 1 ? plot.width : plot.width / (maxPoints - 1);

  for (const item of series) {
    context.strokeStyle = item.color;
    context.lineWidth = Math.max(1.5, slideScale * 1.8);
    context.beginPath();
    item.values.forEach((value, index) => {
      const x = plot.left + index * xStep;
      const y = plot.top + plot.height - ((value - range.min) / Math.max(1, range.max - range.min)) * plot.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
  drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, false, slideScale);
}

function drawPieChart(
  context: CanvasRenderingContext2D,
  series: ChartSeries,
  plot: ChartPlot,
  doughnut: boolean,
  slideScale: number,
): void {
  const total = series.values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return;
  const radius = Math.max(1, Math.min(plot.width, plot.height) * 0.42);
  const cx = plot.left + plot.width / 2;
  const cy = plot.top + plot.height / 2;
  let angle = -Math.PI / 2;
  for (const [index, value] of series.values.entries()) {
    const nextAngle = angle + (Math.max(0, value) / total) * Math.PI * 2;
    context.fillStyle = PRESENTATION_CHART_COLORS[index % PRESENTATION_CHART_COLORS.length] ?? series.color;
    context.beginPath();
    context.moveTo(cx, cy);
    context.arc(cx, cy, radius, angle, nextAngle);
    context.closePath();
    context.fill();
    angle = nextAngle;
  }

  if (doughnut) {
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.arc(cx, cy, radius * 0.48, 0, Math.PI * 2);
    context.fill();
  }

  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.lineWidth = Math.max(1, slideScale);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
}

function drawChartGrid(
  context: CanvasRenderingContext2D,
  plot: ChartPlot,
  min: number,
  max: number,
  slideScale: number,
): void {
  context.strokeStyle = "rgba(148, 163, 184, 0.42)";
  context.lineWidth = Math.max(0.5, slideScale);
  context.setLineDash([Math.max(2, slideScale * 3), Math.max(2, slideScale * 2)]);
  for (let index = 0; index <= 4; index++) {
    const y = plot.top + (plot.height / 4) * index;
    context.beginPath();
    context.moveTo(plot.left, y);
    context.lineTo(plot.left + plot.width, y);
    context.stroke();
  }
  context.setLineDash([]);
  context.strokeStyle = "rgba(100, 116, 139, 0.65)";
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.top + plot.height);
  context.lineTo(plot.left + plot.width, plot.top + plot.height);
  context.stroke();

  context.fillStyle = "#64748b";
  context.font = `400 ${Math.max(8, 10 * slideScale)}px Arial, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index++) {
    const value = max - ((max - min) / 4) * index;
    const y = plot.top + (plot.height / 4) * index;
    context.fillText(formatChartTick(value), plot.left - Math.max(4, 6 * slideScale), y);
  }
}

function drawChartCategoryLabels(
  context: CanvasRenderingContext2D,
  categories: string[],
  plot: ChartPlot,
  horizontal: boolean,
  slideScale: number,
): void {
  if (categories.length === 0) return;
  context.fillStyle = "#64748b";
  context.font = `400 ${Math.max(7, 9 * slideScale)}px Arial, sans-serif`;
  context.textBaseline = "top";

  if (horizontal) {
    context.textAlign = "right";
    const rowHeight = plot.height / categories.length;
    categories.slice(0, 12).forEach((category, index) => {
      context.fillText(category, plot.left - Math.max(4, 6 * slideScale), plot.top + index * rowHeight + rowHeight * 0.3);
    });
    return;
  }

  context.textAlign = "center";
  const step = categories.length <= 1 ? plot.width : plot.width / categories.length;
  const labelEvery = Math.max(1, Math.ceil(categories.length / 8));
  categories.forEach((category, index) => {
    if (index % labelEvery !== 0) return;
    const x = plot.left + step * index + step / 2;
    context.fillText(category, x, plot.top + plot.height + Math.max(4, 6 * slideScale), step * labelEvery);
  });
}

function drawChartLegend(context: CanvasRenderingContext2D, series: ChartSeries[], rect: PresentationRect, slideScale: number): void {
  const swatch = Math.max(6, 8 * slideScale);
  const textSize = Math.max(8, 10 * slideScale);
  context.font = `400 ${textSize}px Arial, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  let x = Math.max(8, rect.width * 0.2);
  const y = rect.height - Math.max(8, 14 * slideScale);
  for (const item of series.slice(0, 4)) {
    context.fillStyle = item.color;
    context.fillRect(x, y - swatch / 2, swatch, swatch);
    x += swatch + 4 * slideScale;
    context.fillStyle = "#64748b";
    context.fillText(item.name, x, y);
    x += context.measureText(item.name).width + 14 * slideScale;
  }
}

function chartAxisRange(values: number[], includeZero: boolean): { max: number; min: number } {
  if (values.length === 0) return { max: 1, min: 0 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  return { max: max + padding, min: min - padding };
}

function formatChartTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/u, "");
}
