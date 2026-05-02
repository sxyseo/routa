import { describe, expect, it } from "vitest";

import { buildSpreadsheetCharts, spreadsheetChartPlotArea, spreadsheetChartTickValues } from "../spreadsheet-charts";
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
      legendPosition: "bottom" as const,
      series: [
        { color: "#1f6f8b", label: "Fitness Score", marker: "diamond" as const, values: [62.6, 78.1, 89.9] },
      ],
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
});
