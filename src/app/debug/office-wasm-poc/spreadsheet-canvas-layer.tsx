"use client";

import { useEffect, useMemo, useRef } from "react";

import { buildSpreadsheetCanvasCommands } from "./spreadsheet-canvas-commands";
import { createSpreadsheetCanvasFrameScheduler } from "./spreadsheet-canvas-frame-scheduler";
import {
  buildSpreadsheetCanvasRenderPlan,
  drawSpreadsheetCanvasRenderPlan,
  type SpreadsheetCanvasRenderPlan,
} from "./spreadsheet-canvas-renderer";
import { spreadsheetCanvasWorkerCapabilities } from "./spreadsheet-canvas-worker-protocol";
import type {
  SpreadsheetLayout,
  SpreadsheetViewportScroll,
  SpreadsheetViewportSize,
} from "./spreadsheet-layout";

function drawSpreadsheetCanvasPlanToCanvas(
  canvas: HTMLCanvasElement | null,
  nextPlan: SpreadsheetCanvasRenderPlan,
) {
  if (!canvas) return;
  if (canvas.width !== nextPlan.bitmap.pixelWidth) canvas.width = nextPlan.bitmap.pixelWidth;
  if (canvas.height !== nextPlan.bitmap.pixelHeight) canvas.height = nextPlan.bitmap.pixelHeight;
  canvas.style.width = `${nextPlan.bitmap.cssWidth}px`;
  canvas.style.height = `${nextPlan.bitmap.cssHeight}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  drawSpreadsheetCanvasRenderPlan(context, nextPlan);
}

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
  const schedulerRef = useRef<ReturnType<typeof createSpreadsheetCanvasFrameScheduler> | null>(null);
  const renderer = useMemo(() => spreadsheetCanvasWorkerCapabilities().preferredRenderer, []);
  const plan = useMemo(() => buildSpreadsheetCanvasRenderPlan({
    commands: buildSpreadsheetCanvasCommands({ layout, scroll, viewportSize }),
    pixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    scroll,
    viewportSize,
  }), [layout, scroll, viewportSize]);

  useEffect(() => {
    if (!schedulerRef.current) {
      schedulerRef.current = createSpreadsheetCanvasFrameScheduler({
        draw: (nextPlan) => drawSpreadsheetCanvasPlanToCanvas(canvasRef.current, nextPlan),
      });
    }
    schedulerRef.current.schedule(plan);
  }, [plan]);

  useEffect(() => () => schedulerRef.current?.destroy(), []);

  if (viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  return (
    <canvas
      aria-hidden="true"
      data-renderer={renderer}
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
