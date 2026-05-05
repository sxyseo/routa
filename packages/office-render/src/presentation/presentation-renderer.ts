import {
  asNumber,
  asRecord,
  elementImageReferenceId,
  slideBackgroundToCss,
  type RecordValue,
} from "../shared/office-preview-utils";
import {
  drawPresentationChart,
  presentationChartById,
  presentationChartReferenceId,
} from "../shared/office-chart-renderer";
import { shapeFillToPaint } from "./presentation-fill-styles";
import {
  applyPresentationLayoutInheritance,
  emuRectToCanvasRect,
  getSlideBounds,
  presentationCanvasScale,
  presentationElements,
  presentationShapeKind,
  type PresentationRenderImages,
  type SlideElementEntry,
} from "./presentation-layout";
import {
  applyElementShadow,
  applyLineStyle,
  drawLineEnd,
  presentationElementLineStyle,
  type PresentationLineStyle,
} from "./presentation-line-styles";
import { customGeometryPath, elementPath } from "./presentation-shape-paths";
import { drawPresentationTable } from "./presentation-table-renderer";
import {
  drawPresentationTextBox,
  presentationScaledFontSize,
  type PresentationRect,
  type PresentationSize,
  type PresentationTextOverflow,
} from "./presentation-text-layout";

export {
  applyPresentationLayoutInheritance,
  collectPresentationTypefaces,
  computePresentationFit,
  emuRectToCanvasRect,
  getPresentationElementTargets,
  getSlideBounds,
  getSlideFrameSize,
  presentationImageSourceRect,
  presentationShapeKind,
  type PresentationElementTarget,
  type PresentationFit,
  type PresentationImageSourceRect,
  type PresentationRenderImages,
} from "./presentation-layout";
export {
  presentationElementLineStyle,
  presentationLineEndStyle,
  presentationLineStyle,
  presentationShadowStyle,
  type PresentationLineEndStyle,
  type PresentationLineStyle,
  type PresentationShadowStyle,
} from "./presentation-line-styles";
export { presentationGradientStops } from "./presentation-fill-styles";
export {
  presentationScaledFontSize,
  type PresentationRect,
  type PresentationSize,
  type PresentationTextOverflow,
};
export {
  presentationChartById,
  presentationChartReferenceId,
} from "../shared/office-chart-renderer";
export { presentationTableGrid } from "./presentation-table-renderer";

export function renderPresentationSlide({
  charts = [],
  context,
  height,
  images,
  layouts = [],
  slide,
  textOverflow = "visible",
  width,
}: {
  charts?: RecordValue[];
  context: CanvasRenderingContext2D;
  height: number;
  images: PresentationRenderImages;
  layouts?: RecordValue[];
  slide: RecordValue;
  textOverflow?: PresentationTextOverflow;
  width: number;
}): void {
  const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
  const bounds = getSlideBounds(effectiveSlide);
  const elements = presentationElements(effectiveSlide)
    .map((element, index) => ({ element, index }))
    .sort(
      (left, right) =>
        asNumber(left.element.zIndex, left.index) -
        asNumber(right.element.zIndex, right.index),
    );

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.fillStyle = slideBackgroundToCss(effectiveSlide);
  context.fillRect(0, 0, width, height);

  for (const entry of elements) {
    drawElement(context, entry, bounds, { height, width }, images, {
      charts,
      textOverflow,
    });
  }

  context.restore();
}

function drawElement(
  context: CanvasRenderingContext2D,
  { element }: SlideElementEntry,
  bounds: PresentationSize,
  canvas: PresentationSize,
  images: PresentationRenderImages,
  options: { charts: RecordValue[]; textOverflow: PresentationTextOverflow },
): void {
  const bbox = asRecord(element.bbox);
  const rect = emuRectToCanvasRect(bbox, bounds, canvas);
  if (rect.width <= 0 && rect.height <= 0) return;

  const slideScale = presentationCanvasScale(bounds, canvas);
  const shape = asRecord(element.shape);
  const line = presentationElementLineStyle(element, slideScale);
  const isLine = rect.height === 0 && line.color != null;
  const rotation = asNumber(bbox?.rotation) / 60_000;
  const horizontalFlip = bbox?.horizontalFlip === true;
  const verticalFlip = bbox?.verticalFlip === true;

  context.save();
  context.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (rotation !== 0) context.rotate((rotation * Math.PI) / 180);
  if (horizontalFlip || verticalFlip)
    context.scale(horizontalFlip ? -1 : 1, verticalFlip ? -1 : 1);
  context.translate(-rect.width / 2, -rect.height / 2);
  applyElementShadow(context, element, slideScale);

  const shapeKind = presentationShapeKind(shape, rect);
  if (isLine || shapeKind === "line") {
    drawLine(context, rect.width, rect.height, line);
    context.restore();
    return;
  }

  const path = customGeometryPath(shape, rect) ?? elementPath(shapeKind, rect);
  const fill = shapeFillToPaint(context, shape, element, line.color, rect);
  if (fill) {
    context.fillStyle = fill;
    context.fill(path);
  }

  const imageId = elementImageReferenceId(element);
  const image = imageId ? images.get(imageId) : undefined;
  if (image) {
    context.save();
    context.clip(path);
    drawElementImage(context, image, element, rect);
    context.restore();
  }

  if (line.color) {
    applyLineStyle(context, line);
    context.stroke(path);
    context.setLineDash([]);
  }

  const table = asRecord(element.table);
  if (table) {
    drawPresentationTable(
      context,
      element,
      table,
      rect,
      bounds,
      canvas,
      slideScale,
    );
    context.restore();
    return;
  }

  const chart = presentationChartById(
    options.charts,
    presentationChartReferenceId(element.chartReference),
  );
  if (chart) {
    drawPresentationChart(context, chart, rect, slideScale);
    context.restore();
    return;
  }

  drawPresentationTextBox({
    canvas,
    context,
    element,
    rect,
    slideBounds: bounds,
    slideScale,
    textOverflow: options.textOverflow,
  });
  context.restore();
}

function drawLine(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  line: PresentationLineStyle,
): void {
  if (!line.color) return;
  applyLineStyle(context, line);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, height);
  context.stroke();
  context.setLineDash([]);
  drawLineEnd(context, width, height, line.headEnd, line.color, false);
  drawLineEnd(context, width, height, line.tailEnd, line.color, true);
}

function drawElementImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  element: RecordValue,
  rect: PresentationRect,
): void {
  const naturalSize = imageNaturalSize(image);
  const sourceRect = elementImageSourceRect(element);
  if (!sourceRect || naturalSize.width <= 0 || naturalSize.height <= 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return;
  }

  const left = cropRatio(sourceRect.left ?? sourceRect.l);
  const top = cropRatio(sourceRect.top ?? sourceRect.t);
  const right = cropRatio(sourceRect.right ?? sourceRect.r);
  const bottom = cropRatio(sourceRect.bottom ?? sourceRect.b);
  const sourceWidth = naturalSize.width * Math.max(0.01, 1 - left - right);
  const sourceHeight = naturalSize.height * Math.max(0.01, 1 - top - bottom);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return;
  }

  context.drawImage(
    image,
    naturalSize.width * left,
    naturalSize.height * top,
    sourceWidth,
    sourceHeight,
    0,
    0,
    rect.width,
    rect.height,
  );
}

function imageNaturalSize(image: CanvasImageSource): PresentationSize {
  const record = image as unknown as Record<string, unknown>;
  return {
    height: asNumber(
      record.naturalHeight,
      asNumber(record.videoHeight, asNumber(record.height)),
    ),
    width: asNumber(
      record.naturalWidth,
      asNumber(record.videoWidth, asNumber(record.width)),
    ),
  };
}

function elementImageSourceRect(element: RecordValue): RecordValue | null {
  const shapeFill = asRecord(asRecord(element.shape)?.fill);
  const fill = asRecord(element.fill) ?? shapeFill;
  return (
    asRecord(fill?.sourceRect) ??
    asRecord(fill?.sourceRectangle) ??
    asRecord(fill?.srcRect) ??
    asRecord(fill?.stretchFillRect) ??
    asRecord(element.imageMask)
  );
}

function cropRatio(value: unknown): number {
  const raw = asNumber(value);
  if (raw <= 0) return 0;
  if (raw > 1) return clamp(raw / 100_000, 0, 0.99);
  return clamp(raw, 0, 0.99);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
