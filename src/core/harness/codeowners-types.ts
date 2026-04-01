export type OwnerKind = "user" | "team" | "email";

export type CodeownersOwner = {
  name: string;
  kind: OwnerKind;
};

export type CodeownersRule = {
  pattern: string;
  owners: CodeownersOwner[];
  line: number;
  precedence: number;
};

export type OwnershipMatch = {
  filePath: string;
  owners: CodeownersOwner[];
  matchedRule: CodeownersRule | null;
  overlap: boolean;
  covered: boolean;
};

export type OwnerGroupSummary = {
  name: string;
  kind: OwnerKind;
  matchedFileCount: number;
};

export type OwnershipCoverageReport = {
  totalFilesInspected: number;
  unownedFiles: string[];
  overlappingFiles: string[];
  sensitiveUnownedFiles: string[];
  ownerGroups: OwnerGroupSummary[];
};

export type CodeownersResponse = {
  generatedAt: string;
  repoRoot: string;
  codeownersFile: string | null;
  owners: OwnerGroupSummary[];
  rules: Array<{
    pattern: string;
    owners: string[];
    line: number;
    precedence: number;
  }>;
  coverage: {
    unownedFiles: string[];
    overlappingFiles: string[];
    sensitiveUnownedFiles: string[];
  };
  warnings: string[];
};
