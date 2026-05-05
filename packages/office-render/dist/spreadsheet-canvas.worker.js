// src/shared/office-preview-utils.ts
import { useMemo } from "react";

// src/spreadsheet/spreadsheet-layout.ts
var EXCEL_POINTS_TO_PX = 96 / 72;

// src/spreadsheet/spreadsheet-canvas-renderer.ts
function drawSpreadsheetCanvasRenderPlan(context, plan) {
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
function drawSpreadsheetCanvasRect(context, rect) {
  if (rect.width <= 0 || rect.height <= 0) return;
  context.fillStyle = rect.fill ?? "#ffffff";
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  drawSpreadsheetCanvasBorders(context, rect);
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
  context.fillText(rect.text, spreadsheetCanvasTextX(rect, textAlign), spreadsheetCanvasTextY(rect));
  context.restore();
}
function drawSpreadsheetCanvasBorders(context, rect) {
  if (!rect.borderBottom && !rect.borderRight) {
    context.strokeStyle = rect.stroke ?? "#e2e8f0";
    context.lineWidth = 1;
    context.strokeRect(rect.left + 0.5, rect.top + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
    return;
  }
  drawSpreadsheetCanvasLine(context, {
    border: rect.borderRight,
    fallbackColor: rect.stroke,
    x1: rect.left + rect.width - 0.5,
    x2: rect.left + rect.width - 0.5,
    y1: rect.top,
    y2: rect.top + rect.height
  });
  drawSpreadsheetCanvasLine(context, {
    border: rect.borderBottom,
    fallbackColor: rect.stroke,
    x1: rect.left,
    x2: rect.left + rect.width,
    y1: rect.top + rect.height - 0.5,
    y2: rect.top + rect.height - 0.5
  });
}
function drawSpreadsheetCanvasLine(context, {
  border,
  fallbackColor,
  x1,
  x2,
  y1,
  y2
}) {
  const color = border?.color ?? fallbackColor ?? "#e2e8f0";
  if (color === "transparent") return;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, border?.width ?? 1);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}
function spreadsheetCanvasFont(rect) {
  const weight = rect.fontWeight ?? 500;
  const style = rect.fontStyle === "italic" ? "italic " : "";
  const size = Math.max(8, Math.min(32, rect.fontSize ?? 13));
  return `${style}${weight} ${size}px ${rect.fontFamily || "Aptos, Calibri, Arial, Helvetica, sans-serif"}`;
}
function spreadsheetCanvasTextX(rect, textAlign) {
  if (textAlign === "right") return rect.left + Math.max(0, rect.width - 8);
  if (textAlign === "center") return rect.left + rect.width / 2;
  return rect.left + (rect.paddingLeft ?? 8);
}
function spreadsheetCanvasTextY(rect) {
  if (rect.verticalAlign === "top") return rect.top + 8;
  if (rect.verticalAlign === "bottom") return rect.top + Math.max(8, rect.height - 8);
  return rect.top + rect.height / 2;
}

// src/spreadsheet/spreadsheet-canvas.worker.ts
var canvas = null;
self.onmessage = (event) => {
  const message = event.data;
  if (message.kind === "init") {
    canvas = message.canvas;
    return;
  }
  if (message.kind === "dispose") {
    canvas = null;
    self.close();
    return;
  }
  if (!canvas) return;
  if (canvas.width !== message.plan.bitmap.pixelWidth) canvas.width = message.plan.bitmap.pixelWidth;
  if (canvas.height !== message.plan.bitmap.pixelHeight) canvas.height = message.plan.bitmap.pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) return;
  drawSpreadsheetCanvasRenderPlan(context, message.plan);
};
