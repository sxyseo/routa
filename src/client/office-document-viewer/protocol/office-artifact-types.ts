export type OfficeArtifactKind = "csv" | "tsv" | "docx" | "pptx" | "xlsx";

export type OfficeWasmArtifactKind = Extract<OfficeArtifactKind, "docx" | "pptx" | "xlsx">;

export interface RoutaOfficeTextBlock {
  path: string;
  text: string;
}

export interface RoutaOfficeCell {
  address: string;
  text: string;
  formula: string;
}

export interface RoutaOfficeRow {
  cells: RoutaOfficeCell[];
}

export interface RoutaOfficeSheet {
  name: string;
  rows: RoutaOfficeRow[];
  mergedRanges: RoutaOfficeMergedRange[];
  tables: RoutaOfficeSheetTable[];
  dataValidations: RoutaOfficeDataValidation[];
  conditionalFormats: RoutaOfficeConditionalFormat[];
}

export interface RoutaOfficeTable {
  path: string;
  rows: RoutaOfficeRow[];
}

export interface RoutaOfficeSlide {
  index: number;
  title: string;
  textBlocks: RoutaOfficeTextBlock[];
}

export interface RoutaOfficeDiagnostic {
  level: string;
  message: string;
}

export interface RoutaOfficeImageAsset {
  id: string;
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface RoutaOfficeChart {
  id: string;
  path: string;
  title: string;
  chartType: string;
}

export interface RoutaOfficeMergedRange {
  reference: string;
}

export interface RoutaOfficeSheetTable {
  name: string;
  reference: string;
}

export interface RoutaOfficeDataValidation {
  type: string;
  operator: string;
  formula1: string;
  formula2: string;
  ranges: string[];
}

export interface RoutaOfficeConditionalFormat {
  type: string;
  priority: number;
  ranges: string[];
}

export interface RoutaOfficeArtifact {
  sourceKind: string;
  title: string;
  textBlocks: RoutaOfficeTextBlock[];
  sheets: RoutaOfficeSheet[];
  slides: RoutaOfficeSlide[];
  diagnostics: RoutaOfficeDiagnostic[];
  metadata: Record<string, string>;
  images: RoutaOfficeImageAsset[];
  tables: RoutaOfficeTable[];
  charts: RoutaOfficeChart[];
}

export function emptyRoutaOfficeArtifact(): RoutaOfficeArtifact {
  return {
    charts: [],
    diagnostics: [],
    images: [],
    metadata: {},
    sheets: [],
    slides: [],
    sourceKind: "",
    tables: [],
    textBlocks: [],
    title: "",
  };
}
