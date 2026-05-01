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
  jsResourceBasePath: "",
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
        .withResourceLoader((_, name) => `${ASSET_BASE_URL}/${name}`)
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
        <div><strong>{t.debug.officeWasmPocStatus}</strong> {status}</div>
        {selectedFileName ? (
          <div>
            {t.debug.officeWasmPocFile} <code>{selectedFileName}</code>
            {lastBytes !== null ? <>（{lastBytes} bytes）</> : null}
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
          </div>
        ) : (
          <p>{t.debug.officeWasmPocNoResult}</p>
        )}
      </section>
    </main>
  );
}
