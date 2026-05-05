import { createHash } from "node:crypto";
import type sharp from "sharp";

import { ProtoReader } from "./proto-reader.js";

type RecordValue = Record<string, unknown>;

type DirectCanvasElement =
  | {
      crop: DirectImageCrop | null;
      kind: "image";
      mediaId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      color: string;
      fontSize: number;
      italic: boolean;
      insetBottom: number;
      insetLeft: number;
      insetRight: number;
      insetTop: number;
      kind: "text";
      lineHeight: number;
      text: string;
      textAlign: "center" | "left" | "right";
      typeface: string;
      underline: boolean;
      verticalAlign: "bottom" | "middle" | "top";
      weight: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      fill: string;
      kind: "shape";
      radius: number;
      shapeKind: DirectShapeKind;
      stroke: string;
      strokeWidth: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

type DirectCanvasMedia = {
  height: number;
  src: string;
  width: number;
};

type DirectCanvasPayload = {
  artifact: {
    generatedBy: string;
    mode: "proto-direct";
    reader: string;
    source: string;
    title: string;
  };
  media: Record<string, DirectCanvasMedia>;
  slides: DirectCanvasSlide[];
};

type DirectCanvasSlide = {
  background: string;
  elements: DirectCanvasElement[];
  height: number;
  index: number;
  thumbnail: string | null;
  title: string;
  width: number;
};

type DirectImageCrop = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type DirectShapeKind =
  | "diamond"
  | "ellipse"
  | "line"
  | "rect"
  | "roundRect"
  | "triangle";

type Presentation = {
  images: PresentationImage[];
  layouts: PresentationLayout[];
  slides: PresentationSlide[];
};

type PresentationColor = {
  alpha?: number;
  type?: number;
  value?: string;
};

type PresentationElement = {
  bbox?: PresentationRect;
  fill?: PresentationFill;
  imageReference?: { id?: string };
  name?: string;
  paragraphs: PresentationParagraph[];
  placeholderType?: string;
  shape?: {
    fill?: PresentationFill;
    geometry?: number;
    line?: PresentationLine;
  };
  textStyle?: PresentationTextStyle;
  type?: number;
  zIndex?: number;
};

type PresentationFill = {
  color?: PresentationColor;
  imageReference?: { id?: string };
  srcRect?: PresentationCropPercent;
  stretchFillRect?: PresentationCropPercent;
  type?: number;
};

type PresentationImage = {
  contentType: string;
  data: Uint8Array;
  id: string;
};

type PresentationLayout = {
  elements: PresentationElement[];
  id: string;
  masterId?: string;
  name?: string;
  background?: PresentationBackground;
};

type PresentationLine = {
  fill?: PresentationFill;
  style?: number;
  widthEmu?: number;
};

type PresentationParagraph = {
  runs: PresentationRun[];
  textStyle?: {
    alignment?: number;
  };
};

type PresentationRect = {
  heightEmu: number;
  widthEmu: number;
  xEmu: number;
  yEmu: number;
};

type PresentationRun = {
  text: string;
  textStyle?: PresentationRunStyle;
};

type PresentationRunStyle = {
  bold?: boolean;
  fill?: PresentationFill;
  fontSize?: number;
  italic?: boolean;
  typeface?: string;
  underline?: string;
};

type PresentationSlide = {
  background?: PresentationBackground;
  elements: PresentationElement[];
  heightEmu: number;
  index: number;
  useLayoutId?: string;
  widthEmu: number;
};

type PresentationBackground = {
  fill?: PresentationFill;
};

type PresentationTextStyle = {
  anchor?: number;
  bottomInset?: number;
  leftInset?: number;
  rightInset?: number;
  topInset?: number;
};

type PresentationCropPercent = {
  b?: number;
  l?: number;
  r?: number;
  t?: number;
};

export type RenderPptxCursorCanvasOptions = {
  mediaQuality?: number;
  mediaWidth?: number;
  readerVersion: string;
  sourcePath: string;
  title: string;
};

type SharpFactory = typeof sharp;

export async function renderPptxCursorCanvasSource(
  protoBytes: Uint8Array,
  options: RenderPptxCursorCanvasOptions,
): Promise<string> {
  const presentation = decodePresentation(protoBytes);
  const payload = await buildPresentationPayload(presentation, options);
  return renderPresentationCanvasSource(payload);
}

function decodePresentation(bytes: Uint8Array): Presentation {
  const reader = new ProtoReader(bytes);
  const presentation: Presentation = {
    images: [],
    layouts: [],
    slides: [],
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      presentation.slides.push(decodeSlide(reader.bytesField()));
    } else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      presentation.layouts.push(decodeLayout(reader.bytesField()));
    } else if (tag.fieldNumber === 4 && tag.wireType === 2) {
      presentation.images.push(decodeImage(reader.bytesField()));
    } else {
      reader.skip(tag.wireType);
    }
  }
  return presentation;
}

function decodeSlide(bytes: Uint8Array): PresentationSlide {
  const reader = new ProtoReader(bytes);
  const slide: PresentationSlide = {
    elements: [],
    heightEmu: 6_858_000,
    index: 1,
    widthEmu: 12_192_000,
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) slide.index = reader.int32();
    else if (tag.fieldNumber === 2) slide.useLayoutId = reader.string();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      slide.elements.push(decodeElement(reader.bytesField()));
    } else if (tag.fieldNumber === 5) slide.widthEmu = reader.int64();
    else if (tag.fieldNumber === 6) slide.heightEmu = reader.int64();
    else if (tag.fieldNumber === 10 && tag.wireType === 2) {
      slide.background = decodeBackground(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return slide;
}

function decodeLayout(bytes: Uint8Array): PresentationLayout {
  const reader = new ProtoReader(bytes);
  const layout: PresentationLayout = {
    elements: [],
    id: "",
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) layout.id = reader.string();
    else if (tag.fieldNumber === 8) layout.name = reader.string();
    else if (tag.fieldNumber === 10 && tag.wireType === 2) {
      layout.background = decodeBackground(reader.bytesField());
    } else if (tag.fieldNumber === 11 && tag.wireType === 2) {
      layout.elements.push(decodeElement(reader.bytesField()));
    } else if (tag.fieldNumber === 15) layout.masterId = reader.string();
    else reader.skip(tag.wireType);
  }
  return layout;
}

function decodeElement(bytes: Uint8Array): PresentationElement {
  const reader = new ProtoReader(bytes);
  const element: PresentationElement = { paragraphs: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      element.bbox = decodeBoundingBox(reader.bytesField());
    } else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      element.imageReference = decodeImageReference(reader.bytesField());
    } else if (tag.fieldNumber === 4 && tag.wireType === 2) {
      element.shape = decodeShape(reader.bytesField());
    } else if (tag.fieldNumber === 6 && tag.wireType === 2) {
      element.paragraphs.push(decodeParagraph(reader.bytesField()));
    } else if (tag.fieldNumber === 10) element.name = reader.string();
    else if (tag.fieldNumber === 11) element.type = reader.int32();
    else if (tag.fieldNumber === 13) element.placeholderType = reader.string();
    else if (tag.fieldNumber === 14 && tag.wireType === 2) {
      element.textStyle = decodeTextStyle(reader.bytesField());
    } else if (tag.fieldNumber === 19 && tag.wireType === 2) {
      element.fill = decodeFill(reader.bytesField());
    } else if (tag.fieldNumber === 30 && tag.wireType === 2) {
      element.shape = {
        ...element.shape,
        line: decodeLine(reader.bytesField()),
      };
    } else reader.skip(tag.wireType);
  }
  return element;
}

function decodeBackground(bytes: Uint8Array): PresentationBackground {
  const reader = new ProtoReader(bytes);
  const background: PresentationBackground = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 3 && tag.wireType === 2) {
      background.fill = decodeFill(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return background;
}

function decodeBoundingBox(bytes: Uint8Array): PresentationRect {
  const reader = new ProtoReader(bytes);
  const rect: PresentationRect = {
    heightEmu: 0,
    widthEmu: 0,
    xEmu: 0,
    yEmu: 0,
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) rect.xEmu = reader.int64();
    else if (tag.fieldNumber === 2) rect.yEmu = reader.int64();
    else if (tag.fieldNumber === 3) rect.widthEmu = reader.int64();
    else if (tag.fieldNumber === 4) rect.heightEmu = reader.int64();
    else reader.skip(tag.wireType);
  }
  return rect;
}

function decodeColor(bytes: Uint8Array): PresentationColor {
  const reader = new ProtoReader(bytes);
  const color: PresentationColor = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) color.type = reader.int32();
    else if (tag.fieldNumber === 2) color.value = reader.string();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      color.alpha = decodeColorTransform(reader.bytesField()).alpha;
    } else reader.skip(tag.wireType);
  }
  return color;
}

function decodeColorTransform(bytes: Uint8Array): { alpha?: number } {
  const reader = new ProtoReader(bytes);
  const transform: { alpha?: number } = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 6) transform.alpha = reader.int32();
    else reader.skip(tag.wireType);
  }
  return transform;
}

function decodeFill(bytes: Uint8Array): PresentationFill {
  const reader = new ProtoReader(bytes);
  const fill: PresentationFill = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) fill.type = reader.int32();
    else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      fill.color = decodeColor(reader.bytesField());
    } else if (tag.fieldNumber === 11 && tag.wireType === 2) {
      fill.imageReference = decodeImageReference(reader.bytesField());
    } else if (tag.fieldNumber === 14 && tag.wireType === 2) {
      fill.srcRect = decodeCropPercent(reader.bytesField());
    } else if (tag.fieldNumber === 15 && tag.wireType === 2) {
      reader.bytesField();
      fill.stretchFillRect = {};
    } else reader.skip(tag.wireType);
  }
  return fill;
}

function decodeCropPercent(bytes: Uint8Array): PresentationCropPercent {
  const reader = new ProtoReader(bytes);
  const crop: PresentationCropPercent = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) crop.l = reader.int32();
    else if (tag.fieldNumber === 2) crop.t = reader.int32();
    else if (tag.fieldNumber === 3) crop.r = reader.int32();
    else if (tag.fieldNumber === 4) crop.b = reader.int32();
    else reader.skip(tag.wireType);
  }
  return crop;
}

function decodeImage(bytes: Uint8Array): PresentationImage {
  const reader = new ProtoReader(bytes);
  const image: PresentationImage = {
    contentType: "application/octet-stream",
    data: new Uint8Array(),
    id: "",
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) image.contentType = reader.string();
    else if (tag.fieldNumber === 2) image.data = reader.bytesField();
    else if (tag.fieldNumber === 3) image.id = reader.string();
    else reader.skip(tag.wireType);
  }
  return image;
}

function decodeImageReference(bytes: Uint8Array): { id?: string } {
  const reader = new ProtoReader(bytes);
  const reference: { id?: string } = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) reference.id = reader.string();
    else reader.skip(tag.wireType);
  }
  return reference;
}

function decodeLine(bytes: Uint8Array): PresentationLine {
  const reader = new ProtoReader(bytes);
  const line: PresentationLine = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) line.style = reader.int32();
    else if (tag.fieldNumber === 2) line.widthEmu = reader.int32();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      line.fill = decodeFill(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return line;
}

function decodeParagraph(bytes: Uint8Array): PresentationParagraph {
  const reader = new ProtoReader(bytes);
  const paragraph: PresentationParagraph = { runs: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      paragraph.runs.push(decodeRun(reader.bytesField()));
    } else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      paragraph.textStyle = decodeParagraphTextStyle(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return paragraph;
}

function decodeParagraphTextStyle(bytes: Uint8Array): { alignment?: number } {
  const reader = new ProtoReader(bytes);
  const style: { alignment?: number } = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 8) style.alignment = reader.int32();
    else reader.skip(tag.wireType);
  }
  return style;
}

function decodeRun(bytes: Uint8Array): PresentationRun {
  const reader = new ProtoReader(bytes);
  const run: PresentationRun = { text: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) run.text = reader.string();
    else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      run.textStyle = decodeRunStyle(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return run;
}

function decodeRunStyle(bytes: Uint8Array): PresentationRunStyle {
  const reader = new ProtoReader(bytes);
  const style: PresentationRunStyle = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 4) style.bold = reader.bool();
    else if (tag.fieldNumber === 5) style.italic = reader.bool();
    else if (tag.fieldNumber === 6) style.fontSize = reader.int32();
    else if (tag.fieldNumber === 7 && tag.wireType === 2) {
      style.fill = decodeFill(reader.bytesField());
    } else if (tag.fieldNumber === 9) style.underline = reader.string();
    else if (tag.fieldNumber === 18) style.typeface = reader.string();
    else reader.skip(tag.wireType);
  }
  return style;
}

function decodeShape(bytes: Uint8Array): NonNullable<PresentationElement["shape"]> {
  const reader = new ProtoReader(bytes);
  const shape: NonNullable<PresentationElement["shape"]> = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) shape.geometry = reader.int32();
    else if (tag.fieldNumber === 5 && tag.wireType === 2) {
      shape.fill = decodeFill(reader.bytesField());
    } else if (tag.fieldNumber === 6 && tag.wireType === 2) {
      shape.line = decodeLine(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return shape;
}

function decodeTextStyle(bytes: Uint8Array): PresentationTextStyle {
  const reader = new ProtoReader(bytes);
  const style: PresentationTextStyle = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) style.anchor = reader.int32();
    else if (tag.fieldNumber === 10) style.bottomInset = reader.int32();
    else if (tag.fieldNumber === 11) style.leftInset = reader.int32();
    else if (tag.fieldNumber === 12) style.rightInset = reader.int32();
    else if (tag.fieldNumber === 13) style.topInset = reader.int32();
    else reader.skip(tag.wireType);
  }
  return style;
}

async function buildPresentationPayload(
  presentation: Presentation,
  options: RenderPptxCursorCanvasOptions,
): Promise<DirectCanvasPayload> {
  const sharp = await loadSharp();
  const mediaIndex = await buildMediaIndex(presentation.images, sharp, options);
  const slides = presentation.slides.map((slide, index) =>
    buildSlide(slide, index, presentation.layouts, mediaIndex),
  );
  return {
    artifact: {
      generatedBy: "@autodev/office",
      mode: "proto-direct",
      reader: options.readerVersion,
      source: options.sourcePath,
      title: options.title,
    },
    media: Object.fromEntries(mediaIndex.media),
    slides: await Promise.all(
      slides.map(async (slide) => ({
        ...slide,
        thumbnail: await renderSlideThumbnailDataUrl(slide, mediaIndex.media, sharp),
      })),
    ),
  };
}

type MediaIndex = {
  byImageId: Map<string, string>;
  media: Map<string, DirectCanvasMedia>;
};

async function buildMediaIndex(
  images: PresentationImage[],
  sharp: SharpFactory | null,
  options: RenderPptxCursorCanvasOptions,
): Promise<MediaIndex> {
  const byImageId = new Map<string, string>();
  const media = new Map<string, DirectCanvasMedia>();
  for (const image of images) {
    if (!image.id || image.data.length === 0) continue;
    const mediaId = sha256(image.data);
    const encoded = await encodeMediaImage(image, sharp, options);
    const size = imageSize(encoded.bytes);
    byImageId.set(image.id, mediaId);
    if (!media.has(mediaId)) {
      media.set(mediaId, {
        height: size.height,
        src: `data:${encoded.contentType};base64,${Buffer.from(encoded.bytes).toString("base64")}`,
        width: size.width,
      });
    }
  }
  return { byImageId, media };
}

async function encodeMediaImage(
  image: PresentationImage,
  sharp: SharpFactory | null,
  options: RenderPptxCursorCanvasOptions,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!sharp) {
    return { bytes: image.data, contentType: image.contentType };
  }
  const buffer = await sharp(image.data)
    .resize({
      fit: "inside",
      width: options.mediaWidth ?? 1280,
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ mozjpeg: true, quality: clampQuality(options.mediaQuality ?? 70) })
    .toBuffer();
  return { bytes: new Uint8Array(buffer), contentType: "image/jpeg" };
}

function buildSlide(
  slide: PresentationSlide,
  index: number,
  layouts: PresentationLayout[],
  mediaIndex: MediaIndex,
): DirectCanvasSlide {
  const layout = layouts.find((item) => item.id === slide.useLayoutId);
  const elements = slideElements(slide, layout)
    .flatMap((element) => directElements(element, mediaIndex))
    .filter((element): element is DirectCanvasElement => element != null);
  return {
    background: slideBackgroundToCss(slide, layout),
    elements,
    height: slide.heightEmu,
    index: slide.index || index + 1,
    thumbnail: null,
    title: firstText(elements) || `Slide ${index + 1}`,
    width: slide.widthEmu,
  };
}

function slideElements(
  slide: PresentationSlide,
  layout?: PresentationLayout,
): PresentationElement[] {
  const inherited = layout?.elements.filter((element) => {
    const placeholderType = (element.placeholderType ?? "").toLowerCase();
    return placeholderType !== "sldnum" && placeholderType !== "dt";
  }) ?? [];
  const own = slide.elements.filter((element) => {
    const placeholderType = (element.placeholderType ?? "").toLowerCase();
    return placeholderType !== "sldnum" && placeholderType !== "dt";
  });
  return [...inherited, ...own].sort(
    (left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0),
  );
}

function directElements(
  element: PresentationElement,
  mediaIndex: MediaIndex,
): DirectCanvasElement[] {
  const bbox = element.bbox;
  if (!bbox) return [];
  const rect = {
    height: bbox.heightEmu,
    width: bbox.widthEmu,
    x: bbox.xEmu,
    y: bbox.yEmu,
  };
  if (rect.width <= 0 && rect.height <= 0) return [];

  const imageId = element.imageReference?.id ?? element.fill?.imageReference?.id;
  const mediaId = imageId ? mediaIndex.byImageId.get(imageId) : null;
  const elements: DirectCanvasElement[] = [];
  if (mediaId) {
    const media = mediaIndex.media.get(mediaId);
    elements.push({
      crop: media ? imageSourceRect(element, media) : null,
      kind: "image",
      mediaId,
      ...rect,
    });
  }

  const shapeKind = normalizeShapeKind(element.shape?.geometry);
  const fill = fillToCss(element.shape?.fill ?? element.fill) ?? "transparent";
  const line = lineToCss(element.shape?.line);
  if (!mediaId && (fill !== "transparent" || line.color || shapeKind === "line")) {
    elements.push({
      fill,
      kind: "shape",
      radius: shapeKind === "roundRect" ? Math.min(rect.width, rect.height) * 0.12 : 0,
      shapeKind,
      stroke: line.color ?? "none",
      strokeWidth: line.color ? line.width : 0,
      ...rect,
    });
  }

  const rawText = textFromElement(element);
  if (rawText && rect.width > 0 && rect.height > 0) {
    const style = firstRunStyle(element);
    const fontSize = fontSizeFromStyle(style);
    const textStyle = element.textStyle ?? {};
    const insetLeft = textStyle.leftInset ?? 0;
    const insetRight = textStyle.rightInset ?? 0;
    elements.push({
      color: fillToCss(style.fill) ?? "#0f172a",
      fontSize,
      italic: style.italic === true,
      insetBottom: textStyle.bottomInset ?? 0,
      insetLeft,
      insetRight,
      insetTop: textStyle.topInset ?? 0,
      kind: "text",
      lineHeight: fontSize * 1.18,
      text: wrapTextForSvg(
        rawText,
        fontSize,
        Math.max(fontSize * 1.2, rect.width - insetLeft - insetRight),
      ),
      textAlign: paragraphTextAlign(element),
      typeface: style.typeface ?? "",
      underline: style.underline === "sng" || style.underline === "single",
      verticalAlign: verticalTextAlign(textStyle),
      weight: style.bold === true ? 700 : 500,
      ...rect,
    });
  }

  return elements;
}

function firstRunStyle(element: PresentationElement): PresentationRunStyle {
  for (const paragraph of element.paragraphs) {
    for (const run of paragraph.runs) {
      if (run.textStyle) return run.textStyle;
    }
  }
  return {};
}

function textFromElement(element: PresentationElement): string {
  return element.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join("").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function paragraphTextAlign(
  element: PresentationElement,
): "center" | "left" | "right" {
  const alignment = element.paragraphs[0]?.textStyle?.alignment ?? 0;
  if (alignment === 2) return "center";
  if (alignment === 3) return "right";
  return "left";
}

function verticalTextAlign(
  textStyle: PresentationTextStyle,
): "bottom" | "middle" | "top" {
  if (textStyle.anchor === 2) return "middle";
  if (textStyle.anchor === 3) return "bottom";
  return "top";
}

function fontSizeFromStyle(style: PresentationRunStyle): number {
  const pointSize = (style.fontSize ?? 1800) / 100;
  return Math.max(8, Math.min(96, pointSize)) * 12_700;
}

function fillToCss(fill?: PresentationFill): string | undefined {
  const color = fill?.color;
  if (!color?.value) return undefined;
  if (color.alpha === 0) return "transparent";
  if (color.type === 1 || /^[0-9a-f]{6}$/iu.test(color.value)) {
    return `#${color.value}`;
  }
  return undefined;
}

function lineToCss(line?: PresentationLine): { color?: string; width: number } {
  return {
    color: fillToCss(line?.fill),
    width: Math.max(1, line?.widthEmu ?? 9_525),
  };
}

function slideBackgroundToCss(
  slide: PresentationSlide,
  layout?: PresentationLayout,
): string {
  return fillToCss(slide.background?.fill) ?? fillToCss(layout?.background?.fill) ?? "#ffffff";
}

function imageSourceRect(
  element: PresentationElement,
  naturalSize: { height: number; width: number },
): DirectImageCrop {
  const srcRect = element.fill?.srcRect;
  if (!srcRect) {
    return { height: naturalSize.height, width: naturalSize.width, x: 0, y: 0 };
  }
  const left = (srcRect.l ?? 0) / 100_000;
  const top = (srcRect.t ?? 0) / 100_000;
  const right = (srcRect.r ?? 0) / 100_000;
  const bottom = (srcRect.b ?? 0) / 100_000;
  const x = naturalSize.width * left;
  const y = naturalSize.height * top;
  return {
    height: naturalSize.height * Math.max(0.01, 1 - top - bottom),
    width: naturalSize.width * Math.max(0.01, 1 - left - right),
    x,
    y,
  };
}

function normalizeShapeKind(geometry?: number): DirectShapeKind {
  if (geometry === 35) return "ellipse";
  if (geometry === 1 || geometry === 96) return "line";
  if (geometry === 26 || geometry === 28 || geometry === 29) return "roundRect";
  if (geometry === 3 || geometry === 4) return "triangle";
  if (geometry === 6) return "diamond";
  return "rect";
}

function wrapTextForSvg(text: string, fontSize: number, maxWidth: number): string {
  const maxLineWidth = Math.max(fontSize * 1.2, maxWidth * 0.94);
  const lines: string[] = [];
  for (const sourceLine of text.split(/\n/u)) {
    const tokens = textWrapTokens(sourceLine);
    let line = "";
    let lineWidth = 0;
    for (const token of tokens) {
      const tokenWidth = estimatedTextWidth(token, fontSize);
      if (line && lineWidth + tokenWidth > maxLineWidth) {
        lines.push(line.trimEnd());
        line = token.trimStart();
        lineWidth = estimatedTextWidth(line, fontSize);
        continue;
      }
      line += token;
      lineWidth += tokenWidth;
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n").trim();
}

function textWrapTokens(text: string): string[] {
  const tokens: string[] = [];
  let latin = "";
  for (const char of text) {
    if (/[\w\s.,:;!?()[\]{}'"“”‘’·/@#%&+\-=|<>]/u.test(char)) {
      latin += char;
      continue;
    }
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
    tokens.push(char);
  }
  if (latin) tokens.push(latin);
  return tokens;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (/\s/u.test(char)) width += fontSize * 0.32;
    else if (char.charCodeAt(0) <= 0x7f) width += fontSize * 0.55;
    else width += fontSize * 0.95;
  }
  return width;
}

async function renderSlideThumbnailDataUrl(
  slide: DirectCanvasSlide,
  media: Map<string, DirectCanvasMedia>,
  sharp: SharpFactory | null,
): Promise<string | null> {
  if (!sharp) return null;
  const buffer = await sharp(Buffer.from(renderSlideThumbnailSvg(slide, media)))
    .jpeg({ mozjpeg: true, quality: 50 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function renderSlideThumbnailSvg(
  slide: DirectCanvasSlide,
  media: Map<string, DirectCanvasMedia>,
): string {
  const width = 220;
  const height = Math.max(1, Math.round((width * slide.height) / Math.max(1, slide.width)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${slide.width} ${slide.height}">
<rect x="0" y="0" width="${slide.width}" height="${slide.height}" fill="${escapeXml(slide.background || "#ffffff")}"/>
${slide.elements.map((element) => renderSlideThumbnailElement(element, media)).join("\n")}
</svg>`;
}

function renderSlideThumbnailElement(
  element: DirectCanvasElement,
  media: Map<string, DirectCanvasMedia>,
): string {
  if (element.kind === "image") {
    const image = media.get(element.mediaId);
    if (!image) return "";
    const crop = element.crop ?? { height: image.height, width: image.width, x: 0, y: 0 };
    return `<svg x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none">
<image href="${escapeXml(image.src)}" x="0" y="0" width="${image.width}" height="${image.height}" preserveAspectRatio="none"/>
</svg>`;
  }
  if (element.kind === "shape") {
    const shapeProps = `fill="${escapeXml(element.fill)}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth}"`;
    if (element.shapeKind === "ellipse") {
      return `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" ${shapeProps}/>`;
    }
    if (element.shapeKind === "line") {
      return `<line x1="${element.x}" y1="${element.y}" x2="${element.x + element.width}" y2="${element.y + element.height}" stroke="${escapeXml(element.stroke)}" stroke-width="${element.strokeWidth || 9_525}"/>`;
    }
    if (element.shapeKind === "triangle") {
      return `<polygon points="${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height} ${element.x},${element.y + element.height}" ${shapeProps}/>`;
    }
    if (element.shapeKind === "diamond") {
      return `<polygon points="${element.x + element.width / 2},${element.y} ${element.x + element.width},${element.y + element.height / 2} ${element.x + element.width / 2},${element.y + element.height} ${element.x},${element.y + element.height / 2}" ${shapeProps}/>`;
    }
    return `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.radius}" ry="${element.radius}" ${shapeProps}/>`;
  }
  const lines = element.text.split(/\n/u);
  const anchor = element.textAlign === "center" ? "middle" : element.textAlign === "right" ? "end" : "start";
  const textX = element.textAlign === "center" ? element.x + element.width / 2 : element.textAlign === "right" ? element.x + element.width : element.x;
  const lineHeight = element.fontSize * 1.18;
  const tspans = lines
    .map((line, index) => `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text fill="${escapeXml(element.color)}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="${element.fontSize}" font-weight="${element.weight}" text-anchor="${anchor}" x="${textX}" y="${element.y + element.fontSize}">${tspans}</text>`;
}

function renderPresentationCanvasSource(payload: DirectCanvasPayload): string {
  return `import { Button, Pill, Row, Stack, Text, useCanvasState, useHostTheme } from "cursor/canvas";

type DirectCanvasElement =
  | { crop: DirectImageCrop | null; kind: "image"; mediaId: string; x: number; y: number; width: number; height: number }
  | { color: string; fontSize: number; italic: boolean; insetBottom: number; insetLeft: number; insetRight: number; insetTop: number; kind: "text"; lineHeight: number; text: string; textAlign: "center" | "left" | "right"; typeface: string; underline: boolean; verticalAlign: "bottom" | "middle" | "top"; weight: number; x: number; y: number; width: number; height: number }
  | { fill: string; kind: "shape"; radius: number; shapeKind: DirectShapeKind; stroke: string; strokeWidth: number; x: number; y: number; width: number; height: number };

type DirectCanvasMedia = { height: number; src: string; width: number };
type DirectImageCrop = { height: number; width: number; x: number; y: number };
type DirectShapeKind = "diamond" | "ellipse" | "line" | "rect" | "roundRect" | "triangle";

type DirectCanvasSlide = {
  background: string;
  elements: DirectCanvasElement[];
  height: number;
  index: number;
  thumbnail: string | null;
  title: string;
  width: number;
};

const payload = JSON.parse(${JSON.stringify(JSON.stringify(payload))}) as {
  artifact: { generatedBy: string; mode: "proto-direct"; reader: string; source: string; title: string };
  media: Record<string, DirectCanvasMedia>;
  slides: DirectCanvasSlide[];
};
const { artifact, media, slides } = payload;

export default function OfficePptCanvas() {
  const theme = useHostTheme();
  const [selectedIndex, setSelectedIndex] = useCanvasState("selected-slide-index", slides[0]?.index ?? 1);
  const [isPlaying, setIsPlaying] = useCanvasState("slideshow-open", false);
  const selectedPosition = Math.max(0, slides.findIndex((slide) => slide.index === selectedIndex));
  const selectedSlide = slides[selectedPosition] ?? slides[0];
  const goPrevious = () => setSelectedIndex(slides[Math.max(0, selectedPosition - 1)]?.index ?? selectedSlide.index);
  const goNext = () => setSelectedIndex(slides[Math.min(slides.length - 1, selectedPosition + 1)]?.index ?? selectedSlide.index);

  return (
    <div style={{
      background: theme.bg.editor,
      border: \`1px solid \${theme.stroke.secondary}\`,
      borderRadius: 8,
      color: theme.text.primary,
      display: "grid",
      gridTemplateRows: "52px minmax(0, 1fr)",
      height: "min(820px, calc(100vh - 40px))",
      overflow: "hidden",
    }}>
      <header style={{
        alignItems: "center",
        borderBottom: \`1px solid \${theme.stroke.secondary}\`,
        display: "grid",
        gap: 12,
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 520px) minmax(0, 1fr)",
        padding: "0 16px",
      }}>
        <Row gap={8} align="center" style={{ minWidth: 0 }}>
          <Pill active size="sm" tone="info">office wasm</Pill>
          <Text as="span" size="small" tone="secondary" truncate>{artifact.reader}</Text>
        </Row>
        <Text as="span" size="small" weight="semibold" truncate style={{ textAlign: "center" }}>{artifact.title}</Text>
        <Row gap={8} align="center" justify="end">
          <Text as="span" size="small" tone="secondary">{slides.length} slides</Text>
          <Button onClick={() => setIsPlaying(true)} variant="primary">Play</Button>
        </Row>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "clamp(156px, 13vw, 252px) minmax(0, 1fr)", minHeight: 0 }}>
        <aside style={{ borderRight: \`1px solid \${theme.stroke.secondary}\`, minHeight: 0, overflow: "auto", padding: "12px 14px 48px 8px" }}>
          <Stack gap={12}>
            {slides.map((slide) => {
              const active = slide.index === selectedSlide.index;
              return (
                <button
                  aria-current={active ? "true" : undefined}
                  aria-label={\`Slide \${slide.index}: \${slide.title}\`}
                  key={slide.index}
                  onClick={() => setSelectedIndex(slide.index)}
                  style={{
                    alignItems: "flex-start",
                    background: active ? theme.fill.secondary : "transparent",
                    border: \`1px solid \${active ? theme.accent.primary : "transparent"}\`,
                    borderRadius: 7,
                    color: theme.text.primary,
                    cursor: "pointer",
                    display: "flex",
                    gap: 8,
                    padding: "6px 8px 6px 0",
                    textAlign: "left",
                    width: "100%",
                  }}
                  title={slide.title}
                  type="button"
                >
                  <span style={{
                    color: theme.text.secondary,
                    flex: "0 0 22px",
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 500,
                    lineHeight: 1,
                    paddingTop: 4,
                    textAlign: "right",
                  }}>{slide.index}</span>
                  <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                    {slide.thumbnail ? (
                      <img alt="" draggable={false} src={slide.thumbnail} style={{
                        aspectRatio: \`\${slide.width} / \${slide.height}\`,
                        background: "#ffffff",
                        borderRadius: 4,
                        boxShadow: active ? \`0 0 0 1px \${theme.accent.primary}\` : "0 8px 22px rgba(15, 23, 42, 0.12)",
                        display: "block",
                        objectFit: "fill",
                        userSelect: "none",
                        width: "100%",
                      }} />
                    ) : (
                      <span style={{
                        aspectRatio: \`\${slide.width} / \${slide.height}\`,
                        background: "#ffffff",
                        borderRadius: 4,
                        display: "block",
                        width: "100%",
                      }} />
                    )}
                  </span>
                </button>
              );
            })}
          </Stack>
        </aside>
        <main style={{ background: theme.fill.primary, minHeight: 0, overflow: "auto", padding: "16px 24px 20px" }}>
          <div style={{ margin: "0 auto", maxWidth: 960 }}>
            <SlideSurface slide={selectedSlide} />
          </div>
        </main>
      </div>
      {isPlaying ? (
        <div aria-label="Play slideshow" aria-modal="true" role="dialog" style={{
          alignItems: "center",
          background: "#000000",
          display: "flex",
          inset: 0,
          justifyContent: "center",
          padding: 20,
          position: "fixed",
          zIndex: 1000,
        }}>
          <div style={{ position: "absolute", right: 20, top: 18, zIndex: 2 }}>
            <Row gap={8} align="center">
              <span style={{ background: "rgba(15, 23, 42, 0.86)", border: "1px solid rgba(148, 163, 184, 0.34)", borderRadius: 999, color: "#cbd5e1", fontSize: 13, fontWeight: 600, padding: "8px 12px" }}>Slide {selectedSlide.index} / {slides.length}</span>
              <button aria-label="Close slideshow" onClick={() => setIsPlaying(false)} style={chromeButtonStyle} type="button">x</button>
            </Row>
          </div>
          <button aria-label="Next slide" onClick={goNext} style={{ background: "transparent", border: 0, cursor: "pointer", maxHeight: "100%", maxWidth: "100%", padding: 0 }} type="button">
            <div style={{ width: "min(92vw, calc(92vh * 16 / 9))" }}>
              <SlideSurface slide={selectedSlide} />
            </div>
          </button>
          <button aria-label="Previous slide" onClick={goPrevious} style={{ ...navButtonStyle, left: 18 }} type="button">{"<"}</button>
          <button aria-label="Next slide" onClick={goNext} style={{ ...navButtonStyle, right: 18 }} type="button">{">"}</button>
        </div>
      ) : null}
    </div>
  );
}

function SlideSurface({ slide }: { slide: DirectCanvasSlide }) {
  return (
    <div
      role="img"
      aria-label={\`Slide \${slide.index}\`}
      style={{
      aspectRatio: \`\${slide.width} / \${slide.height}\`,
      background: "#ffffff",
      border: "1px solid rgba(148, 163, 184, 0.44)",
      borderRadius: 8,
      containerType: "inline-size",
      overflow: "hidden",
      position: "relative",
      width: "100%",
    }}>
      <svg
        aria-hidden="true"
        viewBox={\`0 0 \${slide.width} \${slide.height}\`}
        style={{ display: "block", height: "100%", inset: 0, position: "absolute", width: "100%" }}
      >
        <rect x={0} y={0} width={slide.width} height={slide.height} fill={slide.background || "#ffffff"} />
      </svg>
      {slide.elements.map((element, index) => element.kind === "text" ? (
        <SlideTextElement element={element} key={index} slide={slide} />
      ) : (
        <svg
          aria-hidden="true"
          key={index}
          viewBox={\`0 0 \${slide.width} \${slide.height}\`}
          style={{ display: "block", height: "100%", inset: 0, pointerEvents: "none", position: "absolute", width: "100%" }}
        >
          <SlideElement element={element} />
        </svg>
      ))}
    </div>
  );
}

function SlideElement({ element }: { element: DirectCanvasElement }) {
  if (element.kind === "image") {
    const image = media[element.mediaId];
    if (!image) return null;
    const crop = element.crop ?? { height: image.height, width: image.width, x: 0, y: 0 };
    return (
      <svg x={element.x} y={element.y} width={element.width} height={element.height} viewBox={\`\${crop.x} \${crop.y} \${crop.width} \${crop.height}\`} preserveAspectRatio="none">
        <image href={image.src} preserveAspectRatio="none" x={0} y={0} width={image.width} height={image.height} />
      </svg>
    );
  }
  if (element.kind === "shape") {
    const shapeProps = { fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth };
    if (element.shapeKind === "ellipse") {
      return <ellipse cx={element.x + element.width / 2} cy={element.y + element.height / 2} rx={element.width / 2} ry={element.height / 2} {...shapeProps} />;
    }
    if (element.shapeKind === "line") {
      return <line x1={element.x} y1={element.y} x2={element.x + element.width} y2={element.y + element.height} stroke={element.stroke} strokeWidth={element.strokeWidth || 9_525} />;
    }
    if (element.shapeKind === "triangle") {
      return <polygon points={\`\${element.x + element.width / 2},\${element.y} \${element.x + element.width},\${element.y + element.height} \${element.x},\${element.y + element.height}\`} {...shapeProps} />;
    }
    if (element.shapeKind === "diamond") {
      return <polygon points={\`\${element.x + element.width / 2},\${element.y} \${element.x + element.width},\${element.y + element.height / 2} \${element.x + element.width / 2},\${element.y + element.height} \${element.x},\${element.y + element.height / 2}\`} {...shapeProps} />;
    }
    return <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={element.radius} ry={element.radius} {...shapeProps} />;
  }
  return null;
}

function SlideTextElement({ element, slide }: { element: Extract<DirectCanvasElement, { kind: "text" }>; slide: DirectCanvasSlide }) {
  const justifyContent = element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start";
  return (
    <div
      style={{
        boxSizing: "border-box",
        color: element.color,
        display: "flex",
        flexDirection: "column",
        fontFamily: fontStack(element.typeface),
        fontSize: \`\${(element.fontSize / slide.width) * 100}cqw\`,
        fontStyle: element.italic ? "italic" : "normal",
        fontWeight: element.weight,
        height: \`\${(element.height / slide.height) * 100}%\`,
        justifyContent,
        left: \`\${(element.x / slide.width) * 100}%\`,
        lineHeight: element.lineHeight / element.fontSize,
        overflow: "hidden",
        paddingBottom: \`\${(element.insetBottom / slide.height) * 100}%\`,
        paddingLeft: \`\${(element.insetLeft / slide.width) * 100}%\`,
        paddingRight: \`\${(element.insetRight / slide.width) * 100}%\`,
        paddingTop: \`\${(element.insetTop / slide.height) * 100}%\`,
        position: "absolute",
        textAlign: element.textAlign,
        textDecoration: element.underline ? "underline" : "none",
        top: \`\${(element.y / slide.height) * 100}%\`,
        whiteSpace: "pre-wrap",
        width: \`\${(element.width / slide.width) * 100}%\`,
      }}
    >
      {element.text}
    </div>
  );
}

function fontStack(typeface: string) {
  const fallback = "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif";
  return typeface ? \`\${JSON.stringify(typeface).slice(1, -1)}, \${fallback}\` : fallback;
}

const chromeButtonStyle = {
  background: "rgba(15, 23, 42, 0.86)",
  border: "1px solid rgba(148, 163, 184, 0.34)",
  borderRadius: 6,
  color: "#f8fafc",
  cursor: "pointer",
  font: "600 13px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  height: 34,
  width: 34,
};

const navButtonStyle = {
  background: "rgba(15, 23, 42, 0.62)",
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: 999,
  color: "#f8fafc",
  cursor: "pointer",
  font: "500 34px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  height: 46,
  position: "absolute" as const,
  top: "50%",
  transform: "translateY(-50%)",
  width: 46,
  zIndex: 2,
};
`;
}

function firstText(elements: DirectCanvasElement[]): string {
  return elements.find((element) => element.kind === "text")?.text.split(/\n/u)[0]?.trim() ?? "";
}

function imageSize(bytes: Uint8Array): { height: number; width: number } {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      height: readUint32BE(bytes, 20),
      width: readUint32BE(bytes, 16),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: (bytes[offset + 5] << 8) + bytes[offset + 6],
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        };
      }
      offset += 2 + length;
    }
  }
  return { height: 1, width: 1 };
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const imported = await import("sharp");
    return imported.default;
  } catch {
    return null;
  }
}

function clampQuality(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

export type { DirectCanvasPayload, RecordValue };
