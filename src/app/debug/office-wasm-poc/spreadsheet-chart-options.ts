import { asNumber, asRecord, asString, type RecordValue } from "./office-preview-utils";

export type SpreadsheetChartRendererOptions = {
  barGapWidth: number;
  barOverlap: number;
  firstSliceAngle: number;
  holeSize: number;
  varyColors: boolean;
};

export function spreadsheetChartRendererOptions(chart: RecordValue): SpreadsheetChartRendererOptions {
  const barOptions = chartOptionsRecord(chart, "bar");
  const pieOptions = chartOptionsRecord(chart, "pie");
  const doughnutOptions = chartOptionsRecord(chart, "doughnut");
  return {
    barGapWidth: chartOptionNumber(barOptions, ["gapWidth"], 150),
    barOverlap: chartOptionNumber(barOptions, ["overlap"], 0),
    firstSliceAngle: chartOptionNumber(doughnutOptions ?? pieOptions ?? chart, ["firstSliceAngle", "firstSliceAng"], 0),
    holeSize: chartOptionNumber(doughnutOptions ?? chart, ["holeSize"], 55),
    varyColors: chartOptionBoolean(barOptions ?? doughnutOptions ?? pieOptions ?? chart, "varyColors"),
  };
}

function chartOptionsRecord(chart: RecordValue, family: string): RecordValue | null {
  return asRecord(chart[`${family}Options`]) ??
    asRecord(chart[`${family}ChartOptions`]) ??
    asRecord(chart[`${family}Chart`]);
}

function chartOptionNumber(record: RecordValue | null, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = asNumber(record?.[key], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function chartOptionBoolean(record: RecordValue | null, key: string): boolean {
  const value = record?.[key];
  return value === true || asString(value).toLowerCase() === "true" || asString(value) === "1";
}
