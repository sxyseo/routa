"use client";

import type { CSSProperties } from "react";

import { columnLabel } from "./office-preview-utils";
import {
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_FONT_FAMILY,
  SPREADSHEET_ROW_HEADER_WIDTH,
  spreadsheetColumnLeft,
  type SpreadsheetLayout,
  spreadsheetRowTop,
} from "./spreadsheet-layout";

type SpreadsheetHeaderRect = {
  height: number;
  left?: number;
  top?: number;
  width: number;
};

export function spreadsheetFrozenColumnHeaderRect(
  layout: SpreadsheetLayout,
  columnIndex: number,
  scrollLeft: number,
): SpreadsheetHeaderRect {
  return {
    height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
    left: spreadsheetColumnLeft(layout, columnIndex) - SPREADSHEET_ROW_HEADER_WIDTH - scrollLeft,
    width: layout.columnWidths[columnIndex] ?? 0,
  };
}

export function spreadsheetFrozenRowHeaderRect(
  layout: SpreadsheetLayout,
  rowOffset: number,
  scrollTop: number,
): SpreadsheetHeaderRect {
  return {
    height: layout.rowHeights[rowOffset] ?? 0,
    top: spreadsheetRowTop(layout, rowOffset) - SPREADSHEET_COLUMN_HEADER_HEIGHT - scrollTop,
    width: SPREADSHEET_ROW_HEADER_WIDTH,
  };
}

export function SpreadsheetFrozenHeaders({
  layout,
  scrollLeft,
  scrollTop,
}: {
  layout: SpreadsheetLayout;
  scrollLeft: number;
  scrollTop: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
        zIndex: 12,
      }}
    >
      <div style={spreadsheetFrozenCornerStyle} />
      <div
        style={{
          height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
          left: SPREADSHEET_ROW_HEADER_WIDTH,
          overflow: "hidden",
          position: "absolute",
          right: 0,
          top: 0,
        }}
      >
        <div
          style={{
            height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
            position: "relative",
            width: Math.max(0, layout.gridWidth - SPREADSHEET_ROW_HEADER_WIDTH),
          }}
        >
          {Array.from({ length: layout.columnCount }, (_, columnIndex) => {
            const rect = spreadsheetFrozenColumnHeaderRect(layout, columnIndex, scrollLeft);
            return (
              <div
                key={columnIndex}
                style={{
                  ...spreadsheetFrozenHeaderBaseStyle,
                  height: rect.height,
                  left: rect.left,
                  top: 0,
                  width: rect.width,
                }}
              >
                {columnLabel(columnIndex)}
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          bottom: 0,
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: SPREADSHEET_COLUMN_HEADER_HEIGHT,
          width: SPREADSHEET_ROW_HEADER_WIDTH,
        }}
      >
        <div
          style={{
            height: Math.max(0, layout.gridHeight - SPREADSHEET_COLUMN_HEADER_HEIGHT),
            position: "relative",
            width: SPREADSHEET_ROW_HEADER_WIDTH,
          }}
        >
          {Array.from({ length: layout.rowCount }, (_, rowOffset) => {
            const rect = spreadsheetFrozenRowHeaderRect(layout, rowOffset, scrollTop);
            return (
              <div
                key={rowOffset}
                style={{
                  ...spreadsheetFrozenHeaderBaseStyle,
                  height: rect.height,
                  left: 0,
                  top: rect.top,
                  width: rect.width,
                }}
              >
                {rowOffset + 1}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const spreadsheetFrozenHeaderBaseStyle: CSSProperties = {
  alignItems: "center",
  background: "#f1f3f4",
  borderBottomColor: "#dadce0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#dadce0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#3c4043",
  display: "flex",
  fontFamily: SPREADSHEET_FONT_FAMILY,
  fontSize: 13,
  fontWeight: 500,
  justifyContent: "center",
  overflow: "hidden",
  padding: "0 4px",
  position: "absolute",
};

const spreadsheetFrozenCornerStyle: CSSProperties = {
  ...spreadsheetFrozenHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  left: 0,
  top: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 2,
};
