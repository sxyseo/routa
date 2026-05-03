import { describe, expect, it } from "vitest";

import {
  buildSpreadsheetCharts,
  formatChartTick,
  spreadsheetBarChartGeometry,
  spreadsheetChartPlotArea,
  spreadsheetChartTickValues,
} from "../spreadsheet-charts";
import { buildSpreadsheetLayout, spreadsheetColumnLeft, spreadsheetRowTop } from "../spreadsheet-layout";

describe("spreadsheet charts", () => {
  it("builds chart specs from sheet drawing anchors", () => {
    const sheet = {
      drawings: [
        {
          chart: {
            legend: { position: 4 },
            series: [
              {
                categories: ["Jan 25", "Feb 25"],
                marker: {},
                name: "Fitness Score",
                values: [62.6, 64.5],
              },
            ],
            title: "Fitness Score vs Coverage",
            type: 13,
            yAxis: { minimum: 0 },
          },
          extentCx: "1905000",
          extentCy: "952500",
          fromAnchor: {
            colId: "1",
            colOffset: "9525",
            rowId: "2",
            rowOffset: "19050",
          },
        },
      ],
      name: "01_Dashboard",
      rows: [
        { cells: [{ address: "A1", value: "AI Coding Delivery Dashboard" }], index: 1 },
        { cells: [{ address: "B3", value: 62.6 }], index: 3 },
      ],
    };
    const layout = buildSpreadsheetLayout(sheet);

    const charts = buildSpreadsheetCharts({
      activeSheet: sheet,
      charts: [],
      layout,
      sheets: [sheet],
    });

    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({
      categories: ["Jan 25", "Feb 25"],
      height: 100,
      left: spreadsheetColumnLeft(layout, 1) + 1,
      legendPosition: "bottom",
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(layout, 2) + 2,
      type: "line",
      width: 200,
      yAxis: { minimum: 0 },
      zIndex: 0,
    });
    expect(charts[0]?.series[0]).toMatchObject({
      color: "#1f6f8b",
      label: "Fitness Score",
      marker: "diamond",
      values: [62.6, 64.5],
    });
  });

  it("uses Excel-like zero-based ticks and plot margins for line charts", () => {
    const chart = {
      categories: ["Jan 25", "Feb 25", "Mar 25"],
      height: 280,
      left: 0,
      legendOverlay: false,
      legendPosition: "bottom" as const,
      series: [
        { color: "#1f6f8b", label: "Fitness Score", marker: "diamond" as const, values: [62.6, 78.1, 89.9] },
      ],
      showDataLabels: false,
      title: "Fitness Score vs Coverage",
      top: 0,
      type: "line" as const,
      width: 640,
      yAxis: { majorGridLines: true, minimum: 0, numberFormat: "", position: "" },
      zIndex: 0,
    };

    expect(spreadsheetChartTickValues(chart, chart.series[0].values)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(spreadsheetChartPlotArea(chart)).toMatchObject({
      bottom: 192,
      left: 64,
      right: 618,
      top: 58,
    });
  });

  it("reserves chart plot space for non-overlay left and top legends", () => {
    const baseChart = {
      categories: ["Jan", "Feb"],
      height: 240,
      left: 0,
      series: [{ color: "#1f6f8b", label: "Series", marker: "square" as const, values: [10, 20] }],
      showDataLabels: false,
      title: "Legend Layout",
      top: 0,
      type: "line" as const,
      width: 360,
      yAxis: { majorGridLines: true, minimum: 0, numberFormat: "", position: "" },
      zIndex: 0,
    };

    expect(spreadsheetChartPlotArea({ ...baseChart, legendOverlay: false, legendPosition: "left" })).toMatchObject({
      left: 172,
      right: 338,
      top: 58,
    });
    expect(spreadsheetChartPlotArea({ ...baseChart, legendOverlay: true, legendPosition: "left" })).toMatchObject({
      left: 64,
      right: 338,
      top: 58,
    });
    expect(spreadsheetChartPlotArea({ ...baseChart, legendOverlay: false, legendPosition: "top" })).toMatchObject({
      top: 86,
    });
  });

  it("formats chart tick labels from axis number formats", () => {
    expect(formatChartTick(0.42, "0%")).toBe("42%");
    expect(formatChartTick(0.125, "0.00%")).toBe("12.50%");
    expect(formatChartTick(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(formatChartTick(1234.5, "#,##0")).toBe("1,235");
    expect(formatChartTick(12.345, "0.0")).toBe("12.3");
  });

  it("preserves non-line chart families from protocol ids", () => {
    const chartTypes = [
      [2, "area"],
      [5, "bubble"],
      [8, "doughnut"],
      [16, "pie"],
      [17, "radar"],
      [18, "scatter"],
      [22, "surface"],
    ] as const;

    const sheet = {
      drawings: chartTypes.map(([type], index) => ({
        chart: {
          series: [{ categories: ["1", "2", "3"], name: `Series ${index + 1}`, values: [10, 20, 30] }],
          title: `Chart ${index + 1}`,
          type,
          yAxis: { minimum: 0 },
        },
        extentCx: "1905000",
        extentCy: "952500",
        fromAnchor: { colId: "1", rowId: String(index + 1) },
      })),
      name: "Charts",
      rows: [],
    };
    const layout = buildSpreadsheetLayout(sheet);

    const charts = buildSpreadsheetCharts({
      activeSheet: sheet,
      charts: [],
      layout,
      sheets: [sheet],
    });

    expect(charts.map((chart) => chart.type)).toEqual(chartTypes.map(([, type]) => type));
    expect(spreadsheetChartPlotArea(charts[2]!)).toMatchObject({
      left: 28,
      right: 178,
    });
    expect(spreadsheetChartTickValues(charts[0]!, charts[0]?.series[0]?.values ?? [])).toHaveLength(6);
  });

  it("uses chart series markers only when the protocol exposes them", () => {
    const sheet = {
      drawings: [
        {
          chart: {
            series: [
              { categories: ["A", "B"], name: "No markers", values: [1, 2] },
              { categories: ["A", "B"], marker: {}, name: "With markers", values: [2, 3] },
            ],
            title: "Series markers",
            type: 13,
          },
          extentCx: "1905000",
          extentCy: "952500",
          fromAnchor: { colId: "1", rowId: "1" },
        },
      ],
      name: "Charts",
      rows: [],
    };
    const charts = buildSpreadsheetCharts({
      activeSheet: sheet,
      charts: [],
      layout: buildSpreadsheetLayout(sheet),
      sheets: [sheet],
    });

    expect(charts[0]?.series.map((series) => series.marker)).toEqual([null, "square"]);
  });

  it("preserves chart data-label visibility from protocol", () => {
    const sheet = {
      drawings: [
        {
          chart: {
            dataLabels: {},
            series: [{ categories: ["A", "B"], name: "Values", values: [1, 2] }],
            title: "Data Labels",
            type: 4,
          },
          extentCx: "1905000",
          extentCy: "952500",
          fromAnchor: { colId: "1", rowId: "1" },
        },
      ],
      name: "Charts",
      rows: [],
    };
    const charts = buildSpreadsheetCharts({
      activeSheet: sheet,
      charts: [],
      layout: buildSpreadsheetLayout(sheet),
      sheets: [sheet],
    });

    expect(charts[0]?.showDataLabels).toBe(true);
  });

  it("clusters bar geometry for every protocol series", () => {
    const chart = {
      categories: ["Q1", "Q2"],
      height: 240,
      left: 0,
      legendOverlay: false,
      legendPosition: "bottom" as const,
      series: [
        { color: "#1f6f8b", label: "Backlog", marker: null, values: [10, 20] },
        { color: "#f9732a", label: "Done", marker: null, values: [5, 15] },
      ],
      showDataLabels: false,
      title: "Multi-series bar",
      top: 0,
      type: "bar" as const,
      width: 360,
      zIndex: 0,
    };
    const bars = spreadsheetBarChartGeometry(chart, { left: 52, right: 338 });

    expect(bars).toHaveLength(4);
    expect(bars.map((bar) => bar.value)).toEqual([10, 5, 20, 15]);
    expect(bars[0]!.centerX).toBeLessThan(bars[1]!.centerX);
    expect(bars[1]!.centerX).toBeLessThan(bars[2]!.centerX);
    expect(bars.every((bar) => bar.barWidth > 0)).toBe(true);
  });
});
