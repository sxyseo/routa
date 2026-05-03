"use client";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  cellText,
  columnIndexFromAddress,
  parseCellRange,
  type RecordValue,
  rowIndexFromAddress,
} from "./office-preview-utils";
import { protocolColorToCss, type SpreadsheetCellVisual } from "./spreadsheet-conditional-visuals";
import { spreadsheetCellKey } from "./spreadsheet-layout";

export type SpreadsheetSparklineVisual = {
  color: string;
  lineWeight: number;
  markers: boolean;
  type: "column" | "line" | "stacked";
  values: number[];
};

export type SpreadsheetValidationVisual = {
  formula: string;
  prompt: string;
  type: "dropdown" | "validation";
};

export function buildSpreadsheetSparklineVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetSparklineVisual> {
  const visuals = new Map<string, SpreadsheetSparklineVisual>();
  const rows = rowsByIndexForSheet(sheet);
  const groupRoot = asRecord(sheet?.sparklineGroups);
  const groups = (groupRoot ? asArray(groupRoot.groups) : asArray(sheet?.sparklineGroups))
    .map(asRecord)
    .filter((group): group is RecordValue => group != null);

  for (const group of groups) {
    const sparklines = asArray(group.sparklines).map(asRecord).filter((sparkline): sparkline is RecordValue => sparkline != null);
    for (const sparkline of sparklines) {
      const targetRange = parseCellRange(asString(sparkline.reference));
      if (!targetRange) continue;
      const values = sparklineValues(rows, asString(sparkline.formula) || asString(group.formula));
      if (values.length === 0) continue;
      visuals.set(spreadsheetCellKey(targetRange.startRow, targetRange.startColumn), {
        color: protocolColorToCss(group.seriesColor) ?? "#1f6f8b",
        lineWeight: Math.max(1, asNumber(group.lineWeight, 1.25)),
        markers: group.markers === true,
        type: spreadsheetSparklineType(group.type),
        values,
      });
    }
  }

  return visuals;
}

export function buildSpreadsheetCommentVisuals(root: RecordValue | null, sheet: RecordValue | undefined): Set<string> {
  const sheetName = asString(sheet?.name);
  const comments = new Set<string>();
  for (const item of [...asArray(root?.notes), ...asArray(root?.threads)]) {
    const record = asRecord(item);
    if (!record) continue;
    const target = spreadsheetCommentTarget(record);
    if (!target.address || (target.sheetName && sheetName && target.sheetName !== sheetName)) continue;
    comments.add(spreadsheetCellKey(rowIndexFromAddress(target.address), columnIndexFromAddress(target.address)));
  }
  return comments;
}

export function buildSpreadsheetValidationVisuals(sheet: RecordValue | undefined): Map<string, SpreadsheetValidationVisual> {
  const visuals = new Map<string, SpreadsheetValidationVisual>();
  for (const validation of spreadsheetDataValidationItems(sheet)) {
    const references = spreadsheetDataValidationReferences(validation);
    if (references.length === 0) continue;
    const typeCode = asNumber(validation.type, 0);
    const isDropdown = typeCode === 4 && validation.showDropDown !== true;
    for (const reference of references) {
      const range = parseCellRange(reference);
      if (!range) continue;
      for (let rowIndex = range.startRow; rowIndex < range.startRow + Math.min(range.rowSpan, 2048); rowIndex += 1) {
        for (let columnIndex = range.startColumn; columnIndex < range.startColumn + Math.min(range.columnSpan, 256); columnIndex += 1) {
          visuals.set(spreadsheetCellKey(rowIndex, columnIndex), {
            formula: asString(validation.formula1),
            prompt: asString(validation.prompt) || asString(validation.promptTitle),
            type: isDropdown ? "dropdown" : "validation",
          });
        }
      }
    }
  }
  return visuals;
}

export function SpreadsheetCellContent({
  hasComment,
  sparkline,
  text,
  validation,
  visual,
}: {
  hasComment?: boolean;
  sparkline?: SpreadsheetSparklineVisual;
  text: string;
  validation?: SpreadsheetValidationVisual;
  visual?: SpreadsheetCellVisual;
}) {
  return (
    <>
      {sparkline ? <SpreadsheetSparkline visual={sparkline} /> : null}
      {hasComment ? <SpreadsheetCommentIndicator /> : null}
      {visual?.dataBar ? (
        <>
          <span
            aria-hidden="true"
            style={{
              background: visual.dataBar.gradient
                ? `linear-gradient(90deg, ${visual.dataBar.color} 0%, ${visual.dataBar.color} 72%, rgba(255,255,255,0) 100%)`
                : visual.dataBar.color,
              bottom: 1,
              left: `${visual.dataBar.startPercent}%`,
              opacity: 0.75,
              position: "absolute",
              top: 1,
              width: `${visual.dataBar.widthPercent}%`,
              zIndex: 0,
            }}
          />
          {visual.dataBar.axisPercent === undefined ? null : (
            <span
              aria-hidden="true"
              style={{
                background: "rgba(31, 41, 55, 0.45)",
                bottom: 1,
                left: `${visual.dataBar.axisPercent}%`,
                position: "absolute",
                top: 1,
                width: 1,
                zIndex: 1,
              }}
            />
          )}
        </>
      ) : null}
      {visual?.iconSet ? <SpreadsheetIconSet visual={visual.iconSet} /> : null}
      {sparkline || visual?.iconSet?.showValue === false ? null : <span style={{ position: "relative", zIndex: 1 }}>{text}</span>}
      {validation ? <SpreadsheetValidationIndicator validation={validation} /> : null}
      {visual?.filter ? (
        <span
          aria-hidden="true"
          style={{
            alignItems: "center",
            background: "#ffffff",
            borderColor: "#cbd5e1",
            borderRadius: 3,
            borderStyle: "solid",
            borderWidth: 1,
            color: "#64748b",
            display: "inline-flex",
            fontSize: 9,
            height: 14,
            justifyContent: "center",
            lineHeight: 1,
            marginLeft: 6,
            position: "relative",
            top: -1,
            verticalAlign: "middle",
            width: 14,
            zIndex: 1,
          }}
        >
          ▾
        </span>
      ) : null}
    </>
  );
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
      cells.set(columnIndexFromAddress(asString(cellRecord.address)), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}

function sparklineValues(rows: Map<number, Map<number, RecordValue>>, reference: string): number[] {
  const range = parseCellRange(reference);
  if (!range) return [];
  const values: number[] = [];
  for (let rowIndex = range.startRow; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
    const row = rows.get(rowIndex);
    if (!row) continue;
    for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
      const value = Number(cellText(row.get(columnIndex)));
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

function spreadsheetSparklineType(value: unknown): SpreadsheetSparklineVisual["type"] {
  const raw = asNumber(value, 1);
  if (raw === 2) return "column";
  if (raw === 3) return "stacked";
  return "line";
}

function spreadsheetCommentTarget(record: RecordValue): { address: string; sheetName: string } {
  const target = asRecord(record.target);
  const cell = asRecord(target?.cell) ?? asRecord(target?.cellTarget) ?? asRecord(record.cell);
  return {
    address: asString(record.address) || asString(record.reference) || asString(target?.address) || asString(cell?.address),
    sheetName: asString(record.sheetName) || asString(target?.sheetName) || asString(cell?.sheetName),
  };
}

function spreadsheetDataValidationItems(sheet: RecordValue | undefined): RecordValue[] {
  const dataValidations = asRecord(sheet?.dataValidations);
  const rawItems = dataValidations ? asArray(dataValidations.items) : asArray(sheet?.dataValidations);
  return rawItems.map(asRecord).filter((validation): validation is RecordValue => validation != null);
}

function spreadsheetDataValidationReferences(validation: RecordValue): string[] {
  const ranges = asArray(validation.ranges);
  if (ranges.length > 0) {
    return ranges.map((range) => {
      if (typeof range === "string") return range;
      const record = asRecord(range);
      if (!record) return "";
      const startAddress = asString(record.startAddress);
      const endAddress = asString(record.endAddress);
      return startAddress && endAddress && startAddress !== endAddress ? `${startAddress}:${endAddress}` : startAddress;
    }).filter(Boolean);
  }
  return asString(validation.range || validation.reference || validation.sqref).split(/\s+/).filter(Boolean);
}

function SpreadsheetValidationIndicator({ validation }: { validation: SpreadsheetValidationVisual }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: validation.type === "dropdown" ? "#f8fafc" : "#ffffff",
        borderColor: "#cbd5e1",
        borderRadius: 3,
        borderStyle: "solid",
        borderWidth: 1,
        bottom: 4,
        color: "#475569",
        display: "inline-flex",
        fontSize: 9,
        height: 14,
        justifyContent: "center",
        lineHeight: 1,
        position: "absolute",
        right: 4,
        width: 14,
        zIndex: 2,
      }}
      title={validation.prompt || validation.formula}
    >
      {validation.type === "dropdown" ? "▾" : "!"}
    </span>
  );
}

function SpreadsheetCommentIndicator() {
  return (
    <span
      aria-hidden="true"
      style={{
        borderLeftColor: "transparent",
        borderLeftStyle: "solid",
        borderLeftWidth: 8,
        borderTopColor: "#f97316",
        borderTopStyle: "solid",
        borderTopWidth: 8,
        height: 0,
        position: "absolute",
        right: 0,
        top: 0,
        width: 0,
        zIndex: 3,
      }}
    />
  );
}

function SpreadsheetSparkline({ visual }: { visual: SpreadsheetSparklineVisual }) {
  const width = 100;
  const height = 28;
  const values = visual.values;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = Math.max(1, max - min);
  const xForIndex = (index: number) => 4 + (index / Math.max(1, values.length - 1)) * (width - 8);
  const yForValue = (value: number) => height - 4 - ((value - min) / span) * (height - 8);
  const points = values.map((value, index) => `${xForIndex(index)},${yForValue(value)}`).join(" ");

  return (
    <svg
      aria-hidden="true"
      preserveAspectRatio="none"
      style={{ inset: "3px 5px", pointerEvents: "none", position: "absolute", zIndex: 1 }}
      viewBox={`0 0 ${width} ${height}`}
    >
      {visual.type === "line" ? (
        <>
          <polyline fill="none" points={points} stroke={visual.color} strokeLinejoin="round" strokeWidth={visual.lineWeight} />
          {visual.markers ? values.map((value, index) => (
            <circle cx={xForIndex(index)} cy={yForValue(value)} fill={visual.color} key={index} r="1.8" />
          )) : null}
        </>
      ) : (
        values.map((value, index) => {
          const barWidth = Math.max(2, (width - 8) / Math.max(1, values.length) * 0.55);
          const x = xForIndex(index) - barWidth / 2;
          const zeroY = yForValue(0);
          const valueY = yForValue(visual.type === "stacked" ? Math.abs(value) : value);
          return (
            <rect
              fill={visual.color}
              height={Math.max(1, Math.abs(zeroY - valueY))}
              key={index}
              width={barWidth}
              x={x}
              y={Math.min(zeroY, valueY)}
            />
          );
        })
      )}
    </svg>
  );
}

function SpreadsheetIconSet({ visual }: { visual: NonNullable<SpreadsheetCellVisual["iconSet"]> }) {
  const glyph = spreadsheetIconSetGlyph(visual);
  if (glyph) {
    return (
      <span
        aria-hidden="true"
        style={{
          color: visual.color,
          display: "inline-block",
          fontSize: 15,
          fontWeight: 700,
          lineHeight: "14px",
          marginRight: visual.showValue ? 5 : 0,
          position: "relative",
          textAlign: "center",
          top: 1,
          width: 18,
          zIndex: 1,
        }}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "end",
        display: "inline-flex",
        gap: 1,
        height: 14,
        justifyContent: "center",
        marginRight: visual.showValue ? 5 : 0,
        position: "relative",
        top: 2,
        width: 18,
        zIndex: 1,
      }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          style={{
            background: index < visual.level ? visual.color : "#d1d5db",
            display: "inline-block",
            height: 3 + index * 2,
            opacity: index < visual.level ? 1 : 0.45,
            width: 2,
          }}
        />
      ))}
    </span>
  );
}

function spreadsheetIconSetGlyph(visual: NonNullable<SpreadsheetCellVisual["iconSet"]>): string {
  const iconSet = visual.iconSet.toLowerCase();
  const zeroBasedLevel = Math.max(0, Math.min(visual.levelCount - 1, visual.level - 1));
  if (iconSet.includes("rating") || iconSet.includes("quarter")) {
    return ["☆", "◔", "◑", "◕", "★"][zeroBasedLevel] ?? "★";
  }

  if (iconSet.includes("arrow")) {
    const arrows = visual.levelCount >= 5 ? ["▼", "↘", "→", "↗", "▲"] : ["▼", "→", "▲"];
    return arrows[Math.min(arrows.length - 1, zeroBasedLevel)] ?? "→";
  }

  if (iconSet.includes("traffic") || iconSet.includes("symbol") || iconSet.includes("sign")) {
    return "●";
  }

  return "";
}
