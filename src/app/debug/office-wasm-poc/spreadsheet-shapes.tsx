"use client";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  imageReferenceId,
  type RecordValue,
} from "./office-preview-utils";
import { protocolColorToCss } from "./spreadsheet-conditional-visuals";
import {
  SPREADSHEET_FONT_FAMILY,
  spreadsheetColumnLeft,
  spreadsheetEmuToPx,
  type SpreadsheetLayout,
  spreadsheetRowTop,
} from "./spreadsheet-layout";

type SpreadsheetShapeSpec = {
  fill: string;
  geometry: number | string;
  height: number;
  id: string;
  left: number;
  line: string;
  lineWidth: number;
  text: string;
  top: number;
  width: number;
};

type SpreadsheetImageSpec = {
  height: number;
  id: string;
  left: number;
  src: string;
  top: number;
  width: number;
};

export function buildSpreadsheetShapes({
  activeSheet,
  layout,
  shapes,
}: {
  activeSheet: RecordValue | undefined;
  layout: SpreadsheetLayout;
  shapes: RecordValue[];
}): SpreadsheetShapeSpec[] {
  return [
    ...buildSheetDrawingShapes(activeSheet, layout),
    ...buildRootSpreadsheetShapes(activeSheet, layout, shapes),
  ];
}

export function buildSpreadsheetImages({
  activeSheet,
  imageSources,
  layout,
}: {
  activeSheet: RecordValue | undefined;
  imageSources: ReadonlyMap<string, string>;
  layout: SpreadsheetLayout;
}): SpreadsheetImageSpec[] {
  return asArray(activeSheet?.drawings)
    .map(asRecord)
    .filter((drawing): drawing is RecordValue => drawing != null)
    .map((drawing) => imageFromSheetDrawing(drawing, imageSources, layout))
    .filter((image): image is SpreadsheetImageSpec => image != null);
}

function buildSheetDrawingShapes(
  activeSheet: RecordValue | undefined,
  layout: SpreadsheetLayout,
): SpreadsheetShapeSpec[] {
  return asArray(activeSheet?.drawings)
    .map(asRecord)
    .filter((drawing): drawing is RecordValue => drawing != null)
    .map((drawing, index) => shapeFromSheetDrawing(drawing, layout, index))
    .filter((shape): shape is SpreadsheetShapeSpec => shape != null);
}

function shapeFromSheetDrawing(
  drawing: RecordValue,
  layout: SpreadsheetLayout,
  index: number,
): SpreadsheetShapeSpec | null {
  const shapeElement = asRecord(drawing.shape);
  if (!shapeElement) return null;

  const shape = asRecord(shapeElement.shape) ?? shapeElement;
  const bbox = asRecord(shapeElement.bbox);
  const line = asRecord(shape.line);
  const fromAnchor = asRecord(drawing.fromAnchor);
  const left = spreadsheetColumnLeft(layout, protocolNumber(fromAnchor?.colId, 0)) + spreadsheetEmuToPx(fromAnchor?.colOffset);
  const top = spreadsheetRowTop(layout, protocolNumber(fromAnchor?.rowId, 0)) + spreadsheetEmuToPx(fromAnchor?.rowOffset);
  const width = spreadsheetEmuToPx(drawing.extentCx) || spreadsheetEmuToPx(bbox?.widthEmu);
  const height = spreadsheetEmuToPx(drawing.extentCy) || spreadsheetEmuToPx(bbox?.heightEmu);

  return {
    fill: nestedProtocolColor(shape.fill) ?? "#ffffff",
    geometry: asNumber(shape.geometry, 0),
    height: Math.max(24, height),
    id: asString(shapeElement.id) || asString(shapeElement.name) || `sheet-shape-${index}`,
    left,
    line: nestedProtocolColor(line?.fill) ?? "#cbd5e1",
    lineWidth: Math.max(1, Math.min(4, spreadsheetEmuToPx(line?.widthEmu))),
    text: asString(shapeElement.text),
    top,
    width: Math.max(24, width),
  };
}

function imageFromSheetDrawing(
  drawing: RecordValue,
  imageSources: ReadonlyMap<string, string>,
  layout: SpreadsheetLayout,
): SpreadsheetImageSpec | null {
  const imageId = imageReferenceId(drawing.imageReference);
  const src = imageId ? imageSources.get(imageId) : undefined;
  if (!imageId || !src) return null;

  const bounds = drawingBounds(drawing, layout);
  return {
    height: bounds.height,
    id: imageId,
    left: bounds.left,
    src,
    top: bounds.top,
    width: bounds.width,
  };
}

function drawingBounds(drawing: RecordValue, layout: SpreadsheetLayout) {
  const fromAnchor = asRecord(drawing.fromAnchor);
  const toAnchor = asRecord(drawing.toAnchor);
  const fromCol = protocolNumber(fromAnchor?.colId, 0);
  const fromRow = protocolNumber(fromAnchor?.rowId, 0);
  const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(fromAnchor?.colOffset);
  const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(fromAnchor?.rowOffset);
  const width = spreadsheetEmuToPx(drawing.extentCx) || anchorEdgePx(toAnchor, "column", layout) - left;
  const height = spreadsheetEmuToPx(drawing.extentCy) || anchorEdgePx(toAnchor, "row", layout) - top;

  return {
    height: Math.max(24, height),
    left,
    top,
    width: Math.max(24, width),
  };
}

function anchorEdgePx(
  anchor: RecordValue | null,
  axis: "column" | "row",
  layout: SpreadsheetLayout,
): number {
  if (!anchor) return 0;

  if (axis === "column") {
    return spreadsheetColumnLeft(layout, protocolNumber(anchor.colId, layout.columnCount)) +
      spreadsheetEmuToPx(anchor.colOffset);
  }

  return spreadsheetRowTop(layout, protocolNumber(anchor.rowId, layout.rowCount)) +
    spreadsheetEmuToPx(anchor.rowOffset);
}

function buildRootSpreadsheetShapes(
  activeSheet: RecordValue | undefined,
  layout: SpreadsheetLayout,
  shapes: RecordValue[],
): SpreadsheetShapeSpec[] {
  const sheetName = asString(activeSheet?.name);
  return shapes
    .filter((shape) => asString(shape.sheetName) === sheetName)
    .map((shape, index) => {
      const fromCol = asNumber(shape.fromCol, 0);
      const fromRow = asNumber(shape.fromRow, 0);
      const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(shape.fromColOffsetEmu);
      const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(shape.fromRowOffsetEmu);
      const width = Math.max(24, spreadsheetEmuToPx(shape.widthEmu));
      const height = Math.max(24, spreadsheetEmuToPx(shape.heightEmu));

      return {
        fill: protocolColorToCss(shape.fillColor) ?? "#ffffff",
        geometry: asString(shape.geometry),
        height,
        id: asString(shape.id) || `shape-${index}`,
        left,
        line: protocolColorToCss(shape.lineColor) ?? "#cbd5e1",
        lineWidth: 1,
        text: asString(shape.text),
        top,
        width,
      };
    });
}

function nestedProtocolColor(value: unknown): string | undefined {
  const record = asRecord(value);
  return protocolColorToCss(record?.color ?? value);
}

function protocolNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function shapeBorderRadius(geometry: number | string): number | string {
  if (geometry === 26 || geometry === "roundRect") return 18;
  if (geometry === 35 || geometry === "ellipse") return "999px";
  return 0;
}

export function SpreadsheetShapeLayer({ shapes }: { shapes: SpreadsheetShapeSpec[] }) {
  if (shapes.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 4 }}>
      {shapes.map((shape) => (
        <div
          data-office-shape={shape.id}
          key={shape.id}
          style={{
            alignItems: "center",
            background: shape.fill,
            borderColor: shape.line,
            borderRadius: shapeBorderRadius(shape.geometry),
            borderStyle: "solid",
            borderWidth: shape.lineWidth,
            color: "#0f172a",
            display: "flex",
            fontFamily: SPREADSHEET_FONT_FAMILY,
            fontSize: 13,
            height: shape.height,
            justifyContent: "center",
            left: shape.left,
            lineHeight: 1.35,
            overflow: "hidden",
            padding: 12,
            position: "absolute",
            textAlign: "center",
            top: shape.top,
            whiteSpace: "pre-wrap",
            width: shape.width,
          }}
        >
          {shape.text}
        </div>
      ))}
    </div>
  );
}

export function SpreadsheetImageLayer({ images }: { images: SpreadsheetImageSpec[] }) {
  if (images.length === 0) return null;

  return (
    <div aria-hidden="true" style={{ inset: 0, pointerEvents: "none", position: "absolute", zIndex: 3 }}>
      {images.map((image) => (
        <div
          data-office-image={image.id}
          key={image.id}
          style={{
            backgroundImage: `url("${image.src}")`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 100%",
            display: "block",
            height: image.height,
            left: image.left,
            position: "absolute",
            top: image.top,
            width: image.width,
          }}
        />
      ))}
    </div>
  );
}
