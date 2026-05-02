import {
  asArray,
  asNumber,
  asRecord,
  asString,
  colorToCss,
  cssFontSize,
  elementImageReferenceId,
  EMPTY_DOCUMENT_STYLE_MAPS,
  fillToCss,
  lineToCss,
  officeFontFamily,
  paragraphView,
  slideBackgroundToCss,
  type ParagraphView,
  type RecordValue,
  type TextRunView,
} from "./office-preview-utils";

const DEFAULT_SLIDE_BOUNDS = { width: 12_192_000, height: 6_858_000 };
const EMU_PER_CSS_PIXEL = 9_525;
const FIT_PADDING = 48;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

export type PresentationSize = {
  height: number;
  width: number;
};

export type PresentationRect = PresentationSize & {
  left: number;
  top: number;
};

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

export type PresentationRenderImages = ReadonlyMap<string, CanvasImageSource>;
export type PresentationTextOverflow = "clip" | "visible";

type SlideElementEntry = {
  element: RecordValue;
  index: number;
};

type DrawSegment = {
  fontSize: number;
  run: TextRunView;
  text: string;
  width: number;
  x: number;
  y: number;
};

type TextInsets = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type TextLayout = {
  height: number;
  segments: DrawSegment[];
};

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

  const line = lineToCss(asRecord(element.shape)?.line);
  const isLine = rect.height === 0 && line.color != null;
  const rotation = asNumber(bbox?.rotation) / 60_000;

  context.save();
  context.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (rotation !== 0) context.rotate((rotation * Math.PI) / 180);
  context.translate(-rect.width / 2, -rect.height / 2);

  if (isLine) {
    drawLine(context, rect.width, line);
    context.restore();
    return;
  }

  const shape = asRecord(element.shape);
  const path = elementPath(context, shape, rect);
  const fill = shapeFillToCss(shape, element, line.color, rect);
  if (fill) {
    context.fillStyle = fill;
    context.fill(path);
  }

  const imageId = elementImageReferenceId(element);
  const image = imageId ? images.get(imageId) : undefined;
  if (image) {
    context.save();
    context.clip(path);
    context.drawImage(image, 0, 0, rect.width, rect.height);
    context.restore();
  }

  if (line.color) {
    context.strokeStyle = line.color;
    context.lineWidth = line.width;
    context.stroke(path);
  }

  drawTextBox(context, element, rect, bounds, canvas, options);
  context.restore();
}

function drawLine(context: CanvasRenderingContext2D, width: number, line: { color?: string; width: number }): void {
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, 0);
  context.strokeStyle = line.color ?? "#0f172a";
  context.lineWidth = line.width;
  context.stroke();
}

function elementPath(context: CanvasRenderingContext2D, shape: RecordValue | null, rect: PresentationRect): Path2D {
  const path = new Path2D();
  const geometry = asNumber(shape?.geometry);
  if (geometry === 35 || geometry === 89 || isTransparentOutlineEllipse(shape, rect)) {
    path.ellipse(rect.width / 2, rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
    return path;
  }

  if (geometry === 26) {
    const radius = Math.min(rect.width, rect.height) * 0.08;
    roundedRect(path, 0, 0, rect.width, rect.height, radius);
    return path;
  }

  path.rect(0, 0, rect.width, rect.height);
  return path;
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

function drawTextBox(
  context: CanvasRenderingContext2D,
  element: RecordValue,
  rect: PresentationRect,
  bounds: PresentationSize,
  canvas: PresentationSize,
  options: { textOverflow: PresentationTextOverflow },
): void {
  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, EMPTY_DOCUMENT_STYLE_MAPS));
  if (paragraphs.length === 0) return;

  const textStyle = asRecord(element.textStyle);
  const insets = textInsets(textStyle, rect, canvas.width / bounds.width, canvas.height / bounds.height);
  const maxWidth = Math.max(1, rect.width - insets.left - insets.right);
  const maxHeight = Math.max(1, rect.height - insets.top - insets.bottom);
  const layout = layoutText(context, paragraphs, maxWidth);
  const verticalOffset = verticalTextOffset(asNumber(textStyle?.anchor), layout.height, maxHeight);

  context.save();
  if (options.textOverflow === "clip") {
    context.beginPath();
    context.rect(0, 0, rect.width, rect.height);
    context.clip();
  }
  context.textBaseline = "top";

  for (const segment of layout.segments) {
    applyRunFont(context, segment.run, segment.fontSize);
    context.fillStyle = colorToCss(asRecord(segment.run.style?.fill)?.color) ?? "#0f172a";
    const segmentX = insets.left + segment.x;
    const segmentY = insets.top + verticalOffset + segment.y;
    context.fillText(segment.text, segmentX, segmentY);
    if (segment.run.style?.underline === true) {
      const underlineY = segmentY + segment.fontSize * 1.08;
      context.beginPath();
      context.moveTo(segmentX, underlineY);
      context.lineTo(segmentX + segment.width, underlineY);
      context.lineWidth = Math.max(1, segment.fontSize / 18);
      context.strokeStyle = context.fillStyle;
      context.stroke();
    }
  }

  context.restore();
}

function layoutText(
  context: CanvasRenderingContext2D,
  paragraphs: ParagraphView[],
  maxWidth: number,
): TextLayout {
  const segments: DrawSegment[] = [];
  let y = 0;
  let line: DrawSegment[] = [];
  let lineAlignment = 1;
  let lineHeight = 16;
  let lineSpacing = 1;
  let lineWidth = 0;
  let activeAlignment = 1;
  let activeLineSpacing = 1;

  function resetLine(): void {
    line = [];
    lineAlignment = activeAlignment;
    lineHeight = 16;
    lineSpacing = activeLineSpacing;
    lineWidth = 0;
  }

  function flushLine(includeEmptyLine = false): void {
    if (line.length === 0) {
      if (includeEmptyLine) {
        y += lineHeight * lineSpacing;
      }
      resetLine();
      return;
    }

    const offsetX = lineAlignmentOffset(lineAlignment, lineWidth, maxWidth);
    for (const segment of line) {
      segments.push({ ...segment, x: segment.x + offsetX, y });
    }
    y += lineHeight * lineSpacing;
    resetLine();
  }

  function setParagraphOptions(paragraph: ParagraphView): void {
    activeAlignment = paragraphAlignment(paragraph);
    activeLineSpacing = paragraphLineSpacing(paragraph);
    if (line.length === 0 && lineWidth === 0) {
      lineAlignment = activeAlignment;
      lineSpacing = activeLineSpacing;
    }
  }

  function pushTextSegment(run: TextRunView, text: string, width: number, fontSize: number): void {
    if (line.length === 0 && lineWidth === 0) {
      lineAlignment = activeAlignment;
      lineSpacing = activeLineSpacing;
    }

    const nextLineHeight = fontSize * 1.18;
    line.push({
      fontSize,
      run,
      text,
      width,
      x: lineWidth,
      y: 0,
    });
    lineWidth += width;
    lineHeight = Math.max(lineHeight, nextLineHeight);
  }

  for (const paragraph of paragraphs) {
    setParagraphOptions(paragraph);
    y += paragraphSpacingPx(paragraph.style?.spaceBefore);

    for (const run of paragraph.runs) {
      const fontSize = runFontSize(run);
      applyRunFont(context, run, fontSize);
      lineHeight = Math.max(lineHeight, fontSize * 1.18);

      const tokens = textTokens(run.text);
      for (const token of tokens) {
        if (token === "\n") {
          flushLine(true);
          continue;
        }

        const tokenWidth = context.measureText(token).width;
        if (lineWidth > 0 && lineWidth + tokenWidth > maxWidth) {
          flushLine();
        }

        if (tokenWidth <= maxWidth || token.trim() === "" || (lineWidth === 0 && Array.from(token).length <= 4)) {
          pushTextSegment(run, token, tokenWidth, fontSize);
          continue;
        }

        for (const char of wrapCharacters(token)) {
          const charWidth = context.measureText(char).width;
          if (lineWidth > 0 && lineWidth + charWidth > maxWidth) {
            flushLine();
          }
          pushTextSegment(run, char, charWidth, fontSize);
        }
      }
    }

    flushLine();
    y += paragraphSpacingPx(paragraph.style?.spaceAfter);
  }

  return { height: y, segments };
}

function textInsets(
  textStyle: RecordValue | null,
  rect: PresentationRect,
  scaleX: number,
  scaleY: number,
): TextInsets {
  const defaultX = Math.max(2, Math.min(12, rect.height * 0.04));
  const defaultY = Math.max(2, Math.min(12, rect.height * 0.035));
  return {
    bottom: insetPx(textStyle?.bottomInset, scaleY, defaultY, rect.height * 0.45),
    left: insetPx(textStyle?.leftInset, scaleX, defaultX, rect.width * 0.45),
    right: insetPx(textStyle?.rightInset, scaleX, defaultX, rect.width * 0.45),
    top: insetPx(textStyle?.topInset, scaleY, defaultY, rect.height * 0.45),
  };
}

function insetPx(value: unknown, scale: number, fallback: number, max: number): number {
  const raw = asNumber(value, Number.NaN);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return clamp(raw * scale, 0, max);
}

function verticalTextOffset(anchor: number, contentHeight: number, maxHeight: number): number {
  if (contentHeight >= maxHeight) return 0;
  if (anchor === 2 || anchor === 4 || anchor === 5) return (maxHeight - contentHeight) / 2;
  if (anchor === 3) return maxHeight - contentHeight;
  return 0;
}

function paragraphAlignment(paragraph: ParagraphView): number {
  const alignment = asNumber(paragraph.style?.alignment);
  return alignment > 0 ? alignment : 1;
}

function paragraphLineSpacing(paragraph: ParagraphView): number {
  const raw = asNumber(paragraph.style?.lineSpacing);
  if (raw > 10_000) return clamp(raw / 100_000, 0.6, 3);
  if (raw > 0) return clamp(raw, 0.6, 3);
  return 1;
}

function paragraphSpacingPx(value: unknown): number {
  const raw = asNumber(value);
  if (raw <= 0) return 0;
  return Math.min(24, raw / 20);
}

function lineAlignmentOffset(alignment: number, lineWidth: number, maxWidth: number): number {
  if (alignment === 2) return Math.max(0, (maxWidth - lineWidth) / 2);
  if (alignment === 3) return Math.max(0, maxWidth - lineWidth);
  return 0;
}

function textTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const part of text.split(/(\n|\s+)/u)) {
    if (!part) continue;
    if (part === "\n") {
      tokens.push(part);
      continue;
    }
    if (/^\s+$/u.test(part)) {
      tokens.push(part);
      continue;
    }
    tokens.push(part);
  }
  return tokens;
}

function wrapCharacters(text: string): string[] {
  const chunks: string[] = [];
  for (const char of Array.from(text)) {
    if (isClosingPunctuation(char) && chunks.length > 0) {
      chunks[chunks.length - 1] += char;
      continue;
    }
    chunks.push(char);
  }
  return chunks;
}

function isClosingPunctuation(char: string): boolean {
  return /^[,.;:!?，。！？；：、）】》」』”’)]$/u.test(char);
}

function applyRunFont(context: CanvasRenderingContext2D, run: TextRunView, fontSize: number): void {
  const fontStyle = run.style?.italic === true ? "italic" : "normal";
  const fontWeight = run.style?.bold === true ? "700" : "400";
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${officeFontFamily(asString(run.style?.typeface))}`;
}

function runFontSize(run: TextRunView): number {
  return Math.max(2, cssFontSize(run.style?.fontSize, 14) * 1.333);
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
