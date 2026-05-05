# @autodev/office

> Office document reader powered by **.NET 9 browser-wasm** — reads DOCX, PPTX, and XLSX files and returns serialised **protobuf bytes**.

## Requirements

- Node.js ≥ 18
- No native add-ons are installed by default. The `.wasm` bundle ships inside
  this package.
- Optional: install `sharp` in your project to enable JPEG recompression and
  thumbnails during Canvas generation.

## Installation

```bash
npm install @autodev/office
```

## Usage

```typescript
import { extractDocxProto, extractPptxProto, extractXlsxProto, getReaderVersion } from '@autodev/office';
import { readFileSync } from 'node:fs';

const docxBytes = new Uint8Array(readFileSync('document.docx'));
const protoBytes = await extractDocxProto(docxBytes);
// protoBytes is a Uint8Array of routa.office.v1.OfficeArtifact protobuf bytes

console.log(await getReaderVersion()); // "routa-office-wasm-reader/0.1.0"
```

## CLI

Generate a Cursor Canvas from an Office file:

```bash
npx @autodev/office canvas ./deck.pptx --output ./deck.canvas.tsx
npx @autodev/office canvas ./document.docx --output ./document.canvas.tsx
npx @autodev/office canvas ./workbook.xlsx --output ./workbook.canvas.tsx
```

Write directly into the Cursor project for the current working directory:

```bash
npx @autodev/office canvas ./deck.pptx --cursor
```

Or target a specific Cursor project:

```bash
npx @autodev/office canvas ./deck.pptx \
  --cursor-project ~/.cursor/projects/<project>
```

The CLI uses the package's embedded WASM reader and emits a self-contained
`.canvas.tsx` file with slide navigation and slideshow mode.
When writing into a Cursor project, it also writes the matching
`.canvas.status.json` sidecar so Cursor can discover the generated canvas.
When `sharp` is available from the caller's project, the CLI compresses embedded
slide media and renders small JPEG thumbnails to keep the generated Canvas size
manageable.

## API

### `extractDocxProto(bytes, ignoreErrors?): Promise<Uint8Array>`

Parse a `.docx` file. Returns serialised `OfficeArtifact` protobuf bytes.

### `extractPptxProto(bytes, ignoreErrors?): Promise<Uint8Array>`

Parse a `.pptx` file. Returns serialised `Presentation` protobuf bytes (Walnut-compatible shape).

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
- Package size is ~10 MB owing to the embedded .wasm assemblies.
- Cursor Canvas generation supports PPTX, DOCX, and XLSX.
- Generated Canvas metadata stores the input basename, not the absolute local
  file path.

## Building from source

```bash
# From repository root — requires .NET 9 SDK + dotnet workload install wasm-tools
npm run build:office-package
```
