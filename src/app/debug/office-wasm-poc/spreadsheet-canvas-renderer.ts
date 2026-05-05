import type {
  SpreadsheetCanvasCellCommand,
  SpreadsheetCanvasCommands,
  SpreadsheetCanvasHeaderCommand,
} from "./spreadsheet-canvas-commands";
import {
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
  type SpreadsheetViewportRect,
  type SpreadsheetViewportScroll,
  type SpreadsheetViewportSize,
} from "./spreadsheet-layout";

export type SpreadsheetCanvasBitmapSize = {
  cssHeight: number;
  cssWidth: number;
  pixelHeight: number;
  pixelRatio: number;
  pixelWidth: number;
};

export type SpreadsheetCanvasDrawRect = SpreadsheetViewportRect & {
  color?: string;
  fill?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: string;
  fontWeight?: number | string;
  paddingLeft?: number;
  stroke?: string;
  text?: string;
  textAlign?: "center" | "left" | "right";
};

export type SpreadsheetCanvasRenderPlan = {
  bitmap: SpreadsheetCanvasBitmapSize;
  cells: SpreadsheetCanvasDrawRect[];
  columnHeaders: SpreadsheetCanvasDrawRect[];
  corner: SpreadsheetCanvasDrawRect;
  rowHeaders: SpreadsheetCanvasDrawRect[];
};

export function spreadsheetCanvasBitmapSize(
  viewportSize: SpreadsheetViewportSize,
  pixelRatio: number,
): SpreadsheetCanvasBitmapSize {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const cssWidth = Math.max(0, Math.round(viewportSize.width));
  const cssHeight = Math.max(0, Math.round(viewportSize.height));
  return {
    cssHeight,
    cssWidth,
    pixelHeight: Math.max(1, Math.round(cssHeight * ratio)),
    pixelRatio: ratio,
    pixelWidth: Math.max(1, Math.round(cssWidth * ratio)),
  };
}

export function buildSpreadsheetCanvasRenderPlan({
  commands,
  pixelRatio,
  scroll,
  viewportSize,
}: {
  commands: SpreadsheetCanvasCommands;
  pixelRatio: number;
  scroll: SpreadsheetViewportScroll;
  viewportSize: SpreadsheetViewportSize;
}): SpreadsheetCanvasRenderPlan {
  return {
    bitmap: spreadsheetCanvasBitmapSize(viewportSize, pixelRatio),
    cells: commands.cells.map((cell) => spreadsheetCanvasCellRect(cell, scroll)),
    columnHeaders: commands.headers
      .filter((header) => header.type === "column")
      .map((header) => spreadsheetCanvasHeaderRect(header, scroll)),
    corner: {
      fill: "#f1f3f4",
      height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
      left: 0,
      stroke: "#dadce0",
      text: "",
      top: 0,
      width: SPREADSHEET_ROW_HEADER_WIDTH,
    },
    rowHeaders: commands.headers
      .filter((header) => header.type === "row")
      .map((header) => spreadsheetCanvasHeaderRect(header, scroll)),
  };
}

export function drawSpreadsheetCanvasRenderPlan(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  plan: SpreadsheetCanvasRenderPlan,
) {
  const { bitmap } = plan;
  context.setTransform(bitmap.pixelRatio, 0, 0, bitmap.pixelRatio, 0, 0);
  context.clearRect(0, 0, bitmap.cssWidth, bitmap.cssHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, bitmap.cssWidth, bitmap.cssHeight);

  for (const cell of plan.cells) {
    drawSpreadsheetCanvasRect(context, cell);
  }
  for (const header of plan.columnHeaders) {
    drawSpreadsheetCanvasRect(context, header);
  }
  for (const header of plan.rowHeaders) {
    drawSpreadsheetCanvasRect(context, header);
  }
  drawSpreadsheetCanvasRect(context, plan.corner);
}

function spreadsheetCanvasCellRect(
  cell: SpreadsheetCanvasCellCommand,
  scroll: SpreadsheetViewportScroll,
): SpreadsheetCanvasDrawRect {
  return {
    fill: cell.fill ?? "#ffffff",
    color: cell.color,
    fontFamily: cell.fontFamily,
    fontSize: cell.fontSize,
    fontStyle: cell.fontStyle,
    fontWeight: cell.fontWeight,
    height: cell.height,
    left: cell.left - scroll.left,
    paddingLeft: cell.paddingLeft,
    stroke: "#e2e8f0",
    text: cell.text,
    textAlign: cell.textAlign,
    top: cell.top - scroll.top,
    width: cell.width,
  };
}

function spreadsheetCanvasHeaderRect(
  header: SpreadsheetCanvasHeaderCommand,
  scroll: SpreadsheetViewportScroll,
): SpreadsheetCanvasDrawRect {
  return {
    fill: "#f1f3f4",
    height: header.height,
    left: header.type === "column" ? header.left - scroll.left : 0,
    stroke: "#dadce0",
    text: header.label,
    top: header.type === "row" ? header.top - scroll.top : 0,
    width: header.width,
  };
}

function drawSpreadsheetCanvasRect(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  rect: SpreadsheetCanvasDrawRect,
) {
  if (rect.width <= 0 || rect.height <= 0) return;
  context.fillStyle = rect.fill ?? "#ffffff";
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  context.strokeStyle = rect.stroke ?? "#e2e8f0";
  context.lineWidth = 1;
  context.strokeRect(rect.left + 0.5, rect.top + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
  if (!rect.text) return;
  context.fillStyle = rect.color ?? "#3c4043";
  context.font = spreadsheetCanvasFont(rect);
  const textAlign = rect.textAlign ?? "left";
  context.textAlign = textAlign;
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(rect.left + 3, rect.top + 1, Math.max(0, rect.width - 6), Math.max(0, rect.height - 2));
  context.clip();
  context.fillText(rect.text, spreadsheetCanvasTextX(rect, textAlign), rect.top + rect.height / 2);
  context.restore();
}

function spreadsheetCanvasFont(rect: SpreadsheetCanvasDrawRect): string {
  const weight = rect.fontWeight ?? 500;
  const style = rect.fontStyle === "italic" ? "italic " : "";
  const size = Math.max(8, Math.min(32, rect.fontSize ?? 13));
  return `${style}${weight} ${size}px ${rect.fontFamily || "Arial, Helvetica, sans-serif"}`;
}

function spreadsheetCanvasTextX(
  rect: SpreadsheetCanvasDrawRect,
  textAlign: CanvasTextAlign,
): number {
  if (textAlign === "right") return rect.left + Math.max(0, rect.width - 8);
  if (textAlign === "center") return rect.left + rect.width / 2;
  return rect.left + (rect.paddingLeft ?? 8);
}
