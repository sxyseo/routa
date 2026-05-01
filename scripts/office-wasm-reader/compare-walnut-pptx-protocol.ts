import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import officeWasmConfig from "../../src/app/debug/office-wasm-poc/office-wasm-config";

type ReaderExports = {
  PptxReader: {
    ExtractSlidesProto: (bytes: Uint8Array, ignoreErrors: boolean) => Uint8Array | ArrayBuffer | number[];
  };
};

type DecodeRoutaOfficeArtifact = (bytes: Uint8Array) => {
  charts: unknown[];
  images: unknown[];
  metadata: Record<string, string>;
  slides: Array<{
    index: number;
    title: string;
    textBlocks: Array<{ path: string; text: string }>;
    elements?: unknown[];
  }>;
  tables: unknown[];
};

const repoRoot = process.cwd();
const assetDir = path.resolve(repoRoot, officeWasmConfig.OFFICE_WASM_TMP_ASSET_DIR);
const fixturePath = path.resolve(
  repoRoot,
  process.argv[2] ?? "tools/office-wasm-reader/fixtures/agentic_ui_proactive_agent_technical_blueprint.pptx",
);
const generatedBundleEntry = path.resolve(repoRoot, "public/office-wasm-reader/main.js");

async function main(): Promise<void> {
  assertFile(assetDir, "extracted Walnut asset directory");
  assertFile(fixturePath, "PPTX fixture");
  assertFile(generatedBundleEntry, "generated Routa office WASM bundle");

  const sourceBytes = readFileSync(fixturePath);
  const walnutProtoBytes = await extractWalnutPresentationProto(sourceBytes);
  const walnutPresentation = await decodeWalnutPresentation(walnutProtoBytes);
  const routaProtoBytes = await extractRoutaPresentationProto(sourceBytes);
  const routaArtifact = await decodeRoutaArtifact(routaProtoBytes);

  console.log(JSON.stringify({
    fixture: path.relative(repoRoot, fixturePath),
    protocolMismatch: summarizeProtocolMismatch(),
    walnut: summarizeWalnutPresentation(walnutPresentation, walnutProtoBytes),
    routa: summarizeRoutaArtifact(routaArtifact, routaProtoBytes),
  }, null, 2));
}

async function extractWalnutPresentationProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
  const dotnetModule = moduleWithExport(await import(pathToFileURL(path.join(assetDir, "dotnet.js")).href), "dotnet") as {
    dotnet: {
      withConfig: (config: unknown) => {
        withResourceLoader: (loader: (resourceType: string, name: string, defaultUri: string) => string | Uint8Array) => {
          create: () => Promise<{ getAssemblyExports: (assemblyName: string) => Promise<ReaderExports> }>;
        };
      };
    };
  };

  const runtime = await dotnetModule.dotnet
    .withConfig(officeWasmConfig.OFFICE_WASM_DOTNET_RUNTIME_CONFIG)
    .withResourceLoader((resourceType, _name, defaultUri) => {
      const fullPath = path.join(assetDir, path.basename(defaultUri));
      if (resourceType === "dotnetjs") {
        return pathToFileURL(fullPath).href;
      }

      return readFileSync(fullPath);
    })
    .create();
  const exports = await runtime.getAssemblyExports("Walnut");
  return toUint8Array(exports.PptxReader.ExtractSlidesProto(sourceBytes, false));
}

async function decodeWalnutPresentation(protoBytes: Uint8Array): Promise<Record<string, unknown>> {
  const presentationModule = moduleWithExport(await import(
    pathToFileURL(path.join(assetDir, officeWasmConfig.OFFICE_WASM_READER_MODULES.presentation)).href
  ), "Presentation") as {
    Presentation: { decode: (bytes: Uint8Array) => Record<string, unknown> };
  };

  return presentationModule.Presentation.decode(protoBytes);
}

async function extractRoutaPresentationProto(sourceBytes: Uint8Array): Promise<Uint8Array> {
  await import(pathToFileURL(generatedBundleEntry).href);
  const bridge = (globalThis as typeof globalThis & {
    RoutaOfficeWasmReader?: { exports?: ReaderExports };
  }).RoutaOfficeWasmReader;

  if (!bridge?.exports) {
    throw new Error("RoutaOfficeWasmReader exports were not initialized.");
  }

  return toUint8Array(bridge.exports.PptxReader.ExtractSlidesProto(sourceBytes, false));
}

async function decodeRoutaArtifact(protoBytes: Uint8Array): Promise<ReturnType<DecodeRoutaOfficeArtifact>> {
  const protocolModule = moduleWithExport(await import(
    "../../src/client/office-document-viewer/protocol/office-artifact-protobuf"
  ), "decodeRoutaOfficeArtifact") as {
    decodeRoutaOfficeArtifact?: DecodeRoutaOfficeArtifact;
  };

  if (!protocolModule.decodeRoutaOfficeArtifact) {
    throw new Error("Could not load decodeRoutaOfficeArtifact.");
  }

  return protocolModule.decodeRoutaOfficeArtifact(protoBytes);
}

function summarizeProtocolMismatch(): unknown {
  return {
    abiMethod: "PptxReader.ExtractSlidesProto(bytes, false)",
    walnutMessage: "oaiproto.coworker.presentation.Presentation",
    routaMessage: "routa.office.v1.OfficeArtifact",
    reason: "The WASM ABI name matches, but the protobuf message behind the returned bytes does not.",
    firstMissingRoutaFields: [
      "Presentation.theme",
      "Presentation.layouts",
      "Slide.widthEmu",
      "Slide.heightEmu",
      "Slide.background",
      "Slide.elements[].bbox",
      "Slide.elements[].type",
      "Slide.elements[].shape",
      "Slide.elements[].fill",
      "Slide.elements[].line",
      "Slide.elements[].paragraphs[].runs[].textStyle",
    ],
  };
}

function summarizeWalnutPresentation(presentation: Record<string, unknown>, protoBytes: Uint8Array): unknown {
  const slides = arrayOfRecords(presentation.slides);
  const firstSlide = slides[0] ?? {};
  return {
    protoByteLength: protoBytes.length,
    protoSha256: sha256(protoBytes),
    topLevelKeys: Object.keys(presentation),
    slideCount: slides.length,
    layoutCount: arrayOfRecords(presentation.layouts).length,
    imageCount: arrayOfRecords(presentation.images).length,
    chartCount: arrayOfRecords(presentation.charts).length,
    hasTheme: isRecord(presentation.theme),
    firstSlide: summarizeWalnutSlide(firstSlide),
  };
}

function summarizeWalnutSlide(slide: Record<string, unknown>): unknown {
  const elements = arrayOfRecords(slide.elements);
  const elementTypes = new Map<string, number>();
  for (const element of elements) {
    const type = String(element.type ?? "unset");
    elementTypes.set(type, (elementTypes.get(type) ?? 0) + 1);
  }

  return {
    keys: Object.keys(slide),
    id: slide.id,
    index: slide.index,
    widthEmu: slide.widthEmu,
    heightEmu: slide.heightEmu,
    useLayoutId: slide.useLayoutId,
    hasBackground: isRecord(slide.background),
    elementCount: elements.length,
    elementTypes: Object.fromEntries(elementTypes),
    firstElements: elements.slice(0, 8).map((element) => ({
      id: element.id,
      name: element.name,
      type: element.type,
      bbox: element.bbox,
      hasShape: isRecord(element.shape),
      hasFill: isRecord(element.fill) || isRecord(asRecord(element.shape)?.fill),
      hasLine: isRecord(element.line) || isRecord(asRecord(element.shape)?.line),
      paragraphCount: arrayOfRecords(element.paragraphs).length,
      textPreview: collectTextPreview(element),
      hasImage: isRecord(element.image) || isRecord(element.imageReference),
      hasTable: isRecord(element.table),
    })),
  };
}

function summarizeRoutaArtifact(artifact: ReturnType<DecodeRoutaOfficeArtifact>, protoBytes: Uint8Array): unknown {
  const firstSlide = artifact.slides[0];
  return {
    protoByteLength: protoBytes.length,
    protoSha256: sha256(protoBytes),
    topLevelKeys: Object.keys(artifact),
    slideCount: artifact.slides.length,
    imageCount: artifact.images.length,
    chartCount: artifact.charts.length,
    tableCount: artifact.tables.length,
    metadata: artifact.metadata,
    firstSlide: {
      keys: Object.keys(firstSlide ?? {}),
      index: firstSlide?.index,
      title: firstSlide?.title,
      textBlockCount: firstSlide?.textBlocks.length ?? 0,
      elementCount: firstSlide?.elements?.length ?? 0,
      firstTextBlocks: firstSlide?.textBlocks.slice(0, 8) ?? [],
    },
  };
}

function collectTextPreview(value: unknown): string {
  const items: string[] = [];
  const seen = new WeakSet<object>();

  function visit(node: unknown): void {
    if (items.length >= 8) {
      return;
    }

    if (typeof node === "string") {
      const text = node.trim();
      if (text.length > 0) {
        items.push(text);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (!isRecord(node) || seen.has(node)) {
      return;
    }

    seen.add(node);
    for (const key of ["text", "value", "alt"]) {
      visit(node[key]);
    }

    for (const child of Object.values(node)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }

  visit(value);
  return items.join(" | ").slice(0, 260);
}

function moduleWithExport(module: unknown, exportName: string): Record<string, unknown> {
  for (const candidate of moduleCandidates(module)) {
    if (exportName in candidate) {
      return candidate;
    }
  }

  throw new Error(`Could not find module export: ${exportName}`);
}

function moduleCandidates(module: unknown): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  const seen = new WeakSet<object>();

  function visit(value: unknown): void {
    if (!isRecord(value) || seen.has(value)) {
      return;
    }

    seen.add(value);
    candidates.push(value);
    visit(value.default);
    visit(value["module.exports"]);
  }

  visit(module);
  return candidates;
}

function toUint8Array(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value);
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
