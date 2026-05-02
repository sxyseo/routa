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
- Confirmed the next protocol-level Walnut gap for XLSX drawings: the extracted schema includes workbook-level `images` and per-drawing `imageReference`, while Routa still only consumes chart/shape anchors.
- Implemented Walnut-like worksheet image drawing support and added `xlsx_image_drawing_contract.xlsx` to the XLSX parity/render scripts. The fixture verifies workbook `images`, drawing `imageReference`, two-cell anchors, and Walnut's image-specific omission of `extentCx/extentCy`.
- Added Walnut-like freeze-pane viewport math to the layout adapter: frozen body sizes, world/viewport point projection, rect segmentation for frozen rows/columns, and cell hit-testing now share the same prefix-sum coordinate model. The debug preview renders frozen body overlays when a decoded/synthetic sheet supplies `freezePanes`.

## Remaining XLSX Work

- Precise table styles: table headers, row/column stripe flags, first/last column emphasis, and totals rows are now projected from protocol table style metadata. Full theme/table style color definitions are still approximated locally.
- Icon-set details: Risk icons now honor `cfvo` type/value for `min`, `max`, `num`, `percent`, `percentile`, plus `gte`, `reverse`, `showValue`, and common rating/arrows/traffic/symbol icon families. Custom icon-image payloads are not supported.
- Chart fidelity: Fitness charts now use a zero baseline, and the preview consumes sheet drawing chart anchors/series/legend directly from the Walnut-like protocol. Plot area sizing, gridlines, fonts, and Excel internal chart layout are still simplified.
- Drawing overlays: sheet drawing chart/shape/image anchors, workbook image payloads, and Walnut-style image references are now consumed by the preview. Full drawing z-order, crop, and effects remain.
- Freeze panes and sticky headers: the prefix-sum layout adapter now drives fixed headers, frozen body overlays, viewport projection, and cell hit regions. Remaining work is extracting freeze panes from a future protocol source, viewport virtualization, and floating-element hit regions.
- Conditional formatting breadth: data bars now support negative values, explicit axis placement, and gradient/solid variants. Color scales now use cfvo thresholds for multi-stop interpolation; multi-rule layering still needs more coverage.
- Protocol coverage: `complex_excel_renderer_test.xlsx` and `xlsx_image_drawing_contract.xlsx` parity/render checks pass, but the generated proto is not byte-for-byte Walnut equivalent for the complex workbook; add more XLSX fixtures and field-level assertions.

## References

- `docs/issues/2026-05-01-office-document-viewer-wasm-reader.md`
