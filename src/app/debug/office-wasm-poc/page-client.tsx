"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import { resolveApiPath } from "@/client/config/backend";
import { decodeRoutaOfficeArtifact } from "@/client/office-document-viewer/protocol/office-artifact-protobuf";
import type {
  OfficeWasmArtifactKind,
  RoutaOfficeArtifact,
  RoutaOfficeCell,
  RoutaOfficeSheet,
  RoutaOfficeSlide,
} from "@/client/office-document-viewer/protocol/office-artifact-types";
import {
  extractOfficeArtifactProto,
  loadRoutaOfficeWasmReader,
} from "@/client/office-document-viewer/protocol/routa-office-wasm-reader";
import { toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

import {
  OFFICE_WASM_ASSET_ROUTE,
  OFFICE_WASM_DOTNET_RUNTIME_CONFIG,
  OFFICE_WASM_READER_MODULES,
} from "./office-wasm-config";
import { DocumentPreview } from "./document-preview";
import { type PreviewLabels, type RecordValue, rowIndexFromAddress } from "./office-preview-utils";
import { PresentationPreview } from "./presentation-preview";
import { SpreadsheetPreview } from "./spreadsheet-preview";

type ArtifactKind = "csv" | "tsv" | "docx" | "pptx" | "xlsx";
type ParseStage = "idle" | "initializing" | "parsing" | "ready" | "error";
type ReaderMode = "walnut" | "routa";

type GeneratedWasmSummary = {
  chartCount: number;
  elementCount?: number;
  imageCount: number;
  metadata: Record<string, string>;
  protocol?: string;
  sheetCount: number;
  slideCount: number;
  sourceKind: string;
  tableCount: number;
  textBlockCount: number;
  title: string;
  wasmProtoByteLength: number;
  wasmProtoSha256: string;
};

type ParsedArtifact = {
  kind: "document" | "presentation" | "spreadsheet";
  generatedSummary?: GeneratedWasmSummary;
  rawProto?: unknown;
  readerMode: ReaderMode;
  sourceKind: ArtifactKind;
  proto: unknown;
};

type WalnutReader = {
  DocxReader: {
    ExtractDocxProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
  PptxReader: {
    ExtractSlidesProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
  XlsxReader: {
    ExtractXlsxProto: (bytes: Uint8Array, ignoreErrors: boolean) => unknown;
  };
};

const ASSET_BASE_URL = resolveApiPath(OFFICE_WASM_ASSET_ROUTE);
const WORKBOOK_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.workbook}`;
const DOCUMENT_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.document}`;
const PRESENTATION_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.presentation}`;
const SPREADSHEET_MODULE = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.spreadsheet}`;
const DOTNET_JS = `${ASSET_BASE_URL}/${OFFICE_WASM_READER_MODULES.dotnet}`;

let cachedWalnutRuntime: Promise<WalnutReader> | null = null;

function initialReaderMode(): ReaderMode {
  if (typeof window === "undefined") return "routa";
  const value = new URLSearchParams(window.location.search).get("reader");
  return value === "walnut" ? "walnut" : "routa";
}

async function getWalnutReader(): Promise<WalnutReader> {
  if (!cachedWalnutRuntime) {
    cachedWalnutRuntime = (async () => {
      const dotnet = await import(
        /* webpackIgnore: true */ `${DOTNET_JS}?v=walnut-runtime`
      );
      const runtime = await dotnet.dotnet
        .withConfig({
          ...OFFICE_WASM_DOTNET_RUNTIME_CONFIG,
          resources: {
            ...OFFICE_WASM_DOTNET_RUNTIME_CONFIG.resources,
          },
        })
        .withResourceLoader((resourceType: string, _name: string, defaultUri: string, integrity: string) => {
          if (resourceType === "dotnetjs") {
            return defaultUri;
          }

          const url = new URL(defaultUri, window.location.href);
          if (url.origin === window.location.origin) {
            return url.href;
          }

          return fetch(url.href, { credentials: "omit", integrity });
        })
        .create();

      return runtime.getAssemblyExports("Walnut") as Promise<WalnutReader>;
    })().catch((error: unknown) => {
      cachedWalnutRuntime = null;
      throw new Error(`Walnut runtime init failed: ${toErrorMessage(error)}`);
    });
  }

  return cachedWalnutRuntime;
}

function detectFileKind(fileName: string): ArtifactKind | null {
  const extension = fileName.trim().toLowerCase().split(".").pop();
  if (extension === "csv") return "csv";
  if (extension === "tsv") return "tsv";
  if (extension === "docx") return "docx";
  if (extension === "pptx") return "pptx";
  if (extension === "xlsx") return "xlsx";
  return null;
}

async function parseSpreadsheetFromCsv(file: File, separator?: string): Promise<ParsedArtifact> {
  const { Workbook } = (await import(
    /* webpackIgnore: true */ `${WORKBOOK_MODULE}?v=workbook`
  )) as {
    Workbook: {
      fromCSV: (text: string, options?: { separator?: string }) => {
        toProto: () => unknown;
      };
    };
  };
  const fileBytes = await file.arrayBuffer();
  const asText = new TextDecoder().decode(fileBytes);
  const workbook = await Workbook.fromCSV(asText, separator ? { separator } : undefined);
  return {
    kind: "spreadsheet",
    proto: workbook.toProto(),
    readerMode: "walnut",
    sourceKind: file.name.endsWith(".tsv") ? "tsv" : "csv",
  };
}

async function parseDocument(file: File, kind: "docx" | "pptx" | "xlsx"): Promise<ParsedArtifact> {
  const walnut = await getWalnutReader();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  if (kind === "docx") {
    const { Document } = (await import(
      /* webpackIgnore: true */ `${DOCUMENT_MODULE}?v=document`
    )) as { Document: { decode: (value: unknown) => unknown } };
    const proto = Document.decode(walnut.DocxReader.ExtractDocxProto(bytes, false));
    return { kind: "document", proto, readerMode: "walnut", sourceKind: "docx" };
  }

  if (kind === "pptx") {
    const { Presentation } = (await import(
      /* webpackIgnore: true */ `${PRESENTATION_MODULE}?v=presentation`
    )) as { Presentation: { decode: (value: unknown) => unknown } };
    const proto = Presentation.decode(walnut.PptxReader.ExtractSlidesProto(bytes, false));
    return { kind: "presentation", proto, readerMode: "walnut", sourceKind: "pptx" };
  }

  const { Workbook } = (await import(
    /* webpackIgnore: true */ `${SPREADSHEET_MODULE}?v=spreadsheet`
  )) as { Workbook: { decode: (value: unknown) => unknown } };
  const proto = Workbook.decode(walnut.XlsxReader.ExtractXlsxProto(bytes, false));
  return { kind: "spreadsheet", proto, readerMode: "walnut", sourceKind: "xlsx" };
}

async function parseDocumentWithGeneratedReader(file: File, kind: OfficeWasmArtifactKind): Promise<ParsedArtifact> {
  const reader = await loadRoutaOfficeWasmReader();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const protoBytes = extractOfficeArtifactProto(reader, bytes, kind, false);

  if (kind === "pptx") {
    const proto = await decodePresentationProto(protoBytes);
    return {
      generatedSummary: await summarizeGeneratedPresentationProto(proto, protoBytes),
      kind: "presentation",
      proto,
      rawProto: proto,
      readerMode: "routa",
      sourceKind: kind,
    };
  }

  const artifact = decodeRoutaOfficeArtifact(protoBytes);

  return {
    generatedSummary: await summarizeGeneratedWasmArtifact(artifact, protoBytes),
    kind: kind === "xlsx" ? "spreadsheet" : "document",
    proto: routaArtifactToPreviewProto(artifact, kind, file.name),
    rawProto: artifact,
    readerMode: "routa",
    sourceKind: kind,
  };
}

async function decodePresentationProto(protoBytes: Uint8Array): Promise<unknown> {
  const { Presentation } = (await import(
    /* webpackIgnore: true */ `${PRESENTATION_MODULE}?v=generated-presentation`
  )) as { Presentation: { decode: (value: unknown) => unknown } };
  return Presentation.decode(protoBytes);
}

function routaArtifactToPreviewProto(artifact: RoutaOfficeArtifact, kind: OfficeWasmArtifactKind, sourceName = ""): unknown {
  if (kind === "xlsx") {
    return {
      charts: artifact.charts,
      diagnostics: artifact.diagnostics,
      images: artifact.images,
      metadata: artifact.metadata,
      shapes: artifact.shapes,
      sheets: artifact.sheets.map(routaSheetToPreviewSheet),
      styles: routaStylesToPreviewStyles(artifact),
      tables: artifact.tables,
      title: artifact.title,
      sourceName,
    };
  }

  if (kind === "pptx") {
    return {
      diagnostics: artifact.diagnostics,
      images: artifact.images,
      metadata: artifact.metadata,
      slides: artifact.slides.map(routaSlideToPreviewSlide),
      tables: artifact.tables,
      title: artifact.title,
    };
  }

  return {
    diagnostics: artifact.diagnostics,
    elements: [
      ...artifact.textBlocks.map((block) => ({
        id: block.path,
        paragraphs: [{ id: block.path, runs: [{ id: block.path, text: block.text }] }],
      })),
      ...artifact.tables.map((table) => ({
        id: table.path,
        table: {
          rows: table.rows.map((row, rowIndex) => ({
            cells: row.cells.map((cell, cellIndex) => ({
              id: `${table.path}.r${rowIndex}.c${cellIndex}`,
              paragraphs: [{ runs: [{ text: cell.text }] }],
            })),
          })),
        },
      })),
    ],
    images: artifact.images,
    metadata: artifact.metadata,
    title: artifact.title,
  };
}

function routaSheetToPreviewSheet(sheet: RoutaOfficeSheet): RecordValue {
  return {
    conditionalFormats: sheet.conditionalFormats,
    columns: sheet.columns,
    defaultColWidth: sheet.defaultColWidth || 10,
    defaultRowHeight: sheet.defaultRowHeight,
    mergedCells: sheet.mergedRanges.map((range) => ({ reference: range.reference })),
    name: sheet.name,
    rows: sheet.rows.map((row, rowIndex) => ({
      cells: row.cells.map(routaCellToPreviewCell),
      height: row.height,
      index: row.index || rowIndexFromAddress(row.cells[0]?.address ?? "") || rowIndex + 1,
    })),
    tables: sheet.tables,
  };
}

function routaCellToPreviewCell(cell: RoutaOfficeCell): RecordValue {
  return {
    address: cell.address,
    dataType: cell.dataType,
    formula: cell.formula,
    hasValue: cell.hasValue,
    styleIndex: cell.styleIndex,
    value: cell.text,
  };
}

function routaColorToPreviewColor(color: string): RecordValue | undefined {
  return color ? { value: color } : undefined;
}

function routaStylesToPreviewStyles(artifact: RoutaOfficeArtifact): RecordValue {
  return {
    borders: artifact.styles.borders.map((border) => ({
      bottom: { color: routaColorToPreviewColor(border.bottomColor) },
    })),
    cellXfs: artifact.styles.cellXfs.map((format) => ({
      alignment: {
        horizontal: format.horizontalAlignment,
        vertical: format.verticalAlignment,
      },
      borderId: format.borderId,
      fillId: format.fillId,
      fontId: format.fontId,
      horizontalAlignment: format.horizontalAlignment,
      numFmtId: format.numFmtId,
      verticalAlignment: format.verticalAlignment,
    })),
    fills: artifact.styles.fills.map((fill) => ({
      color: routaColorToPreviewColor(fill.color),
      pattern: {
        backgroundColor: routaColorToPreviewColor(fill.color),
        foregroundColor: routaColorToPreviewColor(fill.color),
      },
    })),
    fonts: artifact.styles.fonts.map((font) => ({
      bold: font.bold,
      color: routaColorToPreviewColor(font.color),
      fontSize: font.fontSize,
      italic: font.italic,
      typeface: font.typeface,
    })),
    numberFormats: artifact.styles.numberFormats.map((format) => ({
      formatCode: format.formatCode,
      id: format.id,
    })),
  };
}

function routaSlideToPreviewSlide(slide: RoutaOfficeSlide): RecordValue {
  return {
    elements: slide.textBlocks.map((block, index) => ({
      bbox: {
        heightEmu: index === 0 ? 520_000 : 380_000,
        widthEmu: 10_700_000,
        xEmu: 620_000,
        yEmu: 520_000 + index * 410_000,
      },
      id: block.path,
      name: block.path,
      paragraphs: [
        {
          id: block.path,
          runs: [
            {
              id: block.path,
              text: block.text,
              textStyle: {
                bold: index === 0,
                fontSize: index === 0 ? 2200 : 1250,
              },
            },
          ],
        },
      ],
    })),
    index: slide.index,
    title: slide.title,
  };
}

async function summarizeGeneratedWasmArtifact(
  artifact: RoutaOfficeArtifact,
  protoBytes: Uint8Array,
): Promise<GeneratedWasmSummary> {
  return {
    chartCount: artifact.charts.length,
    imageCount: artifact.images.length,
    metadata: artifact.metadata,
    sheetCount: artifact.sheets.length,
    slideCount: artifact.slides.length,
    sourceKind: artifact.sourceKind,
    tableCount: artifact.tables.length,
    textBlockCount: artifact.textBlocks.length,
    title: artifact.title,
    wasmProtoByteLength: protoBytes.length,
    wasmProtoSha256: await sha256Hex(protoBytes),
  };
}

async function summarizeGeneratedPresentationProto(
  proto: unknown,
  protoBytes: Uint8Array,
): Promise<GeneratedWasmSummary> {
  const root = proto && typeof proto === "object" ? proto as Record<string, unknown> : {};
  const slides = Array.isArray(root.slides) ? root.slides : [];
  const elementCount = slides.reduce((count, slide) => {
    if (slide == null || typeof slide !== "object") return count;
    const elements = (slide as Record<string, unknown>).elements;
    return count + (Array.isArray(elements) ? elements.length : 0);
  }, 0);

  return {
    chartCount: Array.isArray(root.charts) ? root.charts.length : 0,
    elementCount,
    imageCount: Array.isArray(root.images) ? root.images.length : 0,
    metadata: {},
    protocol: "oaiproto.coworker.presentation.Presentation",
    sheetCount: 0,
    slideCount: slides.length,
    sourceKind: "pptx",
    tableCount: 0,
    textBlockCount: 0,
    title: "",
    wasmProtoByteLength: protoBytes.length,
    wasmProtoSha256: await sha256Hex(protoBytes),
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const payload = new Uint8Array(bytes.byteLength);
  payload.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function truncateJson(rawJson: string): string {
  const maxLength = 50_000;
  if (rawJson.length <= maxLength) return rawJson;
  return `${rawJson.slice(0, maxLength)}\n... (truncated)`;
}

function OfficePreview({
  artifact,
  labels,
}: {
  artifact: ParsedArtifact;
  labels: PreviewLabels;
}) {
  if (artifact.kind === "spreadsheet") {
    return <SpreadsheetPreview labels={labels} proto={artifact.proto} />;
  }

  if (artifact.kind === "presentation") {
    return <PresentationPreview labels={labels} proto={artifact.proto} />;
  }

  return <DocumentPreview labels={labels} proto={artifact.proto} />;
}

function statusLabel(t: ReturnType<typeof useTranslation>["t"], status: ParseStage): string {
  switch (status) {
    case "idle":
      return t.debug.officeWasmPocStatusIdle;
    case "initializing":
      return t.debug.officeWasmPocStatusInitializing;
    case "parsing":
      return t.debug.officeWasmPocStatusParsing;
    case "ready":
      return t.debug.officeWasmPocStatusReady;
    case "error":
      return t.debug.officeWasmPocStatusError;
  }
}

export function OfficeWasmPocPageClient() {
  const { t } = useTranslation();
  const [selectedFileName, setSelectedFileName] = useState("");
  const [artifact, setArtifact] = useState<ParsedArtifact | null>(null);
  const [readerMode, setReaderMode] = useState<ReaderMode>(initialReaderMode);
  const [status, setStatus] = useState<ParseStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastBytes, setLastBytes] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setReaderMode(initialReaderMode());
  }, []);

  const reset = useCallback(() => {
    setSelectedFileName("");
    setArtifact(null);
    setErrorMessage(null);
    setStatus("idle");
    setLastBytes(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const changeReaderMode = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextMode: ReaderMode = event.target.value === "routa" ? "routa" : "walnut";
      setReaderMode(nextMode);
      setArtifact(null);
      setErrorMessage(null);
      setStatus("idle");
      setLastBytes(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      const url = new URL(window.location.href);
      if (nextMode === "routa") {
        url.searchParams.set("reader", "routa");
      } else {
        url.searchParams.set("reader", "walnut");
      }
      window.history.replaceState(null, "", url);
    },
    [],
  );

  const parseFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selected = event.target.files?.[0];
      if (!selected) {
        reset();
        return;
      }

      const kind = detectFileKind(selected.name);
      if (!kind) {
        reset();
        setErrorMessage(t.debug.unsupportedOfficeFormat);
        return;
      }

      setSelectedFileName(selected.name);
      setStatus("initializing");
      setErrorMessage(null);
      setIsBusy(true);
      setArtifact(null);

      try {
        setStatus("parsing");
        let parsed: ParsedArtifact;

        if (kind === "csv" || kind === "tsv") {
          parsed = await parseSpreadsheetFromCsv(selected, kind === "tsv" ? "\t" : undefined);
        } else if (readerMode === "routa") {
          parsed = await parseDocumentWithGeneratedReader(selected, kind);
        } else {
          parsed = await parseDocument(selected, kind);
        }

        setArtifact(parsed);
        setLastBytes(selected.size);
        setStatus("ready");
      } catch (error: unknown) {
        setStatus("error");
        setErrorMessage(toErrorMessage(error));
      } finally {
        setIsBusy(false);
      }
    },
    [readerMode, reset, t.debug.unsupportedOfficeFormat],
  );

  const preview =
    artifact == null ? "" : truncateJson(JSON.stringify(artifact.rawProto ?? artifact.proto, null, 2));
  const labels: PreviewLabels = {
    visualPreview: t.debug.officeWasmPocVisualPreview,
    rawJson: t.debug.officeWasmPocRawJson,
    sheet: t.debug.officeWasmPocSheet,
    slide: t.debug.officeWasmPocSlide,
    noSheets: t.debug.officeWasmPocNoSheets,
    noSlides: t.debug.officeWasmPocNoSlides,
    noDocumentBlocks: t.debug.officeWasmPocNoDocumentBlocks,
    showingFirstRows: t.debug.officeWasmPocShowingFirstRows,
    shapes: t.debug.officeWasmPocShapes,
    textRuns: t.debug.officeWasmPocTextRuns,
  };

  return (
    <main
      style={{
        boxSizing: "border-box",
        display: "grid",
        fontFamily: "Arial, sans-serif",
        gap: 16,
        height: "100vh",
        maxWidth: "none",
        minHeight: "100vh",
        overflowY: "auto",
        padding: 24,
        width: "100%",
      }}
    >
      <header
        style={{
          alignItems: "center",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          paddingBottom: 12,
        }}
      >
        <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#475569", fontSize: 13 }}>{t.debug.officeWasmPocSelectFile}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.docx,.pptx,.xlsx"
            onChange={parseFile}
            disabled={isBusy}
          />
        </label>
        <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "#475569", fontSize: 13 }}>{t.debug.officeWasmPocReader}</span>
          <select
            data-testid="office-wasm-reader-mode"
            disabled={isBusy}
            onChange={changeReaderMode}
            value={readerMode}
          >
            <option value="walnut">{t.debug.officeWasmPocReaderWalnut}</option>
            <option value="routa">{t.debug.officeWasmPocReaderGenerated}</option>
          </select>
        </label>
        <div style={{ color: "#475569", fontSize: 13 }}>
          <strong>{t.debug.officeWasmPocStatus}</strong> {statusLabel(t, status)}
        </div>
        {selectedFileName ? (
          <div style={{ color: "#475569", fontSize: 13 }}>
            <code>{selectedFileName}</code>
            {lastBytes !== null ? <> ({lastBytes} {t.debug.officeWasmPocBytes})</> : null}
          </div>
        ) : null}
        {errorMessage ? <div style={{ color: "#b91c1c", fontSize: 13 }}>{errorMessage}</div> : null}
      </header>

      <section>
        {artifact ? (
          <div style={{ display: "grid", gap: 12 }}>
            <section data-testid="office-preview">
              <OfficePreview artifact={artifact} labels={labels} />
            </section>
            {artifact.generatedSummary ? (
              <section>
                <div style={{ color: "#475569", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  {t.debug.officeWasmPocGeneratedSummary}
                </div>
                <pre
                  data-testid="office-wasm-generated-summary"
                  style={{
                    background: "#eef6ff",
                    borderColor: "#bfdbfe",
                    borderRadius: 8,
                    borderStyle: "solid",
                    borderWidth: 1,
                    color: "#0f172a",
                    margin: 0,
                    overflow: "auto",
                    padding: 12,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(artifact.generatedSummary, null, 2)}
                </pre>
              </section>
            ) : null}
            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer" }}>{labels.rawJson}</summary>
              <pre style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "420px",
                overflow: "auto",
                background: "#0b1020",
                color: "#f8fafc",
                padding: 12,
                borderRadius: 8,
              }}>
                {preview}
              </pre>
            </details>
          </div>
        ) : (
          <p>{t.debug.officeWasmPocNoResult}</p>
        )}
      </section>
    </main>
  );
}
