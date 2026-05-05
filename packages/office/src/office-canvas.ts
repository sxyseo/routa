import { createHash } from "node:crypto";

import { loadSharp, type SharpFactory } from "./optional-sharp.js";
import { ProtoReader } from "./proto-reader.js";

type CanvasMedia = {
  height: number;
  src: string;
  width: number;
};

type DocumentBlock =
  | { kind: "image"; mediaId: string; path: string }
  | { kind: "paragraph"; path: string; text: string }
  | { kind: "table"; path: string; rows: string[][] };

type DocumentPayload = {
  artifact: {
    generatedBy: string;
    kind: "docx";
    reader: string;
    source: string;
    title: string;
  };
  blocks: DocumentBlock[];
  diagnostics: { level: string; message: string }[];
  media: Record<string, CanvasMedia>;
};

type OfficeArtifact = {
  diagnostics: { level: string; message: string }[];
  images: { bytes: Uint8Array; contentType: string; id: string; path: string }[];
  tables: { path: string; rows: { cells: { text: string }[] }[] }[];
  textBlocks: { path: string; text: string }[];
  title: string;
};

type WorkbookCell = {
  address: string;
  background: string;
  bold: boolean;
  color: string;
  value: string;
};

type WorkbookPayload = {
  artifact: {
    generatedBy: string;
    kind: "xlsx";
    reader: string;
    source: string;
    title: string;
  };
  sheets: {
    columns: { index: number; width: number }[];
    name: string;
    rows: { cells: WorkbookCell[]; height: number; index: number }[];
  }[];
};

type Workbook = {
  sheets: WorkbookSheet[];
  styles: WorkbookStyles;
};

type WorkbookSheet = {
  columns: { max: number; min: number; width: number }[];
  name: string;
  rows: { cells: WorkbookRawCell[]; height: number; index: number }[];
};

type WorkbookRawCell = {
  address: string;
  styleIndex: number;
  text: string;
};

type WorkbookStyles = {
  cellFormats: { fillId: number; fontId: number }[];
  fills: { color?: string }[];
  fonts: { bold: boolean; color?: string }[];
};

export type RenderOfficeCursorCanvasOptions = {
  maxColumns?: number;
  maxRows?: number;
  mediaQuality?: number;
  mediaWidth?: number;
  readerVersion: string;
  sourceLabel?: string;
  sourcePath?: string;
  title: string;
};

export async function renderDocxCursorCanvasSource(
  protoBytes: Uint8Array,
  options: RenderOfficeCursorCanvasOptions,
): Promise<string> {
  const document = decodeDocxDocument(protoBytes, options.title);
  const artifact =
    document.textBlocks.length > 0 ||
    document.tables.length > 0 ||
    document.images.length > 0
      ? document
      : decodeOfficeArtifact(protoBytes);
  const payload = await buildDocumentPayload(artifact, options);
  return renderDocumentCanvasSource(payload);
}

export function renderXlsxCursorCanvasSource(
  protoBytes: Uint8Array,
  options: RenderOfficeCursorCanvasOptions,
): string {
  const workbook = decodeWorkbook(protoBytes);
  const payload = buildWorkbookPayload(workbook, options);
  return renderWorkbookCanvasSource(payload);
}

function decodeOfficeArtifact(bytes: Uint8Array): OfficeArtifact {
  const reader = new ProtoReader(bytes);
  const artifact: OfficeArtifact = {
    diagnostics: [],
    images: [],
    tables: [],
    textBlocks: [],
    title: "",
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2) artifact.title = reader.string();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      artifact.textBlocks.push(decodeTextBlock(reader.bytesField()));
    } else if (tag.fieldNumber === 6 && tag.wireType === 2) {
      artifact.diagnostics.push(decodeDiagnostic(reader.bytesField()));
    } else if (tag.fieldNumber === 8 && tag.wireType === 2) {
      artifact.images.push(decodeImageAsset(reader.bytesField()));
    } else if (tag.fieldNumber === 9 && tag.wireType === 2) {
      artifact.tables.push(decodeArtifactTable(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return artifact;
}

function decodeTextBlock(bytes: Uint8Array): { path: string; text: string } {
  const reader = new ProtoReader(bytes);
  const block = { path: "", text: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) block.path = reader.string();
    else if (tag.fieldNumber === 2) block.text = reader.string();
    else reader.skip(tag.wireType);
  }
  return block;
}

function decodeDiagnostic(bytes: Uint8Array): { level: string; message: string } {
  const reader = new ProtoReader(bytes);
  const diagnostic = { level: "", message: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) diagnostic.level = reader.string();
    else if (tag.fieldNumber === 2) diagnostic.message = reader.string();
    else reader.skip(tag.wireType);
  }
  return diagnostic;
}

function decodeImageAsset(bytes: Uint8Array): OfficeArtifact["images"][number] {
  const reader = new ProtoReader(bytes);
  const image: OfficeArtifact["images"][number] = {
    bytes: new Uint8Array(),
    contentType: "application/octet-stream",
    id: "",
    path: "",
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) image.id = reader.string();
    else if (tag.fieldNumber === 2) image.path = reader.string();
    else if (tag.fieldNumber === 3) image.contentType = reader.string();
    else if (tag.fieldNumber === 4) image.bytes = reader.bytesField();
    else reader.skip(tag.wireType);
  }
  return image;
}

function decodeArtifactTable(bytes: Uint8Array): OfficeArtifact["tables"][number] {
  const reader = new ProtoReader(bytes);
  const table: OfficeArtifact["tables"][number] = { path: "", rows: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) table.path = reader.string();
    else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      table.rows.push(decodeArtifactRow(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return table;
}

function decodeArtifactRow(bytes: Uint8Array): { cells: { text: string }[] } {
  const reader = new ProtoReader(bytes);
  const row = { cells: [] as { text: string }[] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      row.cells.push(decodeArtifactCell(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return row;
}

function decodeArtifactCell(bytes: Uint8Array): { text: string } {
  const reader = new ProtoReader(bytes);
  const cell = { text: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2) cell.text = reader.string();
    else reader.skip(tag.wireType);
  }
  return cell;
}

function decodeDocxDocument(bytes: Uint8Array, title: string): OfficeArtifact {
  const reader = new ProtoReader(bytes);
  const artifact: OfficeArtifact = {
    diagnostics: [],
    images: [],
    tables: [],
    textBlocks: [],
    title,
  };
  let elementIndex = 0;
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 5 && tag.wireType === 2) {
      const block = decodeDocxElement(reader.bytesField(), elementIndex++);
      if (block.kind === "paragraph" && block.text.trim()) {
        artifact.textBlocks.push({ path: block.path, text: block.text });
      } else if (block.kind === "table") {
        artifact.tables.push(block.table);
      }
    } else if (tag.fieldNumber === 7 && tag.wireType === 2) {
      artifact.images.push(decodeDocxImage(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return artifact;
}

function decodeDocxElement(
  bytes: Uint8Array,
  index: number,
):
  | { kind: "paragraph"; path: string; text: string }
  | { kind: "table"; table: OfficeArtifact["tables"][number] }
  | { kind: "empty" } {
  const reader = new ProtoReader(bytes);
  const paragraphs: string[] = [];
  let table: OfficeArtifact["tables"][number] | null = null;
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 6 && tag.wireType === 2) {
      paragraphs.push(decodeDocxParagraph(reader.bytesField()));
    } else if (tag.fieldNumber === 21 && tag.wireType === 2) {
      table = decodeDocxTable(reader.bytesField(), `document/table-${index}`);
    } else reader.skip(tag.wireType);
  }
  if (table) return { kind: "table", table };
  return paragraphs.length
    ? { kind: "paragraph", path: `document/paragraph-${index}`, text: paragraphs.join("\n") }
    : { kind: "empty" };
}

function decodeDocxParagraph(bytes: Uint8Array): string {
  const reader = new ProtoReader(bytes);
  const runs: string[] = [];
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      runs.push(decodeDocxRun(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return runs.join("");
}

function decodeDocxRun(bytes: Uint8Array): string {
  const reader = new ProtoReader(bytes);
  let text = "";
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) text = reader.string();
    else reader.skip(tag.wireType);
  }
  return text;
}

function decodeDocxTable(bytes: Uint8Array, path: string): OfficeArtifact["tables"][number] {
  const reader = new ProtoReader(bytes);
  const table: OfficeArtifact["tables"][number] = { path, rows: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      table.rows.push(decodeDocxTableRow(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return table;
}

function decodeDocxTableRow(bytes: Uint8Array): { cells: { text: string }[] } {
  const reader = new ProtoReader(bytes);
  const row = { cells: [] as { text: string }[] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      row.cells.push(decodeDocxTableCell(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return row;
}

function decodeDocxTableCell(bytes: Uint8Array): { text: string } {
  const reader = new ProtoReader(bytes);
  const cell = { text: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) cell.text = reader.string();
    else reader.skip(tag.wireType);
  }
  return cell;
}

function decodeDocxImage(bytes: Uint8Array): OfficeArtifact["images"][number] {
  const reader = new ProtoReader(bytes);
  const image: OfficeArtifact["images"][number] = {
    bytes: new Uint8Array(),
    contentType: "application/octet-stream",
    id: "",
    path: "",
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) image.contentType = reader.string();
    else if (tag.fieldNumber === 2) image.bytes = reader.bytesField();
    else if (tag.fieldNumber === 3) image.id = reader.string();
    else reader.skip(tag.wireType);
  }
  image.path = image.id;
  return image;
}

async function buildDocumentPayload(
  artifact: OfficeArtifact,
  options: RenderOfficeCursorCanvasOptions,
): Promise<DocumentPayload> {
  const media = new Map<string, CanvasMedia>();
  const sharp = await loadSharp();
  for (const image of artifact.images) {
    if (!image.bytes.length) continue;
    const encoded = await encodeImage(image.bytes, image.contentType, sharp, options);
    const id = image.id || image.path || sha256(image.bytes);
    const size = imageSize(encoded.bytes);
    media.set(id, {
      height: size.height,
      src: `data:${encoded.contentType};base64,${Buffer.from(encoded.bytes).toString("base64")}`,
      width: size.width,
    });
  }

  const blocks: DocumentBlock[] = [];
  for (const textBlock of artifact.textBlocks) {
    for (const paragraph of textBlock.text.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean)) {
      blocks.push({ kind: "paragraph", path: textBlock.path, text: paragraph });
    }
  }
  for (const table of artifact.tables) {
    blocks.push({
      kind: "table",
      path: table.path,
      rows: table.rows.map((row) => row.cells.map((cell) => cell.text)),
    });
  }
  for (const image of artifact.images) {
    const mediaId = image.id || image.path || sha256(image.bytes);
    if (media.has(mediaId)) {
      blocks.push({ kind: "image", mediaId, path: image.path });
    }
  }

  return {
    artifact: {
      generatedBy: "@autodev/office",
      kind: "docx",
      reader: options.readerVersion,
      source: sourceLabel(options),
      title: artifact.title || options.title,
    },
    blocks,
    diagnostics: artifact.diagnostics,
    media: Object.fromEntries(media),
  };
}

function decodeWorkbook(bytes: Uint8Array): Workbook {
  const reader = new ProtoReader(bytes);
  const workbook: Workbook = {
    sheets: [],
    styles: { cellFormats: [], fills: [], fonts: [] },
  };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      workbook.sheets.push(decodeWorkbookSheet(reader.bytesField()));
    } else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      workbook.styles = decodeWorkbookStyles(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return workbook;
}

function decodeWorkbookSheet(bytes: Uint8Array): WorkbookSheet {
  const reader = new ProtoReader(bytes);
  const sheet: WorkbookSheet = { columns: [], name: "Sheet", rows: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2) sheet.name = reader.string();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      sheet.rows.push(decodeWorkbookRow(reader.bytesField()));
    } else if (tag.fieldNumber === 6 && tag.wireType === 2) {
      sheet.columns.push(decodeWorkbookColumn(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return sheet;
}

function decodeWorkbookRow(bytes: Uint8Array): WorkbookSheet["rows"][number] {
  const reader = new ProtoReader(bytes);
  const row = { cells: [] as WorkbookRawCell[], height: 22, index: 0 };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) row.index = reader.int32();
    else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      row.cells.push(decodeWorkbookCell(reader.bytesField()));
    } else if (tag.fieldNumber === 3) row.height = reader.float();
    else reader.skip(tag.wireType);
  }
  return row;
}

function decodeWorkbookCell(bytes: Uint8Array): WorkbookRawCell {
  const reader = new ProtoReader(bytes);
  const cell: WorkbookRawCell = { address: "", styleIndex: 0, text: "" };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) cell.address = reader.string();
    else if (tag.fieldNumber === 2) cell.text = reader.string();
    else if (tag.fieldNumber === 5) cell.styleIndex = reader.int32();
    else reader.skip(tag.wireType);
  }
  return cell;
}

function decodeWorkbookColumn(bytes: Uint8Array): WorkbookSheet["columns"][number] {
  const reader = new ProtoReader(bytes);
  const column = { max: 0, min: 0, width: 12 };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1) column.min = reader.int32();
    else if (tag.fieldNumber === 2) column.max = reader.int32();
    else if (tag.fieldNumber === 3) column.width = reader.float();
    else reader.skip(tag.wireType);
  }
  return column;
}

function decodeWorkbookStyles(bytes: Uint8Array): WorkbookStyles {
  const reader = new ProtoReader(bytes);
  const styles: WorkbookStyles = { cellFormats: [], fills: [], fonts: [] };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 1 && tag.wireType === 2) {
      styles.fonts.push(decodeWorkbookFont(reader.bytesField()));
    } else if (tag.fieldNumber === 2 && tag.wireType === 2) {
      styles.fills.push(decodeWorkbookFill(reader.bytesField()));
    } else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      styles.cellFormats.push(decodeWorkbookCellFormat(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return styles;
}

function decodeWorkbookFont(bytes: Uint8Array): WorkbookStyles["fonts"][number] {
  const reader = new ProtoReader(bytes);
  const font = { bold: false, color: undefined as string | undefined };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 4) font.bold = reader.bool();
    else if (tag.fieldNumber === 7 && tag.wireType === 2) {
      font.color = fillColor(decodeWorkbookFill(reader.bytesField()));
    } else reader.skip(tag.wireType);
  }
  return font;
}

function decodeWorkbookFill(bytes: Uint8Array): WorkbookStyles["fills"][number] {
  const reader = new ProtoReader(bytes);
  const fill: { color?: string } = {};
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2 && tag.wireType === 2) {
      fill.color = decodeColor(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  return fill;
}

function decodeWorkbookCellFormat(bytes: Uint8Array): WorkbookStyles["cellFormats"][number] {
  const reader = new ProtoReader(bytes);
  const format = { fillId: 0, fontId: 0 };
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2) format.fontId = reader.int32();
    else if (tag.fieldNumber === 3) format.fillId = reader.int32();
    else reader.skip(tag.wireType);
  }
  return format;
}

function decodeColor(bytes: Uint8Array): string | undefined {
  const reader = new ProtoReader(bytes);
  let value = "";
  let alpha: number | undefined;
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 2) value = reader.string();
    else if (tag.fieldNumber === 3 && tag.wireType === 2) {
      alpha = decodeColorAlpha(reader.bytesField());
    } else reader.skip(tag.wireType);
  }
  if (!value || alpha === 0) return undefined;
  return /^[0-9a-f]{6}$/iu.test(value) ? `#${value}` : undefined;
}

function decodeColorAlpha(bytes: Uint8Array): number | undefined {
  const reader = new ProtoReader(bytes);
  let alpha: number | undefined;
  while (!reader.eof()) {
    const tag = reader.tag();
    if (tag.fieldNumber === 6) alpha = reader.int32();
    else reader.skip(tag.wireType);
  }
  return alpha;
}

function buildWorkbookPayload(
  workbook: Workbook,
  options: RenderOfficeCursorCanvasOptions,
): WorkbookPayload {
  const maxColumns = options.maxColumns ?? 24;
  const maxRows = options.maxRows ?? 100;
  return {
    artifact: {
      generatedBy: "@autodev/office",
      kind: "xlsx",
      reader: options.readerVersion,
      source: sourceLabel(options),
      title: options.title,
    },
    sheets: workbook.sheets.map((sheet) => ({
      columns: columnWidths(sheet.columns, maxColumns),
      name: sheet.name,
      rows: sheet.rows.slice(0, maxRows).map((row) => ({
        cells: row.cells
          .filter((cell) => columnIndex(cell.address) <= maxColumns)
          .map((cell) => workbookCell(cell, workbook.styles)),
        height: Math.max(24, Math.min(72, row.height * 1.35 || 28)),
        index: row.index,
      })),
    })),
  };
}

function workbookCell(cell: WorkbookRawCell, styles: WorkbookStyles): WorkbookCell {
  const format = styles.cellFormats[cell.styleIndex] ?? { fillId: 0, fontId: 0 };
  const fill = styles.fills[format.fillId];
  const font = styles.fonts[format.fontId];
  return {
    address: cell.address,
    background: fillColor(fill) ?? "#ffffff",
    bold: font?.bold === true,
    color: font?.color ?? "#111827",
    value: cell.text,
  };
}

function columnWidths(
  columns: WorkbookSheet["columns"],
  maxColumns: number,
): { index: number; width: number }[] {
  const widths: { index: number; width: number }[] = [];
  for (let index = 1; index <= maxColumns; index++) {
    const column = columns.find((item) => item.min <= index && index <= item.max);
    widths.push({ index, width: Math.max(56, Math.min(240, (column?.width ?? 12) * 7)) });
  }
  return widths;
}

function renderDocumentCanvasSource(payload: DocumentPayload): string {
  return `import { Pill, Row, Stack, Text, useHostTheme } from "cursor/canvas";

type DocumentBlock =
  | { kind: "image"; mediaId: string; path: string }
  | { kind: "paragraph"; path: string; text: string }
  | { kind: "table"; path: string; rows: string[][] };
type CanvasMedia = { height: number; src: string; width: number };

const payload = JSON.parse(${JSON.stringify(JSON.stringify(payload))}) as {
  artifact: { generatedBy: string; kind: "docx"; reader: string; source: string; title: string };
  blocks: DocumentBlock[];
  diagnostics: { level: string; message: string }[];
  media: Record<string, CanvasMedia>;
};

export default function OfficeDocumentCanvas() {
  const theme = useHostTheme();
  return (
    <div style={{ background: theme.bg.editor, border: \`1px solid \${theme.stroke.secondary}\`, borderRadius: 8, color: theme.text.primary, height: "min(820px, calc(100vh - 40px))", overflow: "hidden" }}>
      <Row align="center" justify="between" style={{ borderBottom: \`1px solid \${theme.stroke.secondary}\`, height: 52, padding: "0 16px" }}>
        <Row align="center" gap={8} style={{ minWidth: 0 }}>
          <Pill active size="sm" tone="info">docx</Pill>
          <Text as="span" size="small" tone="secondary" truncate>{payload.artifact.reader}</Text>
        </Row>
        <Text as="span" size="small" weight="semibold" truncate>{payload.artifact.title}</Text>
      </Row>
      <main style={{ background: theme.fill.primary, height: "calc(100% - 52px)", overflow: "auto", padding: "24px" }}>
        <article style={{ background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.36)", borderRadius: 8, boxShadow: "0 18px 46px rgba(15, 23, 42, 0.10)", color: "#1f2937", margin: "0 auto", maxWidth: 860, minHeight: 960, padding: "48px 56px" }}>
          <Stack gap={18}>
            {payload.diagnostics.map((diagnostic, index) => (
              <div key={index} style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, color: "#9a3412", padding: "10px 12px" }}>{diagnostic.level}: {diagnostic.message}</div>
            ))}
            {payload.blocks.map((block, index) => <DocumentBlockView block={block} key={index} />)}
          </Stack>
        </article>
      </main>
    </div>
  );
}

function DocumentBlockView({ block }: { block: DocumentBlock }) {
  if (block.kind === "paragraph") {
    return <p style={{ font: "400 15px/1.72 -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif", margin: 0, whiteSpace: "pre-wrap" }}>{block.text}</p>;
  }
  if (block.kind === "image") {
    const media = payload.media[block.mediaId];
    if (!media) return null;
    return <img alt={block.path} src={media.src} style={{ display: "block", maxHeight: 520, maxWidth: "100%", objectFit: "contain" }} />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", font: "400 13px/1.5 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", minWidth: "100%", tableLayout: "fixed" }}>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex} style={{ border: "1px solid #cbd5e1", padding: "7px 9px", verticalAlign: "top", whiteSpace: "pre-wrap" }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;
}

function renderWorkbookCanvasSource(payload: WorkbookPayload): string {
  return `import { Button, Pill, Row, Text, useCanvasState, useHostTheme } from "cursor/canvas";

type WorkbookCell = { address: string; background: string; bold: boolean; color: string; value: string };
type WorkbookSheet = { columns: { index: number; width: number }[]; name: string; rows: { cells: WorkbookCell[]; height: number; index: number }[] };

const payload = JSON.parse(${JSON.stringify(JSON.stringify(payload))}) as {
  artifact: { generatedBy: string; kind: "xlsx"; reader: string; source: string; title: string };
  sheets: WorkbookSheet[];
};

export default function OfficeWorkbookCanvas() {
  const theme = useHostTheme();
  const [selectedSheet, setSelectedSheet] = useCanvasState("selected-sheet", payload.sheets[0]?.name ?? "");
  const sheet = payload.sheets.find((item) => item.name === selectedSheet) ?? payload.sheets[0];
  return (
    <div style={{ background: theme.bg.editor, border: \`1px solid \${theme.stroke.secondary}\`, borderRadius: 8, color: theme.text.primary, display: "grid", gridTemplateRows: "52px 42px minmax(0, 1fr)", height: "min(820px, calc(100vh - 40px))", overflow: "hidden" }}>
      <Row align="center" justify="between" style={{ borderBottom: \`1px solid \${theme.stroke.secondary}\`, padding: "0 16px" }}>
        <Row align="center" gap={8} style={{ minWidth: 0 }}>
          <Pill active size="sm" tone="info">xlsx</Pill>
          <Text as="span" size="small" tone="secondary" truncate>{payload.artifact.reader}</Text>
        </Row>
        <Text as="span" size="small" weight="semibold" truncate>{payload.artifact.title}</Text>
      </Row>
      <Row align="center" gap={8} style={{ borderBottom: \`1px solid \${theme.stroke.secondary}\`, overflowX: "auto", padding: "0 12px" }}>
        {payload.sheets.map((item) => <Button key={item.name} onClick={() => setSelectedSheet(item.name)} size="sm" variant={item.name === sheet.name ? "primary" : "secondary"}>{item.name}</Button>)}
      </Row>
      <main style={{ background: theme.fill.primary, minHeight: 0, overflow: "auto", padding: 14 }}>
        {sheet ? <SheetGrid sheet={sheet} /> : null}
      </main>
    </div>
  );
}

function SheetGrid({ sheet }: { sheet: WorkbookSheet }) {
  const widths = ["48px", ...sheet.columns.map((column) => \`\${column.width}px\`)].join(" ");
  return (
    <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", color: "#111827", display: "inline-grid", gridTemplateColumns: widths, minWidth: "100%" }}>
      <div style={headerCellStyle} />
      {sheet.columns.map((column) => <div key={column.index} style={headerCellStyle}>{columnName(column.index)}</div>)}
      {sheet.rows.map((row) => {
        const byColumn = new Map(row.cells.map((cell) => [columnIndex(cell.address), cell]));
        return [
          <div key={\`r-\${row.index}\`} style={{ ...headerCellStyle, height: row.height }}>{row.index}</div>,
          ...sheet.columns.map((column) => {
            const cell = byColumn.get(column.index);
            return <div key={\`\${row.index}-\${column.index}\`} title={cell?.address} style={{ alignItems: "center", background: cell?.background ?? "#ffffff", borderBottom: "1px solid #e2e8f0", borderRight: "1px solid #e2e8f0", boxSizing: "border-box", color: cell?.color ?? "#111827", display: "flex", font: \`\${cell?.bold ? 700 : 400} 12px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif\`, height: row.height, minWidth: 0, overflow: "hidden", padding: "0 8px", whiteSpace: "nowrap" }}>{cell?.value ?? ""}</div>;
          }),
        ];
      })}
    </div>
  );
}

const headerCellStyle = {
  alignItems: "center",
  background: "#f8fafc",
  borderBottom: "1px solid #cbd5e1",
  borderRight: "1px solid #cbd5e1",
  boxSizing: "border-box" as const,
  color: "#475569",
  display: "flex",
  font: "600 12px/1 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  height: 28,
  justifyContent: "center",
};

function columnName(index: number): string {
  let value = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    value = String.fromCharCode(65 + (current % 26)) + value;
    current = Math.floor(current / 26);
  }
  return value;
}

function columnIndex(address: string): number {
  const letters = address.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index;
}
`;
}

async function encodeImage(
  bytes: Uint8Array,
  contentType: string,
  sharp: SharpFactory | null,
  options: RenderOfficeCursorCanvasOptions,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!sharp) return { bytes, contentType };
  const buffer = await sharp(bytes)
    .resize({ fit: "inside", width: options.mediaWidth ?? 1280, withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ mozjpeg: true, quality: clampQuality(options.mediaQuality ?? 72) })
    .toBuffer();
  return { bytes: new Uint8Array(buffer), contentType: "image/jpeg" };
}

function fillColor(fill?: { color?: string }): string | undefined {
  return fill?.color && fill.color !== "#000000" ? fill.color : undefined;
}

function sourceLabel(options: RenderOfficeCursorCanvasOptions): string {
  return options.sourceLabel ?? basename(options.sourcePath) ?? options.title;
}

function basename(value?: string): string | undefined {
  const parts = value?.split(/[\\/]+/u).filter(Boolean);
  return parts?.[parts.length - 1];
}

function columnIndex(address: string): number {
  const letters = address.match(/^[A-Z]+/iu)?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64;
  return index;
}

function imageSize(bytes: Uint8Array): { height: number; width: number } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { height: readUint32BE(bytes, 20), width: readUint32BE(bytes, 16) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: (bytes[offset + 5] << 8) + bytes[offset + 6],
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        };
      }
      offset += 2 + length;
    }
  }
  return { height: 1, width: 1 };
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function clampQuality(value: number): number {
  return Math.max(1, Math.min(100, Math.round(value)));
}
