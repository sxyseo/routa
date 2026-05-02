"use client";

import { Play, X } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
const SLIDE_BITMAP_WIDTH = 1920;
const STACK_BAR_COUNT = 12;
export const PRESENTATION_HEADER_ACTIONS_ID = "office-wasm-presentation-header-actions";

type SlideBitmapSurface = {
  height: number;
  url: string;
  width: number;
};

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
  const layouts = useMemo(
    () => asArray(root?.layouts).map(asRecord).filter((layout): layout is RecordValue => layout != null),
    [root],
  );
  const imageSources = useOfficeImageSources(root);
  const imageElements = useLoadedOfficeImages(imageSources);
  const slideBitmaps = useRenderedSlideBitmaps(slides, imageElements, layouts);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isSlideshowOpen, setIsSlideshowOpen] = useState(false);
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
  const [thumbnailRailOpen, setThumbnailRailOpen] = useState(false);
  const selectedSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const selectedSlide = slides[selectedSlideIndex] ?? {};
  const openSlideshow = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => undefined);
    }
    setIsSlideshowOpen(true);
  }, []);
  const closeSlideshow = useCallback(() => setIsSlideshowOpen(false), []);

  useEffect(() => {
    void prewarmOfficeFonts(collectPresentationTypefaces(slides, layouts));
  }, [layouts, slides]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHeaderActions(document.getElementById(PRESENTATION_HEADER_ACTIONS_ID));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

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
              <SlideRasterFrame
                alt=""
                bitmap={slideBitmaps.get(slideRenderKey(slide, index))}
                className={styles.thumbnailCanvas}
                fallbackImages={imageElements}
                fallbackTextOverflow="clip"
                layouts={layouts}
                slide={slide}
                width={THUMBNAIL_WIDTH}
              />
            </button>
          ))}
        </div>
      </aside>
      <SlideStage
        images={imageElements}
        labels={labels}
        layouts={layouts}
        slideBitmap={slideBitmaps.get(slideRenderKey(selectedSlide, selectedSlideIndex))}
        slide={selectedSlide}
        slideIndex={selectedSlideIndex}
      />
      {headerActions
        ? createPortal(
            <button className={styles.playButton} onClick={openSlideshow} type="button">
              <Play aria-hidden="true" size={15} strokeWidth={2} />
              <span>{labels.playSlideshow}</span>
            </button>,
            headerActions,
          )
        : null}
      {isSlideshowOpen ? (
        <SlideshowOverlay
          activeSlideIndex={selectedSlideIndex}
          images={imageElements}
          labels={labels}
          layouts={layouts}
          onClose={closeSlideshow}
          setActiveSlideIndex={setActiveSlideIndex}
          slideBitmaps={slideBitmaps}
          slides={slides}
        />
      ) : null}
    </div>
  );
}

function SlideStage({
  images,
  labels,
  layouts,
  slideBitmap,
  slide,
  slideIndex,
}: {
  images: ReadonlyMap<string, CanvasImageSource>;
  labels: PreviewLabels;
  layouts: RecordValue[];
  slideBitmap?: SlideBitmapSurface;
  slide: RecordValue;
  slideIndex: number;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ elementId: string; slideKey: string } | null>(null);
  const stageSize = useElementSize(stageRef);
  const footnote = useMemo(() => slideFootnoteText(slide), [slide]);
  const footnoteHeight = footnoteReservePx(footnote);
  const frame = getSlideFrameSize(slide, layouts);
  const fit = computePresentationFit(
    {
      height: stageSize.height,
      width: stageSize.width,
    },
    frame,
    { padding: 24 },
  );
  const canvasWidth = Math.max(1, fit.width);
  const canvasHeight = Math.max(1, fit.height);
  const slideKey = `${asString(slide.id)}-${slideIndex}`;
  const elementTargets = useMemo(
    () => getPresentationElementTargets(slide, { height: canvasHeight, width: canvasWidth }, layouts),
    [canvasHeight, canvasWidth, layouts, slide],
  );
  const selectedTarget =
    selection?.slideKey === slideKey ? (elementTargets.find((target) => target.id === selection.elementId) ?? null) : null;

  return (
    <main className={styles.mainPanel}>
      <div className={styles.stage} ref={stageRef}>
        <div className={styles.viewport}>
          <div
            className={styles.slideSurface}
            style={{ height: canvasHeight, width: canvasWidth }}
          >
            <SlideRasterFrame
              alt={`${labels.slide} ${asNumber(slide.index, slideIndex + 1)}`}
              bitmap={slideBitmap}
              className={styles.slideCanvas}
              fallbackImages={images}
              fallbackTextOverflow="visible"
              layouts={layouts}
              slide={slide}
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

function SlideshowOverlay({
  activeSlideIndex,
  images,
  labels,
  layouts,
  onClose,
  setActiveSlideIndex,
  slideBitmaps,
  slides,
}: {
  activeSlideIndex: number;
  images: ReadonlyMap<string, CanvasImageSource>;
  labels: PreviewLabels;
  layouts: RecordValue[];
  onClose: () => void;
  setActiveSlideIndex: (index: number) => void;
  slideBitmaps: ReadonlyMap<string, SlideBitmapSurface>;
  slides: RecordValue[];
}) {
  const frameRef = useRef<HTMLButtonElement>(null);
  const frameSize = useElementSize(frameRef);
  const didEnterFullscreenRef = useRef(typeof document !== "undefined" && document.fullscreenElement != null);
  const selectedIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const slide = slides[selectedIndex] ?? {};
  const frame = getSlideFrameSize(slide, layouts);
  const fit = computePresentationFit(frameSize, frame, { padding: 20 });
  const canvasWidth = Math.max(1, fit.width);

  const goPrevious = useCallback(() => {
    setActiveSlideIndex(Math.max(0, selectedIndex - 1));
  }, [selectedIndex, setActiveSlideIndex]);

  const goNext = useCallback(() => {
    setActiveSlideIndex(Math.min(slides.length - 1, selectedIndex + 1));
  }, [selectedIndex, setActiveSlideIndex, slides.length]);

  const closeSlideshow = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        didEnterFullscreenRef.current = true;
        return;
      }

      if (didEnterFullscreenRef.current) {
        onClose();
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [onClose]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlideshow();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrevious();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSlideshow, goNext, goPrevious]);

  return (
    <div
      aria-label={labels.playSlideshow}
      aria-modal="true"
      className={styles.slideshowOverlay}
      data-testid="presentation-slideshow"
      role="dialog"
    >
      <div className={styles.slideshowChrome}>
        <div className={styles.slideshowCounter}>
          {labels.slide} {asNumber(slide.index, selectedIndex + 1)} / {slides.length}
        </div>
        <button aria-label={labels.closeSlideshow} className={styles.slideshowIconButton} onClick={closeSlideshow} type="button">
          <X aria-hidden="true" size={18} strokeWidth={2} />
        </button>
      </div>
      <button
        aria-label={labels.nextSlide}
        className={styles.slideshowFrame}
        onClick={goNext}
        ref={frameRef}
        type="button"
      >
        <SlideRasterFrame
          alt={`${labels.slide} ${asNumber(slide.index, selectedIndex + 1)}`}
          bitmap={slideBitmaps.get(slideRenderKey(slide, selectedIndex))}
          className={styles.slideshowCanvas}
          fallbackImages={images}
          fallbackTextOverflow="visible"
          layouts={layouts}
          slide={slide}
          width={canvasWidth}
        />
      </button>
    </div>
  );
}

function SlideRasterFrame({
  alt,
  bitmap,
  className,
  fallbackImages,
  fallbackTextOverflow,
  layouts,
  slide,
  width,
}: {
  alt: string;
  bitmap?: SlideBitmapSurface;
  className: string;
  fallbackImages: ReadonlyMap<string, CanvasImageSource>;
  fallbackTextOverflow: PresentationTextOverflow;
  layouts: RecordValue[];
  slide: RecordValue;
  width: number;
}) {
  const frame = getSlideFrameSize(slide, layouts);
  const height = Math.max(1, (width / frame.width) * frame.height);
  if (bitmap) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Runtime object URLs are generated from the canvas preview surface.
      <img
        alt={alt}
        className={className}
        draggable={false}
        height={Math.round(height)}
        src={bitmap.url}
        style={{ height, width }}
        width={Math.round(width)}
      />
    );
  }

  return (
    <SlideCanvasFrame
      className={className}
      images={fallbackImages}
      layouts={layouts}
      slide={slide}
      textOverflow={fallbackTextOverflow}
      width={width}
    />
  );
}

function SlideCanvasFrame({
  className,
  images,
  layouts,
  slide,
  textOverflow,
  width,
}: {
  className: string;
  images: ReadonlyMap<string, CanvasImageSource>;
  layouts: RecordValue[];
  slide: RecordValue;
  textOverflow: PresentationTextOverflow;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = getSlideFrameSize(slide, layouts);
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
    renderPresentationSlide({ context, height, images, layouts, slide, textOverflow, width });
  }, [height, images, layouts, slide, textOverflow, width]);

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

function useRenderedSlideBitmaps(
  slides: RecordValue[],
  images: ReadonlyMap<string, CanvasImageSource>,
  layouts: RecordValue[],
): ReadonlyMap<string, SlideBitmapSurface> {
  const [bitmaps, setBitmaps] = useState<ReadonlyMap<string, SlideBitmapSurface>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    window.requestAnimationFrame(() => {
      if (!cancelled) {
        setBitmaps(new Map());
      }
    });

    async function renderBitmaps(): Promise<void> {
      if (slides.length === 0) return;

      await waitForDocumentFonts();
      const next = new Map<string, SlideBitmapSurface>();
      for (const [index, slide] of slides.entries()) {
        if (cancelled) return;

        const frame = getSlideFrameSize(slide, layouts);
        const width = SLIDE_BITMAP_WIDTH;
        const height = Math.max(1, (width / frame.width) * frame.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext("2d");
        if (!context) continue;

        renderPresentationSlide({
          context,
          height,
          images,
          layouts,
          slide,
          textOverflow: "visible",
          width,
        });
        const blob = await canvasToBlob(canvas);
        if (!blob || cancelled) continue;

        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        next.set(slideRenderKey(slide, index), { height, url, width });
        if (!cancelled) {
          setBitmaps(new Map(next));
        }
      }
    }

    void renderBitmaps();
    return () => {
      cancelled = true;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [images, layouts, slides]);

  return bitmaps;
}

async function waitForDocumentFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await document.fonts.ready.catch(() => undefined);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
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

function slideRenderKey(slide: RecordValue, index: number): string {
  return `${asString(slide.id) || "slide"}-${index}`;
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
