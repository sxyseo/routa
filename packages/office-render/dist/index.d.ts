import * as react_jsx_runtime from 'react/jsx-runtime';

type RecordValue = Record<string, unknown>;
type PreviewLabels = {
    closeSlideshow: string;
    hideSpeakerNotes?: string;
    nextSlide: string;
    playSlideshow: string;
    previousSlide: string;
    showSpeakerNotes?: string;
    speakerNotes?: string;
    visualPreview: string;
    rawJson: string;
    sheet: string;
    slide: string;
    noSheets: string;
    noSlides: string;
    noDocumentBlocks: string;
    showingFirstRows: string;
    shapes: string;
    textRuns: string;
};

declare function WordPreview({ labels, proto }: {
    labels: PreviewLabels;
    proto: unknown;
}): react_jsx_runtime.JSX.Element;

declare function SpreadsheetPreview({ labels, proto }: {
    labels: PreviewLabels;
    proto: unknown;
}): react_jsx_runtime.JSX.Element;

declare const PRESENTATION_HEADER_ACTIONS_ID = "office-wasm-presentation-header-actions";
declare function PresentationPreview({ labels, proto, }: {
    labels: PreviewLabels;
    proto: unknown;
}): react_jsx_runtime.JSX.Element;

export { PRESENTATION_HEADER_ACTIONS_ID, PresentationPreview, type PreviewLabels, type RecordValue, SpreadsheetPreview, WordPreview };
