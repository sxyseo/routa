"use client";

import { useEffect, useMemo, useRef } from "react";

import { buildSpreadsheetCanvasCommands } from "./spreadsheet-canvas-commands";
import {
  buildSpreadsheetCanvasRenderPlan,
  drawSpreadsheetCanvasRenderPlan,
} from "./spreadsheet-canvas-renderer";
import type {
  SpreadsheetLayout,
  SpreadsheetViewportScroll,
  SpreadsheetViewportSize,
} from "./spreadsheet-layout";

export function SpreadsheetCanvasLayer({
  layout,
  scroll,
  viewportSize,
}: {
  layout: SpreadsheetLayout;
  scroll: SpreadsheetViewportScroll;
  viewportSize: SpreadsheetViewportSize;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plan = useMemo(() => buildSpreadsheetCanvasRenderPlan({
    commands: buildSpreadsheetCanvasCommands({ layout, scroll, viewportSize }),
    pixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    scroll,
    viewportSize,
  }), [layout, scroll, viewportSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== plan.bitmap.pixelWidth) canvas.width = plan.bitmap.pixelWidth;
    if (canvas.height !== plan.bitmap.pixelHeight) canvas.height = plan.bitmap.pixelHeight;
    canvas.style.width = `${plan.bitmap.cssWidth}px`;
    canvas.style.height = `${plan.bitmap.cssHeight}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    drawSpreadsheetCanvasRenderPlan(context, plan);
  }, [plan]);

  if (viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  return (
    <canvas
      aria-hidden="true"
      ref={canvasRef}
      style={{
        height: viewportSize.height,
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
        width: viewportSize.width,
        zIndex: 0,
      }}
    />
  );
}
