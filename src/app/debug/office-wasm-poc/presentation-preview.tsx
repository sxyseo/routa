"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  prewarmOfficeFonts,
  type PreviewLabels,
  type RecordValue,
  useOfficeImageSources,
} from "./office-preview-utils";
import styles from "./presentation-preview.module.css";
import {
  collectPresentationTypefaces,
  computePresentationFit,
  getPresentationElementTargets,
  getSlideFrameSize,
  renderPresentationSlide,
  type PresentationSize,
  type PresentationTextOverflow,
} from "./presentation-renderer";

const THUMBNAIL_WIDTH = 192;
const STACK_BAR_COUNT = 12;

export function PresentationPreview({
  labels,
  proto,
}: {
  labels: PreviewLabels;
  proto: unknown;
}) {
  const root = asRecord(proto);
  const slides = useMemo(
    () => asArray(root?.slides).map(asRecord).filter((slide): slide is RecordValue => slide != null),
    [root],
  );
  const imageSources = useOfficeImageSources(root);
  const imageElements = useLoadedOfficeImages(imageSources);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [thumbnailRailOpen, setThumbnailRailOpen] = useState(false);
  const selectedSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const selectedSlide = slides[selectedSlideIndex] ?? {};

  useEffect(() => {
    void prewarmOfficeFonts(collectPresentationTypefaces(slides));
  }, [slides]);

  if (slides.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSlides}</p>;
  }

  return (
    <div className={styles.shell} data-testid="presentation-preview">
      <aside className={styles.rail} data-open={thumbnailRailOpen}>
        <button
          aria-label={labels.slide}
          className={styles.stackButton}
          onClick={() => setThumbnailRailOpen((isOpen) => !isOpen)}
          type="button"
        >
          {Array.from({ length: Math.min(STACK_BAR_COUNT, slides.length) }).map((_, index) => (
            <span className={styles.stackBar} key={index} />
          ))}
        </button>
        <div className={styles.thumbnailPanel}>
          {slides.map((slide, index) => (
            <button
              aria-label={`${labels.slide} ${asNumber(slide.index, index + 1)}`}
              className={styles.thumbnailButton}
              data-active={index === selectedSlideIndex}
              key={`${asString(slide.id)}-${index}`}
              onClick={() => {
                setActiveSlideIndex(index);
                setThumbnailRailOpen(false);
              }}
              type="button"
            >
              <span className={styles.thumbnailLabel}>
                {asNumber(slide.index, index + 1)}
              </span>
              <SlideCanvasFrame
                className={styles.thumbnailCanvas}
                images={imageElements}
                slide={slide}
                textOverflow="clip"
                width={THUMBNAIL_WIDTH}
              />
            </button>
          ))}
        </div>
      </aside>
      <SlideStage
        images={imageElements}
        labels={labels}
        slide={selectedSlide}
        slideIndex={selectedSlideIndex}
      />
    </div>
  );
}

function SlideStage({
  images,
  labels,
  slide,
  slideIndex,
}: {
  images: ReadonlyMap<string, CanvasImageSource>;
  labels: PreviewLabels;
  slide: RecordValue;
  slideIndex: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ elementId: string; slideKey: string } | null>(null);
  const stageSize = useElementSize(stageRef);
  const footnote = useMemo(() => slideFootnoteText(slide), [slide]);
  const footnoteHeight = footnoteReservePx(footnote);
  const frame = getSlideFrameSize(slide);
  const fit = computePresentationFit(
    {
      height: Math.max(1, stageSize.height - (footnote ? Math.min(48, footnoteHeight) : 0)),
      width: stageSize.width,
    },
    frame,
  );
  const canvasWidth = Math.max(1, fit.width);
  const canvasHeight = Math.max(1, fit.height);
  const slideKey = `${asString(slide.id)}-${slideIndex}`;
  const elementTargets = useMemo(
    () => getPresentationElementTargets(slide, { height: canvasHeight, width: canvasWidth }),
    [canvasHeight, canvasWidth, slide],
  );
  const selectedTarget =
    selection?.slideKey === slideKey ? (elementTargets.find((target) => target.id === selection.elementId) ?? null) : null;

  return (
    <main className={styles.mainPanel}>
      <div className={styles.stage} ref={stageRef}>
        <div className={styles.viewport}>
          <div className={styles.slideHeading}>
            <strong>
              {labels.slide} {asNumber(slide.index, slideIndex + 1)}
            </strong>
          </div>
          <div
            className={styles.slideSurface}
            style={{ height: canvasHeight, width: canvasWidth }}
          >
            <SlideCanvasFrame
              className={styles.slideCanvas}
              images={images}
              slide={slide}
              textOverflow="visible"
              width={canvasWidth}
            />
            <button
              aria-label={selectedTarget?.name ?? labels.slide}
              className={styles.interactionLayer}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const point = {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top,
                };
                const target = hitTestElementTarget(elementTargets, point);
                setSelection(target ? { elementId: target.id, slideKey } : null);
              }}
              type="button"
            >
              {selectedTarget ? (
                <span
                  aria-hidden="true"
                  className={styles.selectionBox}
                  style={{
                    height: selectedTarget.rect.height,
                    transform: `translate(${selectedTarget.rect.left}px, ${selectedTarget.rect.top}px)`,
                    width: selectedTarget.rect.width,
                  }}
                >
                  <span className={styles.selectionHandle} data-position="top-left" />
                  <span className={styles.selectionHandle} data-position="top-right" />
                  <span className={styles.selectionHandle} data-position="bottom-left" />
                  <span className={styles.selectionHandle} data-position="bottom-right" />
                </span>
              ) : null}
            </button>
          </div>
          {footnote ? (
            <pre className={styles.footnote} data-testid="presentation-footnote" style={{ maxHeight: footnoteHeight, width: canvasWidth }}>
              {footnote}
            </pre>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SlideCanvasFrame({
  className,
  images,
  slide,
  textOverflow,
  width,
}: {
  className: string;
  images: ReadonlyMap<string, CanvasImageSource>;
  slide: RecordValue;
  textOverflow: PresentationTextOverflow;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = getSlideFrameSize(slide);
  const height = Math.max(1, (width / frame.width) * frame.height);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    renderPresentationSlide({ context, height, images, slide, textOverflow, width });
  }, [height, images, slide, textOverflow, width]);

  return (
    <canvas
      aria-hidden="true"
      className={className}
      height={Math.round(height)}
      ref={canvasRef}
      width={Math.round(width)}
    />
  );
}

function useLoadedOfficeImages(imageSources: Map<string, string>): ReadonlyMap<string, CanvasImageSource> {
  const [images, setImages] = useState<ReadonlyMap<string, CanvasImageSource>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const next = new Map<string, CanvasImageSource>();
    if (imageSources.size === 0) {
      window.requestAnimationFrame(() => {
        if (!cancelled) setImages(next);
      });
      return;
    }

    for (const [id, src] of imageSources) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        next.set(id, image);
        if (!cancelled) setImages(new Map(next));
      };
      image.onerror = () => {
        if (!cancelled) setImages(new Map(next));
      };
      image.src = src;
      if (image.complete && image.naturalWidth > 0) {
        next.set(id, image);
      }
    }

    window.requestAnimationFrame(() => {
      if (!cancelled) setImages(new Map(next));
    });
    return () => {
      cancelled = true;
    };
  }, [imageSources]);

  return images;
}

function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): PresentationSize {
  const [size, setSize] = useState<PresentationSize>({ height: 0, width: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ height: rect.height, width: rect.width });
    };
    update();

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(update);
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return size;
}

function hitTestElementTarget(
  targets: ReturnType<typeof getPresentationElementTargets>,
  point: { x: number; y: number },
) {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index];
    if (!target) {
      continue;
    }
    if (
      point.x >= target.rect.left &&
      point.x <= target.rect.left + target.rect.width &&
      point.y >= target.rect.top &&
      point.y <= target.rect.top + target.rect.height
    ) {
      return target;
    }
  }
  return null;
}

function slideFootnoteText(slide: RecordValue): string {
  const notesSlide = asRecord(slide.notesSlide);
  if (!notesSlide) return "";

  const blocks: string[] = [];
  for (const element of asArray(notesSlide.elements)) {
    const record = asRecord(element);
    if (!record || !isNotesBodyPlaceholder(record)) {
      continue;
    }

    const text = asArray(record.paragraphs)
      .map((paragraph) =>
        asArray(asRecord(paragraph)?.runs)
          .map((run) => asString(asRecord(run)?.text))
          .join("")
          .trim(),
      )
      .filter((line) => line && !/^\d+$/u.test(line))
      .join("\n")
      .trim();
    if (text && !blocks.includes(text)) {
      blocks.push(text);
    }
  }

  return blocks.join("\n\n");
}

function isNotesBodyPlaceholder(element: RecordValue): boolean {
  const placeholderType = asString(element.placeholderType).toLowerCase();
  const name = asString(element.name).toLowerCase();
  if (placeholderType === "sldimg" || placeholderType === "sldnum") return false;
  if (placeholderType === "body" || placeholderType === "notes") return true;
  if (name.includes("notes") || name.includes("body")) return true;
  return placeholderType === "" && asArray(element.paragraphs).length > 0;
}

function footnoteReservePx(footnote: string): number {
  if (!footnote) return 0;
  const lineCount = Math.max(1, footnote.split(/\n/u).length);
  return Math.max(48, Math.min(96, lineCount * 18 + 24));
}
