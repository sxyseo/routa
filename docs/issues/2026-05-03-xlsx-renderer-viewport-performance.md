---
title: "XLSX renderer needs production-grade viewport performance"
date: "2026-05-03"
kind: issue
status: in_progress
severity: medium
area: ui
tags: [artifact-viewer, office-documents, xlsx, spreadsheet, performance, walnut]
reported_by: "human"
related_issues: ["2026-05-02-walnut-workbook-layout-adapter.md"]
github_issue: null
github_state: null
github_url: null
---

# XLSX renderer needs production-grade viewport performance

## What Happened

The XLSX reader now matches Walnut decoded Workbook protocol across the fixture suite and the validation-only production corpus in `/Users/phodal/Downloads/excel`, but the debug preview still renders spreadsheet cells with React DOM nodes. This is acceptable for the current POC and capped layouts, but it can become expensive as row/column caps are raised and more worksheet overlays are enabled.

## Expected Behavior

The viewer should keep Walnut-like viewport semantics without forcing every scroll event through expensive React work:

- stable layout, chart, image, shape, and conditional-format specs are memoized by workbook/sheet changes, not scroll changes
- visible cell rendering is limited to the current viewport plus overscan
- frozen panes render only visible frozen regions
- large worksheets can eventually move base grid drawing to a canvas or worker-backed canvas without changing the workbook protocol contract

## Walnut Reference

Walnut's extracted `PopcornElectronWorkbookPanel-BZz8NPb4.js` treats workbook rendering as a performance-sensitive viewport:

- workbook geometry is stored as `columnWidths` and `rowHeights`
- prefix sums map logical worksheet coordinates to screen/camera coordinates
- frozen panes, selections, floating elements, chart hover targets, and resize handles share the same coordinate system
- update paths are routed through a controller/worker boundary and coalesced with frame-based scheduling
- canvas-backed chart and worksheet interactions avoid full DOM-table layout

## Current Routa State

- `src/app/debug/office-wasm-poc/spreadsheet-layout.ts` already provides prefix sums, binary-search visible range lookup, frozen pane projection, floating hit regions, and drawing bounds.
- `src/app/debug/office-wasm-poc/spreadsheet-preview.tsx` renders only visible cells in the scrollable grid, but stable derived specs were previously rebuilt on scroll-triggered re-renders.
- Frozen body rendering still needs to avoid full layout traversal before row/column caps are raised.

## Progress

- Created this tracker after decoded XLSX protocol parity reached `0` field-level diffs against Walnut across all 21 validation-only production workbooks.
- Memoized root workbook derivation, active sheet layout, chart specs, shape specs, image specs, and conditional-format visuals in the debug spreadsheet preview so scroll updates do not rebuild stable workbook-derived structures.
- Changed the frozen body overlay to reuse the visible viewport range and merge-start overscan logic instead of traversing every row/column in the current layout.
- Verified the low-risk viewport pass with the spreadsheet frozen-header, chart, and shape unit tests plus targeted ESLint for `spreadsheet-preview.tsx`.

## Remaining Work

- Add stress fixtures or synthetic benchmark data for larger sheets without committing production files.
- Decide whether to keep a DOM viewport for debug-only usage or introduce a canvas/worker renderer for production workbook previews.

## References

- `docs/issues/2026-05-02-walnut-workbook-layout-adapter.md`
- `tmp/codex-app-analysis/extracted/webview/assets/PopcornElectronWorkbookPanel-BZz8NPb4.js`
