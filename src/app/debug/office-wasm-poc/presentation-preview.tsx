"use client";

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import {
  asArray,
  asNumber,
  asRecord,
  asString,
  collectTextBlocks,
  prewarmOfficeFonts,
  type PreviewLabels,
  type RecordValue,
  useOfficeImageSources,
} from "./office-preview-utils";
import styles from "./presentation-preview.module.css";
import {
  collectPresentationTypefaces,
  computePresentationFit,
  getSlideFrameSize,
  renderPresentationSlide,
  type PresentationSize,
  type PresentationTextOverflow,
} from "./presentation-renderer";

const THUMBNAIL_WIDTH = 176;
const STACK_BAR_COUNT = 12;

export function PresentationPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
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
                {labels.slide} {asNumber(slide.index, index + 1)}
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
  const stageSize = useElementSize(stageRef);
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const textRunCount = elements.reduce((count, element) => count + collectTextBlocks(element, 20).length, 0);
  const frame = getSlideFrameSize(slide);
  const fit = computePresentationFit(stageSize, frame);
  const canvasWidth = Math.max(1, fit.width);

  return (
    <main className={styles.mainPanel}>
      <div className={styles.meta}>
        <strong className={styles.metaStrong}>
          {labels.slide} {asNumber(slide.index, slideIndex + 1)}
        </strong>
        <span className={styles.metaText}>
          {elements.length} {labels.shapes}
        </span>
        <span className={styles.metaText}>
          {textRunCount} {labels.textRuns}
        </span>
      </div>
      <div className={styles.stage} ref={stageRef}>
        <SlideCanvasFrame
          className={styles.slideCanvas}
          images={images}
          slide={slide}
          textOverflow="visible"
          width={canvasWidth}
        />
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
