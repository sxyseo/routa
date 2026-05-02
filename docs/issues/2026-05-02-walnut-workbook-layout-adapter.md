---
title: "Office XLSX preview needs a Walnut-like workbook layout adapter"
date: "2026-05-02"
kind: issue
status: in_progress
severity: medium
area: ui
tags: [artifact-viewer, office-documents, xlsx, spreadsheet, layout, walnut]
reported_by: "human"
related_issues: ["2026-05-01-office-document-viewer-wasm-reader.md"]
github_issue: null
github_state: null
github_url: null
---

# Office XLSX preview needs a Walnut-like workbook layout adapter

## What Happened

While comparing `complex_excel_renderer_test.xlsx` against Codex/Walnut output, the protocol-level reader checks converged, but the debug XLSX preview still showed layout drift:

- table columns and rows did not use Excel-like fixed pixel sizing
- row heights behaved like browser table auto layout rather than spreadsheet viewport layout
- chart overlays were sensitive to DOM table layout instead of worksheet anchor geometry
- line charts initially chose a value axis starting around the observed minimum instead of the Excel/Walnut-like zero baseline

Walnut's `PopcornElectronWorkbookPanel` is not a DOM table renderer. It keeps `columnWidths` and `rowHeights` as pixel arrays, uses fixed sheet headers (`40px` row header, `20px` column header), and relies on prefix sums to map cells, freeze panes, floating elements, and chart overlays into a shared worksheet coordinate system.

## Expected Behavior

Routa's XLSX preview should normalize OpenXML/reader dimensions into a stable spreadsheet layout model before rendering:

- Excel column width units become pixel widths
- Excel row height points become pixel heights
- visible grid bounds are computed from row/column prefix sums
- floating drawings and charts are positioned from worksheet anchors, independent of DOM table auto layout
- future freeze panes and hit-testing can reuse the same coordinate model

## Reproduction Context

- Environment: web debug POC
- Trigger: Open `/debug/office-wasm-poc`, select Routa generated reader, and upload `tools/office-wasm-reader/fixtures/complex_excel_renderer_test.xlsx`.
- Reference fixture: `/Users/phodal/Downloads/complex_excel_renderer_test.xlsx`
- Reference implementation: `tmp/codex-app-analysis/extracted/webview/assets/PopcornElectronWorkbookPanel-BZz8NPb4.js`

## Why This Might Happen

- The current debug preview originally rendered worksheets as an HTML table, letting browser layout stretch or shrink cells after the protocol values were read.
- Chart and shape positioning used ad hoc row/column calculations near the React rendering code instead of a single worksheet coordinate model.
- Walnut's reader emits workbook protocol, but the visible parity depends on the front-end viewport layout engine as much as the WASM extraction protocol.

## Relevant Files

- `src/app/debug/office-wasm-poc/spreadsheet-preview.tsx`
- `src/app/debug/office-wasm-poc/spreadsheet-layout.ts`
- `scripts/office-wasm-reader/compare-walnut-xlsx-protocol.ts`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/XlsxArtifactReader.cs`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/OpenXmlChartReader.cs`

## Observations

- Walnut viewport constants observed in the extracted bundle: row header `40`, column header `20`.
- Walnut computes prefix sums for `columnWidths` and `rowHeights`, then projects logical worksheet coordinates through camera/freeze-pane helpers.
- Routa's debug POC can keep a smaller DOM-backed renderer for now, but it should consume an explicit layout adapter rather than mixing unit conversion, prefix sums, and rendering in the component.

## Progress

- Added a spreadsheet layout adapter that normalizes column widths, row heights, merge coverage, and prefix-sum offsets.
- Reworked the debug workbook preview to render cells, headers, shapes, and charts from the shared pixel coordinate model instead of DOM table layout.
- Verified `complex_excel_renderer_test.xlsx` protocol parity and captured browser evidence for the task table and Fitness chart.
- Added table row striping and basic icon-set rendering after comparing the workbook against Microsoft Excel through Computer Use.
- Added an XLSX render-contract comparator that compares decoded Workbook render inputs separately from proto/core parity: sheet layout, merged cells, tables, conditional formatting, data validations, drawings, charts, shapes, images, and style contracts.
- Aligned `complex_excel_renderer_test.xlsx` non-byte render contract with Walnut: all render-facing checks pass, including chart metadata, worksheet drawings, shape geometry, conditional formatting, and styles. The remaining mismatch is byte-for-byte proto serialization only.

## Remaining XLSX Work

- Precise table styles: table stripes are still rendered from a small local approximation for `TableStyleMedium2`; the reader and preview should parse theme/table style metadata and apply row/column stripe options from the protocol.
- Icon-set details: Risk icons render, but thresholds should honor `cfvo` type/value, `percent`, `reverse`, and `showValue` exactly instead of deriving levels from the observed min/max only.
- Chart fidelity: Fitness charts now use a zero baseline, but plot area sizing, legend placement, markers, gridlines, fonts, and Excel internal chart layout are still simplified.
- Freeze panes and sticky headers: the prefix-sum layout adapter exists, but the preview still needs Walnut-like frozen pane projection, viewport scrolling, and hit regions for cells/floating elements.
- Conditional formatting breadth: data bars need negative values, axis, gradient/solid variants, and multi-rule layering; color scales need fuller multi-stop handling.
- Protocol coverage: `complex_excel_renderer_test.xlsx` core parity and non-byte render contract both pass, but the generated proto is not byte-for-byte Walnut equivalent; add more XLSX fixtures and field-level assertions.

## References

- `docs/issues/2026-05-01-office-document-viewer-wasm-reader.md`
