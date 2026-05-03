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
- Added prefix-sum visible range lookup with binary search and wired the debug spreadsheet grid to render only the visible rows/columns plus merge-start overscan. This keeps the current DOM preview aligned with Walnut's viewport model while avoiding full-sheet cell/header rendering for larger workbooks.
- Probed an XLSX workbook with an external link part. Walnut does not currently expose that part as a root `contentReferences` item, but it does omit inferred numeric `dataType` for external-workbook formula cells; `xlsx_external_link_contract.xlsx` now locks that decoded protocol behavior.
- Centralized floating drawing geometry in the layout adapter: chart/shape/image overlays now share anchor-to-pixel bounds, and floating hit regions can be segmented across frozen rows/columns with the same prefix-sum viewport math.
- Ran the real production XLSX corpus in `/Users/phodal/Downloads/excel` against Walnut decoded Workbook protocol without committing any of those files. The corpus has 21 XLSX files; all 21 now parse successfully, and 3 files currently have zero decoded protocol differences.
- Fixed production-corpus protocol blockers and high-frequency defaults: invalid OpenXML color attribute reads, larger row caps for production sheets, raw text preservation for formulas/comments/validations/sparklines/defined names, explicit OpenXML cell data types, rich shared-string paragraphs/runs, theme and ARGB color preservation, sheet tab colors, sheet-name whitespace, builtin style id 0 omission, empty border-side preservation, shared-string raw-index fallback, and sheet-level shared formula anchors.
- Latest production-corpus decoded diff snapshot: `Copy of Appendix 1_2024 ePayments Reqs.xlsx`, `Copy of JC Penny  - Vendor Onboarding Questionnaire_.xlsx`, and `Copy of Thoughtworks foundational elements & sensible defaults.xlsx` are at `0` decoded diffs. All remaining per-file decoded diffs now range from `1` to `170`; `Thoughtworks Org Chart.xlsx` dropped from `6,231,341` diffs to `170` after aligning image payload selection, wide-row extraction, and shape `xfrm` bbox/type defaults.
- The production-corpus top remaining paths are now font/style defaults (`styles.fonts[].fontSize`, font colors, typeface, bold/underline/scheme), rich text inherited bold in shared-string runs, and XLSX drawing shape protocol (`shape.paragraphs`, `shape.textStyle`, shape line/connectors). Workbook image payload selection now follows anchor-referenced image order and deduplicates to Walnut's image set for the Org Chart workbook (`Routa images=15`, `Walnut images=15`).
- Added XLSX worksheet shape paragraph/run/body text-style protocol extraction while preserving Walnut's slicer-shape special defaults and text/shape element type split. The fixture suite still passes decoded Walnut protocol diff with zero field-level differences.
- Re-ran the production XLSX corpus after shape text extraction: 21/21 files parse, 3 files remain at `0` decoded diffs, and the current maximum is `178` decoded diffs. The max rose slightly because the newly emitted shape text now exposes deeper Walnut differences for paragraph `spaceBefore`/`spaceAfter`, bullet characters, `autoFit.noAutofit`, connector defaults, no-fill line defaults, and rich shape run splitting in DTA templates.
- Aligned worksheet shape paragraph zero spacing, bullet characters, body `noAutofit`, connector line-end defaults, and no-fill line serialization. The production corpus still parses 21/21 files, 3 files remain at `0` decoded diffs, and the maximum decoded diff dropped from `178` to `146`; high-frequency remaining paths are now dominated by workbook font/style ordering and shared-string inherited run styles.
- Aligned the remaining production-corpus XLSX decoded protocol gaps against Walnut: preserved empty `<font/>` entries in stylesheet font order, matched Walnut's shared-string run bold handling for `<b val="0"/>`, emitted shape `a:br` as newline runs without inherited styles, normalized text-box vs bare-shape `type`, preserved empty shape fills, normalized cell style `index`/`builtinId`, emitted spreadsheet color tint transforms and indexed font colors, and matched Walnut connector line-style cap/join defaults by shape geometry.
- Re-ran `/Users/phodal/Downloads/excel` as a validation-only production corpus after the final protocol pass: 21/21 XLSX files parse successfully, 21/21 report `0` decoded Workbook protocol diffs against Walnut, and there are no remaining decoded diff paths in `/tmp/xlsx-production-walnut-diff-summary.json`.
- Tightened conditional-format preview semantics for layered rules by honoring `stopIfTrue` on matched format rules, so higher-priority Excel rules can block lower-priority visual overrides in the debug renderer.
- Expanded conditional-format preview rule coverage for common Excel text and cell comparison variants, including `beginsWith`, `endsWith`, `notContainsText`, blank/nonblank checks, `notEqual`, `between`, and `notBetween`.

## Remaining XLSX Work

Current status after the latest pass:

- Decoded Workbook protocol parity is green for every committed XLSX fixture and for the 21-file validation-only production corpus in `/Users/phodal/Downloads/excel`.
- The committed render-contract suite is also green for the core workbook, image drawing, sparkline, multi-chart, and surface-chart fixtures.
- Recent preview additions cover visible overlays for `sparklineGroups`, notes/threaded comment targets, data-validation dropdown/validation markers, sheet `tabColor`, and sheet-level slicer fallback shapes.
- `src/app/debug/office-wasm-poc/spreadsheet-preview.tsx` was split so cell overlays live in `spreadsheet-cell-overlays.tsx`; the main preview file is back under the file-budget limit.

Remaining gaps are now narrower and mostly fall into deeper fidelity or production renderer architecture:

- Raw protobuf byte exactness: decoded protocol is equivalent, but serialized bytes are not guaranteed byte-identical. This only matters if a downstream consumer compares raw bytes instead of decoded fields.
- Pixel-level chart fidelity: chart protocol and preview coverage now include line, bar, area, pie, doughnut, scatter, bubble, radar, and surface families; remaining work is Excel/Walnut internal layout parity for plot-area auto sizing, typography, data labels, trendlines/error bars, multi-axis/combo charts, and detailed chart style inheritance.
- Exact built-in table styles: table headers, row/column stripes, first/last column emphasis, totals rows, and theme-derived palettes are projected. The remaining gap is full Excel built-in table style definitions and richer theme/table-style fixture coverage beyond the common medium styles.
- Conditional formatting breadth: color scales, data bars, icon sets, common text/cell rules, negative data bars, explicit axes, cfvo thresholds, and `stopIfTrue` precedence for matched format rules are handled. Remaining work is wider precedence coverage across less-common Excel conditional-format rule families such as top/bottom, above/below average, duplicate/unique, and formula-driven custom rules.
- Freeze panes: the layout adapter and preview can render frozen body/header regions when a sheet supplies `freezePanes`. Remaining work is extracting freeze-pane state if/when the Walnut-like XLSX protocol exposes it for real workbooks, plus pointer/edit/resize hit-region behavior around frozen panes.
- Timeline/slicer/pivot interactivity: slicer and timeline protocol fixtures pass, and slicers now get a visual fallback overlay. Remaining work is production interaction semantics such as filtering, active item states, pivot expand/collapse/drill behavior, and a real Excel-authored sheet-level timeline fixture.
- Drawing edge cases: image/shape/chart anchors, workbook image payloads, Walnut image references, drawing order, and shadow effects are consumed. Image crop appears absent from Walnut's spreadsheet `Drawing` schema based on the crop probe; remaining drawing work is richer shape geometry/effects and any future schema additions rather than current decoded-protocol parity.
- Renderer architecture: the current DOM viewport is virtualized and frame-coalesced, but it is still not Walnut's worker-backed canvas architecture. Production-grade parity would require a canvas/worker renderer, narrowed external-store snapshots, and richer selection/pointer/editor controller boundaries.
- Coverage expansion: add safe synthetic fixtures for richer theme/table-style combinations, layered conditional-format precedence, real sheet-level timelines, and more chart styling variants. Production files under `/Users/phodal/Downloads/excel` remain validation-only and must not be committed.

## References

- `docs/issues/2026-05-01-office-document-viewer-wasm-reader.md`
