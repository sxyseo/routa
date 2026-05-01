"use client";

import { useState } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  collectTextBlocks,
  colorToCss,
  elementImageReferenceId,
  EMPTY_DOCUMENT_STYLE_MAPS,
  fillToCss,
  lineToCss,
  paragraphView,
  type PreviewLabels,
  type RecordValue,
  slideBackgroundToCss,
  textRunStyle,
  useOfficeImageSources,
} from "./office-preview-utils";

export function PresentationPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const slides = asArray(root?.slides).map(asRecord).filter((slide): slide is RecordValue => slide != null);
  const imageSources = useOfficeImageSources(root);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const selectedSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const selectedSlide = slides[selectedSlideIndex] ?? {};

  if (slides.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSlides}</p>;
  }

  return (
    <div
      data-testid="presentation-preview"
      style={{
        background: "#f8fafc",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        display: "grid",
        gridTemplateColumns: "minmax(150px, 220px) minmax(0, 1fr)",
        minHeight: 620,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          borderRight: "1px solid #cbd5e1",
          display: "grid",
          gap: 10,
          maxHeight: 720,
          overflowY: "auto",
          padding: 12,
        }}
      >
        {slides.map((slide, index) => (
          <button
            key={`${asString(slide.id)}-${index}`}
            onClick={() => setActiveSlideIndex(index)}
            style={{
              background: "transparent",
              border: "0",
              color: "#0f172a",
              cursor: "pointer",
              display: "grid",
              gap: 6,
              padding: 0,
              textAlign: "left",
            }}
            type="button"
          >
            <span style={{ color: "#475569", fontSize: 12, fontWeight: 600 }}>
              {labels.slide} {asNumber(slide.index, index + 1)}
            </span>
            <SlideFrame
              compact
              imageSources={imageSources}
              isActive={index === selectedSlideIndex}
              slide={slide}
            />
          </button>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <SlideCanvas
          imageSources={imageSources}
          labels={labels}
          slide={selectedSlide}
          slideIndex={selectedSlideIndex}
        />
      </div>
    </div>
  );
}

function SlideCanvas({
  imageSources,
  labels,
  slide,
  slideIndex,
}: {
  imageSources: Map<string, string>;
  labels: PreviewLabels;
  slide: RecordValue;
  slideIndex: number;
}) {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const textRunCount = elements.reduce((count, element) => {
    return count + collectTextBlocks(element, 20).length;
  }, 0);

  return (
    <article style={{ display: "grid", gap: 12, minHeight: 0, overflow: "auto", padding: 18 }}>
      <div style={{ color: "#475569", display: "flex", flexWrap: "wrap", gap: 12, fontSize: 13 }}>
        <strong>{labels.slide} {asNumber(slide.index, slideIndex + 1)}</strong>
        <span>{elements.length} {labels.shapes}</span>
        <span>{textRunCount} {labels.textRuns}</span>
      </div>
      <SlideFrame imageSources={imageSources} slide={slide} />
    </article>
  );
}

function slideBounds(slide: RecordValue): { width: number; height: number } {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  return elements.reduce<{ width: number; height: number }>(
    (acc, element) => {
      const bbox = asRecord(element.bbox);
      return {
        width: Math.max(acc.width, asNumber(bbox?.xEmu) + asNumber(bbox?.widthEmu)),
        height: Math.max(acc.height, asNumber(bbox?.yEmu) + asNumber(bbox?.heightEmu)),
      };
    },
    { width: 12_192_000, height: 6_858_000 },
  );
}

function SlideFrame({
  compact = false,
  imageSources,
  isActive = false,
  slide,
}: {
  compact?: boolean;
  imageSources: Map<string, string>;
  isActive?: boolean;
  slide: RecordValue;
}) {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const bounds = slideBounds(slide);
  const background = slideBackgroundToCss(slide);

  return (
    <div
      style={{
        aspectRatio: `${bounds.width} / ${bounds.height}`,
        background,
        border: `1px solid ${isActive ? "#0285ff" : "#cbd5e1"}`,
        borderRadius: 6,
        boxShadow: isActive ? "0 0 0 2px rgba(2, 133, 255, 0.18)" : "0 8px 22px rgba(15, 23, 42, 0.12)",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {elements.map((element, index) => (
        <SlideElement
          bounds={bounds}
          compact={compact}
          element={element}
          imageSources={imageSources}
          key={`${asString(element.id)}-${index}`}
        />
      ))}
    </div>
  );
}

function SlideElement({
  bounds,
  compact,
  element,
  imageSources,
}: {
  bounds: { width: number; height: number };
  compact: boolean;
  element: RecordValue;
  imageSources: Map<string, string>;
}) {
  const bbox = asRecord(element.bbox);
  const shape = asRecord(element.shape);
  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, EMPTY_DOCUMENT_STYLE_MAPS));
  const text = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).filter(Boolean).join("\n");
  const firstRun = asRecord(asArray(asRecord(asArray(element.paragraphs)[0])?.runs)[0]);
  const textStyle = asRecord(firstRun?.textStyle);
  const fill = fillToCss(shape?.fill);
  const line = lineToCss(shape?.line);
  const textColor = colorToCss(asRecord(textStyle?.fill)?.color) ?? "#0f172a";
  const fontScale = compact ? 0.15 : 1;
  const fontSize = Math.max(compact ? 2 : 10, Math.min(44, asNumber(textStyle?.fontSize, 1200) / 100) * fontScale);
  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? imageSources.get(imageId) : undefined;
  const heightEmu = asNumber(bbox?.heightEmu);
  const isLine = heightEmu === 0 && line.color != null;
  const borderRadius = shape?.geometry === 26 ? 8 : shape?.geometry === 35 || shape?.geometry === 89 ? "999px" : 3;

  return (
    <div
      style={{
        alignItems: "center",
        background: text ? "transparent" : fill,
        borderColor: !isLine ? line.color : undefined,
        borderRadius,
        borderStyle: !isLine && line.color ? "solid" : undefined,
        borderTopColor: isLine ? line.color : undefined,
        borderTopStyle: isLine && line.color ? "solid" : undefined,
        borderTopWidth: isLine && line.color ? line.width : undefined,
        borderWidth: !isLine && line.color ? line.width : undefined,
        color: textColor,
        display: "flex",
        fontSize,
        fontWeight: textStyle?.bold === true ? 700 : 400,
        height: `${(asNumber(bbox?.heightEmu) / bounds.height) * 100}%`,
        left: `${(asNumber(bbox?.xEmu) / bounds.width) * 100}%`,
        lineHeight: 1.15,
        overflow: "hidden",
        padding: text ? (compact ? "0.05em" : "0.15em") : 0,
        position: "absolute",
        top: `${(asNumber(bbox?.yEmu) / bounds.height) * 100}%`,
        transform: `rotate(${asNumber(bbox?.rotation) / 60000}deg)`,
        whiteSpace: "pre-wrap",
        width: `${(asNumber(bbox?.widthEmu) / bounds.width) * 100}%`,
      }}
      title={asString(element.name)}
    >
      {imageSrc ? (
        <span
          aria-hidden="true"
          style={{
            backgroundImage: `url("${imageSrc}")`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 100%",
            height: "100%",
            inset: 0,
            position: "absolute",
            width: "100%",
          }}
        />
      ) : null}
      {text ? (
        <span style={{ display: "grid", position: "relative", width: "100%", zIndex: 1 }}>
          {paragraphs.map((paragraph, paragraphIndex) => (
            <span key={paragraph.id || paragraphIndex}>
              {paragraph.runs.map((run, runIndex) => (
                <span key={run.id || runIndex} style={textRunStyle(run, fontScale)}>
                  {run.text}
                </span>
              ))}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
