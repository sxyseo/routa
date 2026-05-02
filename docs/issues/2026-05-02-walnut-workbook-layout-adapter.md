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
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/XlsxWorkbookProtoReader.cs`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/XlsxArtifactReader.cs`
- `tools/office-wasm-reader/Routa.OfficeWasmReader/Readers/OpenXmlChartReader.cs`

## Observations

- Walnut viewport constants observed in the extracted bundle: row header `40`, column header `20`.
- Walnut computes prefix sums for `columnWidths` and `rowHeights`, then projects logical worksheet coordinates through camera/freeze-pane helpers.
- Routa's debug POC can keep a smaller DOM-backed renderer for now, but it should consume an explicit layout adapter rather than mixing unit conversion, prefix sums, and rendering in the component.

## Walnut Performance Notes

- Walnut explicitly treats workbook rendering as a performance-sensitive viewport. `PopcornElectronWorkbookPanel-BZz8NPb4.js` requires `Worker`, `HTMLCanvasElement`, and `OffscreenCanvas`, then routes base workbook rendering through a worker-backed canvas frame instead of a DOM table.
- The main thread coalesces expensive work with `requestAnimationFrame`: viewport redraw and canvas resize/sync are scheduled once per frame, and canvas bitmap resizing is skipped when width/height/DPR are unchanged.
- Host size changes are tracked with `ResizeObserver` plus a window resize listener; canvas CSS size and intrinsic bitmap size are synced from one viewport metrics object.
- Layout math is prefix-sum driven: `columnWidths`, `rowHeights`, camera scroll, freeze panes, row/column headers, selection rectangles, chart hover targets, and drawing hit regions all share the same logical coordinate system.
- Worker state updates are partitioned by kind (`viewport`, `selection`, `editor`, `overlays`, `floating`, etc.). Overlay anchors and chart hover targets are shallow-compared before posting events back to the main thread, reducing needless React updates.
- The remaining risk for a Routa implementation is large-sheet lookup cost. Walnut still has some linear scans for nearest row/column and resize hit testing in the extracted bundle, so our layout adapter should keep prefix arrays reusable and prefer binary search for viewport range lookup before adding more overlay hit regions.

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
- Preserved sheet drawing order across image, shape, and chart specs by projecting the drawing index into per-element z-indexes instead of forcing fixed image/shape/chart layer order.
- Projected OpenXML drawing shape effects into Walnut-like presentation `Element.effects` for XLSX shapes, and rendered shadow effects in the debug spreadsheet shape layer.
- Confirmed Walnut's spreadsheet reader ignores XLSX picture crop (`a:srcRect`) for image drawings: a cropped temp fixture produced the same Walnut proto hash as the uncropped image fixture. Crop remains a protocol limitation unless the target schema adds an image crop field.
- Added workbook theme extraction for XLSX and switched table stripe palettes to derive from theme color-scheme accents when the protocol supplies a theme.
- Tightened the debug chart renderer toward Excel/Walnut output with explicit tick values, wider y-axis plot margins, axis baselines, vertical/horizontal gridlines, larger line markers, and marker-aware legends.
- Added decoded Workbook protocol diff reporting to `compare-walnut-xlsx-protocol.ts` via `--diff --diff-limit=N` so the remaining Walnut/Routa XLSX gaps can be grouped by protocol path instead of only byte length/hash.
- Re-ran `complex_excel_renderer_test.xlsx` against Walnut after the protocol-default pass: all core protocol equivalence checks remain true, render contract still passes 13/14 checks with only `byteProtoExactMatch` failing, and raw proto length drift dropped from `+2951` bytes to `-40` bytes (`Routa 231714`, `Walnut 231754`).
- Reduced decoded protocol diff count from `1221` to `116` by matching formula cell handling (`formulaType`, shared formula metadata, no `<f>` text as value), row hidden default omission, sheet ids, base column width defaults, explicit `showGridLines=false`, empty `RangeTarget.sheetId`, shape bbox zero origins, column `hidden=false`, and empty conditional-format operator fields.
- Added XLSX data-validation protocol output and normalized the comparator/render-contract scripts for Walnut's `dataValidations.items` wrapper shape. The complex workbook now matches data-validation counts for `02_Tasks_Table` and `06_Validation_Form`; the decoded protocol diff is down to `114`, with `Routa 232196` bytes vs Walnut `231754` bytes.
- Aligned remaining decoded protocol fields for `complex_excel_renderer_test.xlsx`: chart payload defaults (`titleTextStyle`, `dataLabels`, `view3d`, `barOptions`), axis defaults/titles/gridlines, line-series marker presence, chart-space outline extraction from root `c:spPr`, cell style/style-xf blocks, pattern-fill foreground/background fallback, explicit conditional-format rule ids, and explicit cell `styleIndex: 0` for unstyled cells.
- Re-ran Walnut protocol comparison with `--diff`: `complex_excel_renderer_test.xlsx` and `xlsx_image_drawing_contract.xlsx` now both report `protocolDiff.totalCount: 0`. The generated proto bytes are still not byte-identical (`complex`: Routa `232934` bytes vs Walnut `231754`; `image`: Routa `226` bytes vs Walnut `224`), so the current contract is decoded Workbook equivalence rather than raw protobuf byte equality.
- Tightened `npm run test:office-wasm-reader:xlsx-parity` so `--assert` now fails on any decoded protocol diff, not only high-level count/shape mismatches.
- Added Walnut-like XLSX `sparklineGroups` protocol extraction for x14 sparkline extensions, including group options, ARGB sparkline colors, and per-sparkline formula/reference pairs. `xlsx_sparkline_contract.xlsx` now covers this path in both decoded protocol and render-contract tests.
- Added root-level XLSX `definedNames` protocol extraction, including global/local names, comments/descriptions, menu/help/status metadata, shortcut key, and boolean/function attributes. `xlsx_defined_names_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences.
- Added legacy XLSX comment extraction into Walnut-like root `people[]` and `notes[]`, using sheet-scoped author ids and cell targets. `xlsx_comments_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences.
- Added modern XLSX threaded comments extraction into Walnut-like root `people[]` and `threads[]`, including workbook person parts, thread cell targets, comment parent chains, body text, active/resolved status, and normalized created timestamps. `xlsx_threaded_comments_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences.
- Added XLSX pivot cache/table protocol extraction for workbook `pivotCaches` and sheet `pivotTables`, including cache worksheet source, cache fields/shared items, pivot location, pivot fields/items, row/column/page/data fields, style flags, and core version/format options. `xlsx_pivot_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences.
- Added XLSX slicer cache/sheet slicer protocol extraction, including root `slicerCaches`, slicer part fields, drawing-anchor lookup via `sle:slicer`, and Walnut-specific slicer shape defaults. `xlsx_slicer_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences.
- Added XLSX timeline cache protocol extraction and Walnut-style `tsle:timeslicer` drawing-shape normalization. `xlsx_timeline_contract.xlsx` passes decoded Walnut protocol diff with zero field-level differences; Walnut did not emit sheet-level `timelines` for this minimal fixture, so the contract currently mirrors that behavior.
- Added richer XLSX chart-family preview routing for area, pie, doughnut, scatter, bubble, radar, and surface chart protocol ids, plus scatter/bubble X/Y value extraction from `c:xVal`/`c:yVal`. Existing decoded protocol and render-contract fixtures still pass; broader Excel-authored multi-chart fixtures are still needed.
- Added `xlsx_multi_chart_contract.xlsx` and aligned Walnut decoded protocol for area, pie, doughnut, scatter, bubble, and radar chart families. The pass matched Walnut's chart option default-presence rules, omitted scatter/bubble category extraction from `c:xVal`, and preserved axis tick defaults; decoded protocol diff is zero for the fixture.
- Inspected the extracted Walnut workbook bundle for performance-sensitive layout choices. The key architecture signal is worker-backed canvas rendering plus prefix-sum viewport math; Routa should avoid growing the debug preview into a DOM-table renderer for large sheets.
- Added `xlsx_surface_chart_contract.xlsx` and included `C.SurfaceChartSeries` in XLSX chart series extraction. Surface charts now preserve Walnut-equivalent decoded protocol for chart type, series names/categories/values, and `surfaceOptions.wireframe`.

## Remaining XLSX Work

- Next decoded-protocol fixture expansion should cover external links if Walnut exposes them and broader theme/style combinations. Sheet-level `timelines` should be revisited with a real Excel-authored timeline fixture because the minimal OpenXML fixture only produces Walnut root `timelineCaches`.
- Precise table styles: table headers, row/column stripe flags, first/last column emphasis, totals rows, and theme-derived stripe colors are now projected from protocol table style metadata. Exact built-in Excel table style definitions beyond the common medium styles still need wider fixture coverage.
- Icon-set details: Risk icons now honor `cfvo` type/value for `min`, `max`, `num`, `percent`, `percentile`, plus `gte`, `reverse`, `showValue`, and common rating/arrows/traffic/symbol icon families. Custom icon-image payloads are not supported.
- Chart fidelity: Fitness charts now use a zero baseline, explicit Excel-like tick values, gridlines, plot margins, marker styling, and marker-aware legends. Protocol coverage now includes line, bar, area, pie, doughnut, scatter, bubble, radar, and surface families; remaining chart work is deeper Excel layout parity for plot-area auto sizing and number formats.
- Drawing overlays: sheet drawing chart/shape/image anchors, workbook image payloads, Walnut-style image references, sheet drawing order, and shape effect metadata are now consumed by the preview. Image crop is not currently representable in the Walnut spreadsheet `Drawing` schema based on the cropped-image probe.
- Freeze panes and sticky headers: the prefix-sum layout adapter now drives fixed headers, frozen body overlays, viewport projection, and cell hit regions. Remaining work is extracting freeze panes from a future protocol source, viewport virtualization, and floating-element hit regions.
- Conditional formatting breadth: data bars now support negative values, explicit axis placement, and gradient/solid variants. Color scales now use cfvo thresholds for multi-stop interpolation; multi-rule layering still needs more coverage.
- Protocol coverage: `complex_excel_renderer_test.xlsx`, `xlsx_image_drawing_contract.xlsx`, `xlsx_sparkline_contract.xlsx`, `xlsx_defined_names_contract.xlsx`, `xlsx_comments_contract.xlsx`, `xlsx_threaded_comments_contract.xlsx`, `xlsx_pivot_contract.xlsx`, `xlsx_slicer_contract.xlsx`, `xlsx_timeline_contract.xlsx`, `xlsx_multi_chart_contract.xlsx`, and `xlsx_surface_chart_contract.xlsx` now pass decoded Walnut Workbook protocol diff with zero field-level differences. Remaining work is raw protobuf byte exactness, understanding whether byte drift matters for downstream consumers, and adding more XLSX fixtures for sheet-level timelines, external links, and richer theme/style combinations.

## References

- `docs/issues/2026-05-01-office-document-viewer-wasm-reader.md`
