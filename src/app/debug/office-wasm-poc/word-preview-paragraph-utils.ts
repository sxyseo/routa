import { type CSSProperties } from "react";

import { asNumber, type ParagraphView, type RecordValue } from "./office-preview-utils";

export function wordParagraphHasVisibleContent(paragraph: ParagraphView): boolean {
  return Boolean(paragraph.marker) || paragraph.runs.some((run) => (
    run.text.trim() !== "" || (run.referenceMarkers?.length ?? 0) > 0
  ));
}

export function wordEmptyParagraphEstimatedHeight(style: RecordValue | null): number {
  const before = Math.min(4, asNumber(style?.spaceBefore) / 20);
  const after = Math.min(4, asNumber(style?.spaceAfter) / 20);
  return Math.max(2, before + after);
}

export function wordEmptyParagraphStyle(style: CSSProperties): CSSProperties {
  return {
    ...style,
    fontSize: 0,
    lineHeight: 0,
    marginBottom: Math.min(asNumber(style.marginBottom), 4),
    marginTop: Math.min(asNumber(style.marginTop), 4),
    minHeight: 2,
  };
}
