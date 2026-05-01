"use client";

import { ChangeEvent, useCallback, useRef, useState } from "react";

import { resolveApiPath } from "@/client/config/backend";
import { toErrorMessage } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

type ArtifactKind = "csv" | "tsv" | "docx" | "pptx" | "xlsx";
type ParseStage = "idle" | "initializing" | "parsing" | "ready" | "error";

type ParsedArtifact = {
  kind: "document" | "presentation" | "spreadsheet";
  sourceKind: ArtifactKind;
  proto: unknown;
};

type RecordValue = Record<string, unknown>;

type PreviewLabels = {
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

const ASSET_BASE_URL = resolveApiPath("/api/debug/office-wasm-poc/assets");
const DOTNET_RUNTIME_CONFIG = {
  mainAssemblyName: "Walnut",
  resources: {
    hash: "sha256-nthLaJwzw0DLDlI4ECh68ZKXvDRJH9Jlg9yZFd3C0+0=",
    fingerprinting: {
      "DocumentFormat.OpenXml.Framework.kpj7t3qucf.wasm": "DocumentFormat.OpenXml.Framework.wasm",
      "DocumentFormat.OpenXml.ie8f746kzt.wasm": "DocumentFormat.OpenXml.wasm",
      "Google.Protobuf.ze35jf5cfr.wasm": "Google.Protobuf.wasm",
      "System.Collections.Concurrent.ifkyiyawwo.wasm": "System.Collections.Concurrent.wasm",
      "System.Collections.NonGeneric.7lsghwy4oa.wasm": "System.Collections.NonGeneric.wasm",
      "System.Collections.Specialized.4ycmsxi9r1.wasm": "System.Collections.Specialized.wasm",
      "System.Collections.53wkt3rjnm.wasm": "System.Collections.wasm",
      "System.ComponentModel.Primitives.755z3qfw43.wasm": "System.ComponentModel.Primitives.wasm",
      "System.ComponentModel.TypeConverter.yj8s8mxecj.wasm": "System.ComponentModel.TypeConverter.wasm",
      "System.ComponentModel.5keg7c7hvo.wasm": "System.ComponentModel.wasm",
      "System.Console.wafck6z1ot.wasm": "System.Console.wasm",
      "System.Diagnostics.DiagnosticSource.qcda27aixf.wasm": "System.Diagnostics.DiagnosticSource.wasm",
      "System.IO.Compression.tcn9zdeat6.wasm": "System.IO.Compression.wasm",
      "System.IO.Packaging.ejb20qp7p2.wasm": "System.IO.Packaging.wasm",
      "System.Linq.Expressions.z7qevklcuo.wasm": "System.Linq.Expressions.wasm",
      "System.Linq.5ehom0dfm3.wasm": "System.Linq.wasm",
      "System.Memory.282wmwiloz.wasm": "System.Memory.wasm",
      "System.Net.Http.ubki69uxiv.wasm": "System.Net.Http.wasm",
      "System.Net.Primitives.6xdadyjvop.wasm": "System.Net.Primitives.wasm",
      "System.ObjectModel.t3toc9pme6.wasm": "System.ObjectModel.wasm",
      "System.Private.CoreLib.5knuccmsyn.wasm": "System.Private.CoreLib.wasm",
      "System.Private.Uri.ai39t9vkqf.wasm": "System.Private.Uri.wasm",
      "System.Private.Xml.Linq.6s0uf1018j.wasm": "System.Private.Xml.Linq.wasm",
      "System.Private.Xml.hdgz58vruv.wasm": "System.Private.Xml.wasm",
      "System.Runtime.InteropServices.JavaScript.gfj68pelgx.wasm": "System.Runtime.InteropServices.JavaScript.wasm",
      "System.Security.Cryptography.olbng0qvbw.wasm": "System.Security.Cryptography.wasm",
      "System.Text.RegularExpressions.g9hkuzbacr.wasm": "System.Text.RegularExpressions.wasm",
      "System.dqfxtvioy0.wasm": "System.wasm",
      "System.Xml.Linq.53liyo777g.wasm": "System.Xml.Linq.wasm",
      "Walnut.nvqhqmqbjk.wasm": "Walnut.wasm",
      "dotnet.native.lo0npp77z5.js": "dotnet.native.js",
      "dotnet.native.wfd2lrj4w6.wasm": "dotnet.native.wasm",
      "dotnet.js": "dotnet.js",
      "dotnet.runtime.2hocyfcbj2.js": "dotnet.runtime.js",
    },
    coreAssembly: {
      "System.Private.CoreLib.5knuccmsyn.wasm":
        "sha256-xW5hrHA6AE48YHx+xPosdCWVIRPpe6JZCzvZUjyVn0M=",
      "System.Runtime.InteropServices.JavaScript.gfj68pelgx.wasm":
        "sha256-JCwSVA4cvnawhikg5QrH9v9qgJy9JhQ54c9ozskI1TU=",
    },
    assembly: {
      "DocumentFormat.OpenXml.Framework.kpj7t3qucf.wasm":
        "sha256-iKgX/t4htZRMlxVH9LwO6f/Ec3KPIVp2h2cIwo98rPA=",
      "DocumentFormat.OpenXml.ie8f746kzt.wasm":
        "sha256-Si+3lLPkTJZezvnYEt8jyLDojLOdVNVVRj41Ug/rvt4=",
      "Google.Protobuf.ze35jf5cfr.wasm":
        "sha256-i38brCJSYmpsUEG3n34uEuDFfLxkrlECq4wIOMlpBiY=",
      "System.Collections.Concurrent.ifkyiyawwo.wasm":
        "sha256-7lW+NLtsu49ATDYcB5SlUff5W7owPd+P6+BpkhLdSfs=",
      "System.Collections.NonGeneric.7lsghwy4oa.wasm":
        "sha256-u0XN4uYg5bc7p87OH/yoU0PnSlyfk1fYALMrZUkQo+w=",
      "System.Collections.Specialized.4ycmsxi9r1.wasm":
        "sha256-DAtbHJ2BaNNEYcCPAqPqFGmTMvoepPTF5xFhr8pytAA=",
      "System.Collections.53wkt3rjnm.wasm":
        "sha256-j4f129c/j4DookwnUWH6hTwYbQp33vNTdcjMRKPcANM=",
      "System.ComponentModel.Primitives.755z3qfw43.wasm":
        "sha256-NYBL6jJ7FS/K4pf72MDV62DBx0F7bt/0LE3L4fs3QJ8=",
      "System.ComponentModel.TypeConverter.yj8s8mxecj.wasm":
        "sha256-sjU0251V9fjU4kTZUYqV6h7N8g1Vj4qdyDaNKhFUkAk=",
      "System.ComponentModel.5keg7c7hvo.wasm":
        "sha256-tXQpmMVs+QJaYRESF8C5FLZYQNMLjOvszNCASM8imFM=",
      "System.Console.wafck6z1ot.wasm":
        "sha256-eLTiR09j8C03D1vA21KQQHHbpnmxfQ5l25AIzcJH680=",
      "System.Diagnostics.DiagnosticSource.qcda27aixf.wasm":
        "sha256-GkDZe9IrZyEIoePwXI5DL632BPCuBwbTIxF306/vzAM=",
      "System.IO.Compression.tcn9zdeat6.wasm":
        "sha256-g2rHNXKLuGvHVgE4Miz9ZYq5M825yEc1EUa3gzX6/Mw=",
      "System.IO.Packaging.ejb20qp7p2.wasm":
        "sha256-FmH8uRx5Ltr4iImKrvn8KFhC0qZ863olZEkXoHrw1Ak=",
      "System.Linq.Expressions.z7qevklcuo.wasm":
        "sha256-PxvPQLhX8OxkSQT4SLJePkuPteXKOnWJ7DZgiSxDCbs=",
      "System.Linq.5ehom0dfm3.wasm":
        "sha256-DdSA4XcQzPM5YhXdWmWZ2RAC7F7OdAmokuew4U7ktC4=",
      "System.Memory.282wmwiloz.wasm":
        "sha256-QomNkxE9OswXieyOLECxAN87ums92aVNNhOyhXEFyzM=",
      "System.Net.Http.ubki69uxiv.wasm":
        "sha256-auH+MfKSO8hjI0mrD5PXYyiuCdw7XFbdLp45+mo9t1s=",
      "System.Net.Primitives.6xdadyjvop.wasm":
        "sha256-+kmyKoOgAl1MlZc+bDX6/ZO1+B+ZPkF8nEdNCX5YJMg=",
      "System.ObjectModel.t3toc9pme6.wasm":
        "sha256-WQn9YQxastp2Skfly9YmBm55DaBYUN6MXhUHHTnHAww=",
      "System.Private.Uri.ai39t9vkqf.wasm":
        "sha256-AmvTJBkUj5FZt3drMntF5sBVvXwFE3OGU3y56KNc63c=",
      "System.Private.Xml.Linq.6s0uf1018j.wasm":
        "sha256-ik0dKEgLPdS3E6/IdOb9zl2iXp0DEvkag+wOpX6ciPo=",
      "System.Private.Xml.hdgz58vruv.wasm":
        "sha256-W82TrVHm5COWSgDZGupAbx68jTqJY10Itb0bylnp2aU=",
      "System.Security.Cryptography.olbng0qvbw.wasm":
        "sha256-hPXoWj3KRSHLC8vFk69ZEgRp8kh1HJKw/+pnu3xEs88=",
      "System.Text.RegularExpressions.g9hkuzbacr.wasm":
        "sha256-ZA7ApPg7tHJDQMQk5KUfTYIuCngfBuYyD+ycRtY9nck=",
      "System.dqfxtvioy0.wasm":
        "sha256-5QZAjy4n7513fYxCXSXTsAkUmRsLiZ8m621Ot4k7FB0=",
      "System.Xml.Linq.53liyo777g.wasm":
        "sha256-v9JHsJbBkO3lHVBoE7qJxiS0WfQzkxg+A8GpOWF+ls8=",
      "Walnut.nvqhqmqbjk.wasm":
        "sha256-U3TIKatBL+JhvqCtgaTsjuN+tbqQkDzjpxIadWA42Zo=",
    },
    jsModuleNative: {
      "dotnet.native.lo0npp77z5.js":
        "sha256-NVCP8hmLbuBAcDPJqCIgsE34NzdDSrQ9g816vUcMga4=",
    },
    jsModuleRuntime: {
      "dotnet.runtime.2hocyfcbj2.js":
        "sha256-5oRcSUQSLbUYyqP9jPgwB6domrDHYrvLX+53QxY+0y48=",
    },
    wasmNative: {
      "dotnet.native.wfd2lrj4w6.wasm":
        "sha256-dJ41jB4EfM+g1yh0aKIDYjjCxeaUDqKqaMIh2L4ScTE=",
    },
  },
  debugLevel: 0,
  linkerEnabled: true,
  globalizationMode: "invariant",
};

const WORKBOOK_MODULE = `${ASSET_BASE_URL}/workbook-CJ5j_l1F.js`;
const DOCUMENT_MODULE = `${ASSET_BASE_URL}/document-BOb5tmtr.js`;
const PRESENTATION_MODULE = `${ASSET_BASE_URL}/presentation-DFBGauUV.js`;
const SPREADSHEET_MODULE = `${ASSET_BASE_URL}/spreadsheet-Bpv2Ypgr.js`;
const DOTNET_JS = `${ASSET_BASE_URL}/dotnet.js`;

let cachedWalnutRuntime: Promise<WalnutReader> | null = null;

async function getWalnutReader(): Promise<WalnutReader> {
  if (!cachedWalnutRuntime) {
    cachedWalnutRuntime = (async () => {
      const dotnet = await import(
        /* webpackIgnore: true */ `${DOTNET_JS}?v=walnut-runtime`
      );
      const runtime = await dotnet.dotnet
        .withConfig({
          ...DOTNET_RUNTIME_CONFIG,
          resources: {
            ...DOTNET_RUNTIME_CONFIG.resources,
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
  return { kind: "spreadsheet", sourceKind: file.name.endsWith(".tsv") ? "tsv" : "csv", proto: workbook.toProto() };
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
    return { kind: "document", sourceKind: "docx", proto };
  }

  if (kind === "pptx") {
    const { Presentation } = (await import(
      /* webpackIgnore: true */ `${PRESENTATION_MODULE}?v=presentation`
    )) as { Presentation: { decode: (value: unknown) => unknown } };
    const proto = Presentation.decode(walnut.PptxReader.ExtractSlidesProto(bytes, false));
    return { kind: "presentation", sourceKind: "pptx", proto };
  }

  const { Workbook } = (await import(
    /* webpackIgnore: true */ `${SPREADSHEET_MODULE}?v=spreadsheet`
  )) as { Workbook: { decode: (value: unknown) => unknown } };
  const proto = Workbook.decode(walnut.XlsxReader.ExtractXlsxProto(bytes, false));
  return { kind: "spreadsheet", sourceKind: "xlsx", proto };
}

function buildSummary(parsed: ParsedArtifact | null): string[] {
  if (!parsed || typeof parsed.proto !== "object" || parsed.proto === null) {
    return [];
  }

  return Object.keys(parsed.proto as Record<string, unknown>).slice(0, 20);
}

function truncateJson(rawJson: string): string {
  const maxLength = 50_000;
  if (rawJson.length <= maxLength) return rawJson;
  return `${rawJson.slice(0, maxLength)}\n... (truncated)`;
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null ? (value as RecordValue) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function colorToCss(value: unknown): string | undefined {
  const color = asRecord(value);
  const raw = asString(color?.value);
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`;
  const lastColor = asString(color?.lastColor);
  if (/^[0-9a-f]{6}$/i.test(lastColor)) return `#${lastColor}`;
  return undefined;
}

function fillToCss(fill: unknown): string | undefined {
  const fillRecord = asRecord(fill);
  if (fillRecord == null || asNumber(fillRecord.type) === 0) return undefined;
  return colorToCss(fillRecord.color);
}

function paragraphText(paragraph: unknown): string {
  const runs = asArray(asRecord(paragraph)?.runs);
  return runs.map((run) => asString(asRecord(run)?.text)).join("");
}

function collectTextBlocks(value: unknown, limit = 80): string[] {
  const blocks: string[] = [];
  const seen = new WeakSet<object>();

  function visit(node: unknown) {
    if (blocks.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = asRecord(node);
    if (record == null || seen.has(record)) return;
    seen.add(record);

    const paragraphs = asArray(record.paragraphs);
    if (paragraphs.length > 0) {
      const text = paragraphs.map(paragraphText).filter(Boolean).join("\n");
      if (text.trim()) blocks.push(text);
    }

    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }

  visit(value);
  return blocks;
}

function columnIndexFromAddress(address: string): number {
  const match = address.match(/^[A-Z]+/i);
  if (!match) return 0;

  let index = 0;
  for (const char of match[0].toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }

  return Math.max(0, index - 1);
}

function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

function cellText(cell: unknown): string {
  const record = asRecord(cell);
  if (record == null) return "";

  const value = asString(record.value);
  if (value) return value;

  const paragraphs = asArray(record.paragraphs);
  return paragraphs.map(paragraphText).filter(Boolean).join("\n");
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

function SpreadsheetPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const sheets = asArray(asRecord(proto)?.sheets).map(asRecord).filter((sheet): sheet is RecordValue => sheet != null);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const activeSheet = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];

  const rows = asArray(activeSheet?.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  let maxColumn = 0;
  const rowsByIndex = new Map<number, Map<number, string>>();

  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = new Map<number, string>();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      const address = asString(cellRecord?.address);
      const columnIndex = columnIndexFromAddress(address);
      maxColumn = Math.max(maxColumn, columnIndex);
      cells.set(columnIndex, cellText(cell));
    }
    rowsByIndex.set(rowIndex, cells);
  }

  const maxRow = Math.min(Math.max(...rowsByIndex.keys(), 1), 40);
  const columnCount = Math.min(Math.max(maxColumn + 1, 6), 18);

  if (sheets.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSheets}</p>;
  }

  return (
    <div data-testid="spreadsheet-preview" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {sheets.map((sheet, index) => (
          <button
            key={`${asString(sheet.sheetId)}-${index}`}
            onClick={() => setActiveSheetIndex(index)}
            style={{
              border: "1px solid #cbd5e1",
              background: index === activeSheetIndex ? "#0f172a" : "#ffffff",
              color: index === activeSheetIndex ? "#ffffff" : "#0f172a",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: "pointer",
            }}
            type="button"
          >
            {asString(sheet.name) || `${labels.sheet} ${index + 1}`}
          </button>
        ))}
      </div>
      <div style={{ color: "#64748b", fontSize: 13 }}>{labels.showingFirstRows}</div>
      <div style={{ border: "1px solid #cbd5e1", borderRadius: 8, overflow: "auto", maxHeight: 520 }}>
        <table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={sheetHeaderStyle} />
              {Array.from({ length: columnCount }, (_, index) => (
                <th key={index} style={sheetHeaderStyle}>{columnLabel(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRow }, (_, rowOffset) => {
              const rowIndex = rowOffset + 1;
              const row = rowsByIndex.get(rowIndex);
              return (
                <tr key={rowIndex}>
                  <th style={sheetHeaderStyle}>{rowIndex}</th>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td key={columnIndex} style={sheetCellStyle}>
                      {row?.get(columnIndex) ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const sheetHeaderStyle = {
  background: "#f8fafc",
  borderBottom: "1px solid #cbd5e1",
  borderRight: "1px solid #e2e8f0",
  color: "#475569",
  minWidth: 88,
  padding: "7px 9px",
  position: "sticky" as const,
  top: 0,
};

const sheetCellStyle = {
  borderBottom: "1px solid #e2e8f0",
  borderRight: "1px solid #e2e8f0",
  color: "#0f172a",
  minWidth: 88,
  padding: "7px 9px",
  verticalAlign: "top" as const,
  whiteSpace: "pre-wrap" as const,
};

function PresentationPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const slides = asArray(asRecord(proto)?.slides).map(asRecord).filter((slide): slide is RecordValue => slide != null);

  if (slides.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noSlides}</p>;
  }

  return (
    <div data-testid="presentation-preview" style={{ display: "grid", gap: 18 }}>
      {slides.slice(0, 8).map((slide, index) => (
        <SlideCanvas key={`${asString(slide.id)}-${index}`} labels={labels} slide={slide} slideIndex={index} />
      ))}
    </div>
  );
}

function SlideCanvas({
  labels,
  slide,
  slideIndex,
}: {
  labels: PreviewLabels;
  slide: RecordValue;
  slideIndex: number;
}) {
  const elements = asArray(slide.elements).map(asRecord).filter((element): element is RecordValue => element != null);
  const bounds = elements.reduce<{ width: number; height: number }>(
    (acc, element) => {
      const bbox = asRecord(element.bbox);
      return {
        width: Math.max(acc.width, asNumber(bbox?.xEmu) + asNumber(bbox?.widthEmu)),
        height: Math.max(acc.height, asNumber(bbox?.yEmu) + asNumber(bbox?.heightEmu)),
      };
    },
    { width: 12_192_000, height: 6_858_000 },
  );
  const textRunCount = elements.reduce((count, element) => {
    return count + collectTextBlocks(element, 20).length;
  }, 0);

  return (
    <article style={{ display: "grid", gap: 8 }}>
      <div style={{ color: "#475569", display: "flex", gap: 12, fontSize: 13 }}>
        <strong>{labels.slide} {asNumber(slide.index, slideIndex + 1)}</strong>
        <span>{elements.length} {labels.shapes}</span>
        <span>{textRunCount} {labels.textRuns}</span>
      </div>
      <div
        style={{
          aspectRatio: `${bounds.width} / ${bounds.height}`,
          background: "#ffffff",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          boxShadow: "0 8px 22px rgba(15, 23, 42, 0.12)",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        {elements.map((element, index) => (
          <SlideElement
            bounds={bounds}
            element={element}
            key={`${asString(element.id)}-${index}`}
          />
        ))}
      </div>
    </article>
  );
}

function SlideElement({
  bounds,
  element,
}: {
  bounds: { width: number; height: number };
  element: RecordValue;
}) {
  const bbox = asRecord(element.bbox);
  const shape = asRecord(element.shape);
  const text = asArray(element.paragraphs).map(paragraphText).filter(Boolean).join("\n");
  const firstRun = asRecord(asArray(asRecord(asArray(element.paragraphs)[0])?.runs)[0]);
  const textStyle = asRecord(firstRun?.textStyle);
  const fill = fillToCss(shape?.fill);
  const textColor = colorToCss(asRecord(textStyle?.fill)?.color) ?? "#0f172a";
  const fontSize = Math.max(10, Math.min(44, asNumber(textStyle?.fontSize, 1200) / 100));

  return (
    <div
      style={{
        alignItems: "center",
        background: text ? "transparent" : fill,
        borderRadius: shape?.geometry === 89 ? "999px" : 3,
        color: textColor,
        display: "flex",
        fontSize,
        fontWeight: textStyle?.bold === true ? 700 : 400,
        height: `${(asNumber(bbox?.heightEmu) / bounds.height) * 100}%`,
        left: `${(asNumber(bbox?.xEmu) / bounds.width) * 100}%`,
        lineHeight: 1.15,
        overflow: "hidden",
        padding: text ? "0.15em" : 0,
        position: "absolute",
        top: `${(asNumber(bbox?.yEmu) / bounds.height) * 100}%`,
        transform: `rotate(${asNumber(bbox?.rotation) / 60000}deg)`,
        whiteSpace: "pre-wrap",
        width: `${(asNumber(bbox?.widthEmu) / bounds.width) * 100}%`,
      }}
      title={asString(element.name)}
    >
      {text}
    </div>
  );
}

function DocumentPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const blocks = collectTextBlocks(proto, 120);

  if (blocks.length === 0) {
    return <p style={{ color: "#64748b" }}>{labels.noDocumentBlocks}</p>;
  }

  return (
    <div data-testid="document-preview" style={{ display: "grid", gap: 10 }}>
      {blocks.map((block, index) => (
        <p
          key={`${block.slice(0, 24)}-${index}`}
          style={{
            borderBottom: "1px solid #e2e8f0",
            color: "#0f172a",
            lineHeight: 1.6,
            margin: 0,
            paddingBottom: 10,
            whiteSpace: "pre-wrap",
          }}
        >
          {block}
        </p>
      ))}
    </div>
  );
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
  const [status, setStatus] = useState<ParseStage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [lastBytes, setLastBytes] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    [reset, t.debug.unsupportedOfficeFormat],
  );

  const preview =
    artifact == null ? "" : truncateJson(JSON.stringify(artifact.proto, null, 2));
  const summary = buildSummary(artifact);
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
    <main style={{ padding: 24, fontFamily: "Arial, sans-serif", maxWidth: 1080 }}>
      <h1>{t.debug.officeWasmPocTitle}</h1>
      <p>{t.debug.officeWasmPocDescription}</p>
      <label style={{ display: "grid", gap: 8, width: "100%", maxWidth: 360 }}>
        <span>{t.debug.officeWasmPocSelectFile}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.docx,.pptx,.xlsx"
          onChange={parseFile}
          disabled={isBusy}
        />
      </label>

      <section style={{ marginTop: 16 }}>
        <div><strong>{t.debug.officeWasmPocStatus}</strong> {statusLabel(t, status)}</div>
        {selectedFileName ? (
          <div>
            {t.debug.officeWasmPocFile} <code>{selectedFileName}</code>
            {lastBytes !== null ? <> ({lastBytes} {t.debug.officeWasmPocBytes})</> : null}
          </div>
        ) : null}
        {errorMessage ? <p style={{ color: "#b91c1c" }}>{errorMessage}</p> : null}
      </section>

      <section style={{ marginTop: 16 }}>
        <h2>{t.debug.officeWasmPocParsedOutput}</h2>
        {artifact ? (
          <div>
            <p>
              {t.debug.officeWasmPocArtifactType}
              <code>{artifact.kind}</code> / <code>{artifact.sourceKind}</code>
            </p>
            {summary.length > 0 ? (
              <p>
                {t.debug.officeWasmPocTopFields}
                <code>{summary.join(", ")}</code>
              </p>
            ) : null}
            <section data-testid="office-preview" style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <h3 style={{ margin: 0 }}>{labels.visualPreview}</h3>
              <OfficePreview artifact={artifact} labels={labels} />
            </section>
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
