import {
  asArray,
  asNumber,
  asRecord,
  asString,
  colorToCss,
  elementImageReferenceId,
  fillToCss,
  lineToCss,
  slideBackgroundToCss,
  type RecordValue,
} from "./office-preview-utils";
import {
  drawPresentationTextBox,
  presentationScaledFontSize,
  type PresentationRect,
  type PresentationSize,
  type PresentationTextOverflow,
} from "./presentation-text-layout";

const DEFAULT_SLIDE_BOUNDS = { width: 12_192_000, height: 6_858_000 };
const EMU_PER_CSS_PIXEL = 9_525;
const FIT_PADDING = 48;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

export type PresentationFit = PresentationSize & {
  scale: number;
};

export type PresentationElementTarget = {
  element: RecordValue;
  id: string;
  index: number;
  name: string;
  rect: PresentationRect;
};

export type PresentationImageSourceRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type PresentationLineStyle = {
  color?: string;
  dash: number[];
  headEnd: PresentationLineEndStyle | null;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  tailEnd: PresentationLineEndStyle | null;
  width: number;
};

export type PresentationLineEndStyle = {
  length: number;
  type: number;
  width: number;
};

export type PresentationShadowStyle = {
  blur: number;
  color: string;
  offsetX: number;
  offsetY: number;
};

export type PresentationRenderImages = ReadonlyMap<string, CanvasImageSource>;
export { presentationScaledFontSize, type PresentationRect, type PresentationSize, type PresentationTextOverflow };

type SlideElementEntry = {
  element: RecordValue;
  index: number;
};

type PresentationShapeKind =
  | "bracePair"
  | "bracketPair"
  | "diamond"
  | "ellipse"
  | "hexagon"
  | "line"
  | "parallelogram"
  | "rect"
  | "roundRect"
  | "trapezoid"
  | "triangle";

export function computePresentationFit(
  viewport: PresentationSize,
  frame: PresentationSize,
  options: { padding?: number; zoom?: number } = {},
): PresentationFit {
  const padding = options.padding ?? FIT_PADDING;
  const zoom = clamp(options.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
  if (viewport.width <= 0 || viewport.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { height: 0, scale: 0, width: 0 };
  }

  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const fitScale = Math.min(availableWidth / frame.width, availableHeight / frame.height);
  const scale = Math.max(0.05, fitScale) * zoom;
  return {
    height: frame.height * scale,
    scale,
    width: frame.width * scale,
  };
}

export function getSlideBounds(slide: RecordValue): PresentationSize {
  const elements = presentationElements(slide);
  return elements.reduce<PresentationSize>(
    (acc, element) => {
      const bbox = asRecord(element.bbox);
      return {
        height: Math.max(acc.height, asNumber(bbox?.yEmu) + Math.max(0, asNumber(bbox?.heightEmu))),
        width: Math.max(acc.width, asNumber(bbox?.xEmu) + Math.max(0, asNumber(bbox?.widthEmu))),
      };
    },
    { ...DEFAULT_SLIDE_BOUNDS },
  );
}

export function getSlideFrameSize(slide: RecordValue): PresentationSize {
  const bounds = getSlideBounds(slide);
  return {
    height: bounds.height / EMU_PER_CSS_PIXEL,
    width: bounds.width / EMU_PER_CSS_PIXEL,
  };
}

export function emuRectToCanvasRect(bbox: RecordValue | null, bounds: PresentationSize, canvas: PresentationSize): PresentationRect {
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  return {
    height: asNumber(bbox?.heightEmu) * scaleY,
    left: asNumber(bbox?.xEmu) * scaleX,
    top: asNumber(bbox?.yEmu) * scaleY,
    width: asNumber(bbox?.widthEmu) * scaleX,
  };
}

export function presentationShapeKind(shape: RecordValue | null, rect: PresentationRect): PresentationShapeKind {
  const geometry = asNumber(shape?.geometry);
  if (geometry === 1) return "line";
  if (geometry === 23) return "triangle";
  if (geometry === 26) return "roundRect";
  if (geometry === 30) return "diamond";
  if (geometry === 31) return "parallelogram";
  if (geometry === 32) return "trapezoid";
  if (geometry === 35 || geometry === 89 || isTransparentOutlineEllipse(shape, rect)) return "ellipse";
  if (geometry === 39) return "hexagon";
  if (geometry === 111) return "bracePair";
  if (geometry === 112) return "bracketPair";
  return "rect";
}

export function presentationImageSourceRect(
  element: RecordValue,
  naturalSize: PresentationSize,
): PresentationImageSourceRect {
  const sourceRect = elementImageSourceRect(element);
  if (!sourceRect || naturalSize.width <= 0 || naturalSize.height <= 0) {
    return { height: naturalSize.height, width: naturalSize.width, x: 0, y: 0 };
  }

  const left = cropRatio(sourceRect.left ?? sourceRect.l);
  const top = cropRatio(sourceRect.top ?? sourceRect.t);
  const right = cropRatio(sourceRect.right ?? sourceRect.r);
  const bottom = cropRatio(sourceRect.bottom ?? sourceRect.b);
  const x = naturalSize.width * left;
  const y = naturalSize.height * top;
  const width = naturalSize.width * Math.max(0.01, 1 - left - right);
  const height = naturalSize.height * Math.max(0.01, 1 - top - bottom);
  return { height, width, x, y };
}

export function collectPresentationTypefaces(slides: RecordValue[]): string[] {
  const typefaces = new Set<string>();
  for (const slide of slides) {
    for (const element of presentationElements(slide)) {
      for (const paragraph of asArray(element.paragraphs)) {
        const paragraphRecord = asRecord(paragraph);
        const paragraphStyle = asRecord(paragraphRecord?.textStyle);
        const paragraphTypeface = asString(paragraphStyle?.typeface);
        if (paragraphTypeface) typefaces.add(paragraphTypeface);

        for (const run of asArray(paragraphRecord?.runs)) {
          const runStyle = asRecord(asRecord(run)?.textStyle);
          const runTypeface = asString(runStyle?.typeface);
          if (runTypeface) typefaces.add(runTypeface);
        }
      }
    }
  }
  return Array.from(typefaces);
}

export function renderPresentationSlide({
  context,
  height,
  images,
  slide,
  textOverflow = "visible",
  width,
}: {
  context: CanvasRenderingContext2D;
  height: number;
  images: PresentationRenderImages;
  slide: RecordValue;
  textOverflow?: PresentationTextOverflow;
  width: number;
}): void {
  const bounds = getSlideBounds(slide);
  const elements = presentationElements(slide)
    .map((element, index) => ({ element, index }))
    .sort((left, right) => asNumber(left.element.zIndex, left.index) - asNumber(right.element.zIndex, right.index));

  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = slideBackgroundToCss(slide);
  context.fillRect(0, 0, width, height);

  for (const entry of elements) {
    drawElement(context, entry, bounds, { height, width }, images, { textOverflow });
  }

  context.restore();
}

export function getPresentationElementTargets(slide: RecordValue, canvas: PresentationSize): PresentationElementTarget[] {
  const bounds = getSlideBounds(slide);
  return presentationElements(slide)
    .map((element, index) => {
      const rect = emuRectToCanvasRect(asRecord(element.bbox), bounds, canvas);
      return {
        element,
        id: asString(element.id) || `element-${index}`,
        index,
        name: asString(element.name) || asString(element.id) || String(index + 1),
        rect,
      };
    })
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => asNumber(left.element.zIndex, left.index) - asNumber(right.element.zIndex, right.index));
}

function presentationElements(slide: RecordValue): RecordValue[] {
  const elements: RecordValue[] = [];

  function visit(value: unknown): void {
    const record = asRecord(value);
    if (record == null) return;
    elements.push(record);
    for (const child of asArray(record.children)) {
      visit(child);
    }
  }

  for (const element of asArray(slide.elements)) {
    visit(element);
  }

  return elements;
}

function drawElement(
  context: CanvasRenderingContext2D,
  { element }: SlideElementEntry,
  bounds: PresentationSize,
  canvas: PresentationSize,
  images: PresentationRenderImages,
  options: { textOverflow: PresentationTextOverflow },
): void {
  const bbox = asRecord(element.bbox);
  const rect = emuRectToCanvasRect(bbox, bounds, canvas);
  if (rect.width <= 0 && rect.height <= 0) return;

  const slideScale = presentationCanvasScale(bounds, canvas);
  const shape = asRecord(element.shape);
  const line = presentationLineStyle(shape?.line ?? element.line, slideScale);
  const isLine = rect.height === 0 && line.color != null;
  const rotation = asNumber(bbox?.rotation) / 60_000;

  context.save();
  context.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (rotation !== 0) context.rotate((rotation * Math.PI) / 180);
  context.translate(-rect.width / 2, -rect.height / 2);
  applyElementShadow(context, element, slideScale);

  const shapeKind = presentationShapeKind(shape, rect);
  if (isLine || shapeKind === "line") {
    drawLine(context, rect.width, rect.height, line);
    context.restore();
    return;
  }

  const path = elementPath(shapeKind, rect);
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

function elementPath(kind: PresentationShapeKind, rect: PresentationRect): Path2D {
  const path = new Path2D();
  if (kind === "ellipse") {
    path.ellipse(rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
    return path;
  }

  if (kind === "roundRect") {
    const radius = Math.min(rect.width, rect.height) * 0.08;
    roundedRect(path, 0, 0, rect.width, rect.height, radius);
    return path;
  }

  if (kind === "triangle") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "diamond") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height / 2],
      [rect.width / 2, rect.height],
      [0, rect.height / 2],
    ]);
    return path;
  }

  if (kind === "parallelogram") {
    const skew = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [skew, 0],
      [rect.width, 0],
      [rect.width - skew, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "trapezoid") {
    const inset = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height],
      [0, rect.height],
    ]);
    return path;
  }

  if (kind === "hexagon") {
    const inset = Math.min(rect.width / 3, rect.width * 0.24);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height / 2],
      [rect.width - inset, rect.height],
      [inset, rect.height],
      [0, rect.height / 2],
    ]);
    return path;
  }

  if (kind === "bracePair" || kind === "bracketPair") {
    drawBracketLikePath(path, rect, kind);
    return path;
  }

  path.rect(0, 0, rect.width, rect.height);
  return path;
}

function polygon(path: Path2D, points: Array<[number, number]>): void {
  const [first, ...rest] = points;
  if (!first) return;
  path.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    path.lineTo(x, y);
  }
  path.closePath();
}

function drawBracketLikePath(path: Path2D, rect: PresentationRect, kind: "bracePair" | "bracketPair"): void {
  const strokeWidth = Math.max(1, Math.min(rect.width, rect.height) * 0.08);
  const inset = Math.min(rect.width * 0.2, strokeWidth * 2);
  if (kind === "bracketPair") {
    roundedRect(path, 0, 0, inset, rect.height, strokeWidth);
    roundedRect(path, rect.width - inset, 0, inset, rect.height, strokeWidth);
    return;
  }

  path.moveTo(inset, 0);
  path.quadraticCurveTo(0, rect.height * 0.25, inset, rect.height * 0.5);
  path.quadraticCurveTo(0, rect.height * 0.75, inset, rect.height);
  path.lineTo(inset + strokeWidth, rect.height);
  path.quadraticCurveTo(strokeWidth, rect.height * 0.75, inset + strokeWidth, rect.height * 0.5);
  path.quadraticCurveTo(strokeWidth, rect.height * 0.25, inset + strokeWidth, 0);
  path.closePath();
  path.moveTo(rect.width - inset, 0);
  path.quadraticCurveTo(rect.width, rect.height * 0.25, rect.width - inset, rect.height * 0.5);
  path.quadraticCurveTo(rect.width, rect.height * 0.75, rect.width - inset, rect.height);
  path.lineTo(rect.width - inset - strokeWidth, rect.height);
  path.quadraticCurveTo(rect.width - strokeWidth, rect.height * 0.75, rect.width - inset - strokeWidth, rect.height * 0.5);
  path.quadraticCurveTo(rect.width - strokeWidth, rect.height * 0.25, rect.width - inset - strokeWidth, 0);
  path.closePath();
}

function roundedRect(path: Path2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

function drawElementImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  element: RecordValue,
  rect: PresentationRect,
): void {
  const naturalSize = imageNaturalSize(image);
  const source = presentationImageSourceRect(element, naturalSize);
  if (source.width <= 0 || source.height <= 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return;
  }

  context.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, rect.width, rect.height);
}

function imageNaturalSize(image: CanvasImageSource): PresentationSize {
  const record = image as unknown as Record<string, unknown>;
  return {
    height: asNumber(record.naturalHeight, asNumber(record.videoHeight, asNumber(record.height))),
    width: asNumber(record.naturalWidth, asNumber(record.videoWidth, asNumber(record.width))),
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

function presentationCanvasScale(bounds: PresentationSize, canvas: PresentationSize): number {
  const frameWidth = bounds.width / EMU_PER_CSS_PIXEL;
  const frameHeight = bounds.height / EMU_PER_CSS_PIXEL;
  if (frameWidth <= 0 || frameHeight <= 0) return 1;
  return Math.min(canvas.width / frameWidth, canvas.height / frameHeight);
}

export function presentationLineStyle(line: unknown, slideScale: number): PresentationLineStyle {
  const lineRecord = asRecord(line);
  const fillRecord = asRecord(lineRecord?.fill);
  const rawWidthEmu = asNumber(lineRecord?.widthEmu);
  const width = rawWidthEmu > 0 ? rawWidthEmu / EMU_PER_CSS_PIXEL : 1;
  const scaledWidth = Math.max(0.5, width * Math.max(0.01, slideScale));
  return {
    color: colorToCss(fillRecord?.color),
    dash: presentationLineDash(asNumber(lineRecord?.style), scaledWidth),
    headEnd: presentationLineEndStyle(lineRecord?.headEnd, scaledWidth),
    lineCap: presentationLineCap(asNumber(lineRecord?.cap)),
    lineJoin: presentationLineJoin(asNumber(lineRecord?.join)),
    tailEnd: presentationLineEndStyle(lineRecord?.tailEnd, scaledWidth),
    width: scaledWidth,
  };
}

function applyLineStyle(context: CanvasRenderingContext2D, line: PresentationLineStyle): void {
  context.strokeStyle = line.color ?? "#0f172a";
  context.lineWidth = line.width;
  context.lineCap = line.lineCap;
  context.lineJoin = line.lineJoin;
  context.setLineDash(line.dash);
}

function presentationLineCap(cap: number): CanvasLineCap {
  if (cap === 2) return "square";
  if (cap === 3) return "round";
  return "butt";
}

function presentationLineJoin(join: number): CanvasLineJoin {
  if (join === 1) return "round";
  if (join === 2) return "bevel";
  return "miter";
}

function presentationLineDash(style: number, width: number): number[] {
  const unit = Math.max(1, width);
  if (style === 2) return [unit * 4, unit * 2];
  if (style === 3) return [unit, unit * 2];
  if (style === 4) return [unit * 8, unit * 3];
  if (style === 5) return [unit * 8, unit * 3, unit, unit * 3];
  if (style === 6) return [unit * 8, unit * 3, unit, unit * 3, unit, unit * 3];
  return [];
}

export function presentationLineEndStyle(end: unknown, lineWidth: number): PresentationLineEndStyle | null {
  const record = asRecord(end);
  const type = asNumber(record?.type);
  if (!record || type <= 0) return null;

  return {
    length: lineEndScale(asNumber(record.length, 2), lineWidth),
    type,
    width: lineEndScale(asNumber(record.width, 2), lineWidth),
  };
}

function lineEndScale(value: number, lineWidth: number): number {
  const multiplier = value <= 1 ? 2.5 : value === 2 ? 3.5 : value === 3 ? 5 : Math.min(value, 6);
  return Math.max(5, lineWidth * multiplier);
}

function drawLineEnd(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  end: PresentationLineEndStyle | null,
  color: string,
  atTail: boolean,
): void {
  if (!end) return;

  const from = atTail ? { x: width, y: height } : { x: 0, y: 0 };
  const to = atTail ? { x: 0, y: 0 } : { x: width, y: height };
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const x = atTail ? 0 : width;
  const y = atTail ? 0 : height;

  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = color;
  context.beginPath();
  if (end.type === 5) {
    context.ellipse(-end.length / 2, 0, end.width / 2, end.width / 2, 0, 0, Math.PI * 2);
  } else {
    context.moveTo(0, 0);
    context.lineTo(-end.length, -end.width / 2);
    context.lineTo(-end.length, end.width / 2);
    context.closePath();
  }
  context.fill();
  context.restore();
}

export function presentationShadowStyle(element: RecordValue, slideScale: number): PresentationShadowStyle | null {
  for (const effect of asArray(element.effects)) {
    const shadow = asRecord(asRecord(effect)?.shadow);
    const color = colorToCss(shadow?.color);
    if (!shadow || !color || colorAlphaFromCss(color) <= 0) {
      continue;
    }

    const distance = (asNumber(shadow.distance) / EMU_PER_CSS_PIXEL) * Math.max(0.01, slideScale);
    const direction = (asNumber(shadow.direction) / 60_000 / 180) * Math.PI;
    return {
      blur: Math.max(0, (asNumber(shadow.blurRadius) / EMU_PER_CSS_PIXEL) * Math.max(0.01, slideScale)),
      color,
      offsetX: Math.cos(direction) * distance,
      offsetY: Math.sin(direction) * distance,
    };
  }

  return null;
}

function applyElementShadow(context: CanvasRenderingContext2D, element: RecordValue, slideScale: number): void {
  const shadow = presentationShadowStyle(element, slideScale);
  if (!shadow) return;
  context.shadowBlur = shadow.blur;
  context.shadowColor = shadow.color;
  context.shadowOffsetX = shadow.offsetX;
  context.shadowOffsetY = shadow.offsetY;
}

function shapeFillToCss(
  shape: RecordValue | null,
  element: RecordValue,
  lineColor: string | undefined,
  rect: PresentationRect,
): string | undefined {
  const fill = fillToCss(shape?.fill) ?? fillToCss(element.fill);
  if (!fill) return undefined;

  const isLikelyOutlineOnly = Math.abs(rect.width - rect.height) <= Math.max(2, Math.min(rect.width, rect.height) * 0.03);
  if (isLikelyOutlineOnly && lineColor && sameBaseColor(fill, lineColor) && colorAlphaFromCss(lineColor) < 0.5) {
    return undefined;
  }

  return fill;
}

function shapeFillToPaint(
  context: CanvasRenderingContext2D,
  shape: RecordValue | null,
  element: RecordValue,
  lineColor: string | undefined,
  rect: PresentationRect,
): string | CanvasGradient | undefined {
  const fill = asRecord(shape?.fill) ?? asRecord(element.fill);
  const gradient = presentationGradientFill(context, fill, rect);
  if (gradient) return gradient;
  return shapeFillToCss(shape, element, lineColor, rect);
}

export function presentationGradientStops(fill: unknown): Array<{ color: string; position: number }> {
  const stops = asArray(asRecord(fill)?.gradientStops)
    .map((stop, index) => {
      const record = asRecord(stop);
      const color = colorToCss(record?.color ?? stop);
      if (!color) return null;
      return {
        color,
        index,
        position: gradientStopPosition(record),
      };
    })
    .filter((stop): stop is { color: string; index: number; position: number | null } => stop != null);

  return stops.map((stop) => ({
    color: stop.color,
    position: stop.position ?? (stops.length === 1 ? 0 : stop.index / (stops.length - 1)),
  }));
}

function presentationGradientFill(
  context: CanvasRenderingContext2D,
  fill: RecordValue | null,
  rect: PresentationRect,
): CanvasGradient | undefined {
  const stops = presentationGradientStops(fill);
  if (stops.length < 2) return undefined;

  const line = gradientLine(rect, gradientAngle(fill));
  const gradient = context.createLinearGradient(line.x1, line.y1, line.x2, line.y2);
  for (const stop of stops) {
    gradient.addColorStop(clamp(stop.position, 0, 1), stop.color);
  }
  return gradient;
}

function gradientStopPosition(stop: RecordValue | null): number | null {
  for (const key of ["position", "offset", "pos"]) {
    const value = asNumber(stop?.[key], Number.NaN);
    if (Number.isFinite(value)) {
      return value > 1 ? clamp(value / 100_000, 0, 1) : clamp(value, 0, 1);
    }
  }

  return null;
}

function gradientAngle(fill: RecordValue | null): number {
  for (const key of ["angle", "gradientAngle", "direction"]) {
    const value = asNumber(fill?.[key], Number.NaN);
    if (Number.isFinite(value)) {
      return Math.abs(value) > 360 ? value / 60_000 : value;
    }
  }

  return 0;
}

function gradientLine(rect: PresentationRect, angleDegrees: number): { x1: number; x2: number; y1: number; y2: number } {
  const radians = (angleDegrees * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy);
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  return {
    x1: cx - (dx * length) / 2,
    x2: cx + (dx * length) / 2,
    y1: cy - (dy * length) / 2,
    y2: cy + (dy * length) / 2,
  };
}

function isTransparentOutlineEllipse(shape: RecordValue | null, rect: PresentationRect): boolean {
  const fill = fillToCss(shape?.fill);
  const line = lineToCss(shape?.line);
  if (!fill || !line.color) return false;
  const isNearSquare = Math.abs(rect.width - rect.height) <= Math.max(2, Math.min(rect.width, rect.height) * 0.03);
  return isNearSquare && colorAlphaFromCss(fill) === 0 && sameBaseColor(fill, line.color);
}

function sameBaseColor(left: string, right: string): boolean {
  return cssRgbKey(left) === cssRgbKey(right);
}

function cssRgbKey(value: string): string {
  const hex = value.match(/^#?([0-9a-f]{6})$/i);
  if (hex) return hex[1].toLowerCase();
  const rgba = parseCssColorChannels(value);
  if (!rgba) return value.toLowerCase();
  return rgba
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("");
}

function colorAlphaFromCss(value: string): number {
  const channels = parseCssColorChannels(value);
  if (!channels || channels[3] == null) return 1;
  const alpha = Number(channels[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}

function parseCssColorChannels(value: string): string[] | null {
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open < 0 || close <= open) return null;
  const functionName = value.slice(0, open).trim().toLowerCase();
  if (functionName !== "rgb" && functionName !== "rgba") return null;
  const channels = value
    .slice(open + 1, close)
    .split(",")
    .map((channel) => channel.trim());
  return channels.length >= 3 ? channels : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
