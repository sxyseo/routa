# @autodev/office

Office document reader powered by **.NET 9 browser-wasm**. It reads DOCX,
PPTX, and XLSX files in Node.js and can generate self-contained Cursor Canvas
files from them.

## Quick Start

Generate a Cursor Canvas file:

```bash
npx @autodev/office canvas ./deck.pptx --output ./deck.canvas.tsx
npx @autodev/office canvas ./document.docx --output ./document.canvas.tsx
npx @autodev/office canvas ./workbook.xlsx --output ./workbook.canvas.tsx
```

Write directly into Cursor's canvas directory for the current working directory:

```bash
npx @autodev/office canvas ./deck.pptx --cursor
```

Or target a specific Cursor project directory:

```bash
npx @autodev/office canvas ./deck.pptx \
  --cursor-project ~/.cursor/projects/<project>
```

## Install

```bash
npm install @autodev/office
```

Requirements:

- Node.js 18 or newer.
- No native add-ons are installed by default.
- The browser-wasm reader is bundled in the package.
- Optional: install `sharp` in your project to enable JPEG recompression and
  thumbnails during Canvas generation.

## CLI

```bash
autodev-office canvas <file.pptx|file.docx|file.xlsx> [--output file.canvas.tsx]
autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor
autodev-office canvas <file.pptx|file.docx|file.xlsx> --cursor-project ~/.cursor/projects/<project>
```

Options:

- `-o, --output <path>` writes the generated `.canvas.tsx` file.
- `--cursor` writes into the Cursor project for the current working directory.
- `--cursor-project <dir>` writes into `<dir>/canvases`.
- `--media-quality <1-100>` controls JPEG quality for embedded media.
- `--media-width <px>` caps embedded media width.
- `--max-columns <n>` caps rendered XLSX columns.
- `--max-rows <n>` caps rendered XLSX rows.
- `--name <slug>` overrides the output file basename.

When writing into a Cursor project, the CLI also writes a matching
`.canvas.status.json` sidecar so Cursor can discover the generated canvas.

## API Usage

```typescript
import {
  extractDocxProto,
  extractPptxProto,
  extractXlsxProto,
  getReaderVersion,
} from "@autodev/office";
import { readFileSync } from "node:fs";

const bytes = new Uint8Array(readFileSync("document.docx"));
const protoBytes = await extractDocxProto(bytes);

console.log(protoBytes); // Uint8Array
console.log(await getReaderVersion()); // e.g. "routa-office-wasm-reader/<version>"
```

## API

### `extractDocxProto(bytes, ignoreErrors?): Promise<Uint8Array>`

Parse a `.docx` file. Returns serialised `OfficeArtifact` protobuf bytes.

### `extractPptxProto(bytes, ignoreErrors?): Promise<Uint8Array>`

Parse a `.pptx` file. Returns serialised `Presentation` protobuf bytes.

### `extractXlsxProto(bytes, ignoreErrors?): Promise<Uint8Array>`

Parse an `.xlsx` file. Returns serialised `Workbook` protobuf bytes.

### `loadOfficeReader(): Promise<OfficeReaderExports>`

Load and return the raw .NET `[JSExport]` surface. Cached after first call.

### `resetOfficeReaderCache(): void`

Clear the cached reader instance. Useful in tests.

### `getReaderVersion(): Promise<string>`

Return the version string embedded in the WASM assembly.

### `renderPptxCursorCanvasSource(protoBytes, options): Promise<string>`

Available from `@autodev/office/cursor-canvas`. Convert PPTX protobuf bytes
from `extractPptxProto` into Cursor Canvas TSX source.

### `renderDocxCursorCanvasSource(protoBytes, options): Promise<string>`

Available from `@autodev/office/office-canvas`. Convert DOCX protobuf bytes
from `extractDocxProto` into Cursor Canvas TSX source.

### `renderXlsxCursorCanvasSource(protoBytes, options): string`

Available from `@autodev/office/office-canvas`. Convert XLSX protobuf bytes
from `extractXlsxProto` into Cursor Canvas TSX source.

## Notes

- The WASM runtime initialises once per Node.js process (Node module cache).
- Package size is about 10 MB unpacked owing to the embedded `.wasm`
  assemblies.
- Cursor Canvas generation supports PPTX, DOCX, and XLSX.
- Generated Canvas metadata stores the input basename, not the absolute local
  file path.
- Generated Canvas files are self-contained. Embedded media from the source
  document may be included as data URLs.
- Published artifacts intentionally exclude source maps and native WASM symbol
  files.

## Building from source

```bash
# From repository root — requires .NET 9 SDK + dotnet workload install wasm-tools
npm run build:office-package
```
