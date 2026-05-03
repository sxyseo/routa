# @autodev/office

> Office document reader powered by **.NET 9 browser-wasm** — reads DOCX, PPTX, and XLSX files and returns serialised **protobuf bytes**.

## Requirements

- Node.js ≥ 18
- No native add-ons. The `.wasm` bundle ships inside this package.

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

## Notes

- The WASM runtime initialises once per Node.js process (Node module cache).
- Package size is ~10 MB owing to the embedded .wasm assemblies.
- `MONO_WASM: Error loading symbol file` is a harmless diagnostic message from the Mono runtime.

## Building from source

```bash
# From repository root — requires .NET 9 SDK + dotnet workload install wasm-tools
npm run build:office-package
```
