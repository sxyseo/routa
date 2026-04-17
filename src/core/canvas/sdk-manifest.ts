import sdkManifestJson from "../../../resources/canvas/canvas-sdk-manifest.json";

type CanvasSdkExportSymbol = {
  name: string;
  kind: "type" | "value";
};

type CanvasSdkExportGroup = {
  title: string;
  source: string | null;
  symbols: CanvasSdkExportSymbol[];
};

type CanvasSdkDefinitionFile = {
  path: string;
  source: string;
};

export type CanvasSdkManifest = {
  generatedAt: string;
  moduleSpecifier: string;
  sourceBarrel: string;
  definitionsDir: string;
  indexDefinitionPath: string;
  importExamples: string[];
  promptRules: string[];
  groups: CanvasSdkExportGroup[];
  allExports: CanvasSdkExportSymbol[];
  definitionFiles: CanvasSdkDefinitionFile[];
  indexDtsSource: string;
};

const canvasSdkManifest = sdkManifestJson as CanvasSdkManifest;

type CanvasSdkPromptDefinition = {
  file: string;
  functionName?: string;
  typeName?: string;
};

const PROMPT_DEFINITIONS: CanvasSdkPromptDefinition[] = [
  { file: "theme-context.d.ts", functionName: "useHostTheme" },
  { file: "theme-context.d.ts", typeName: "CanvasHostTheme" },
  { file: "primitives.d.ts", typeName: "StackProps" },
  { file: "primitives.d.ts", typeName: "RowProps" },
  { file: "primitives.d.ts", typeName: "GridProps" },
  { file: "primitives.d.ts", typeName: "TextProps" },
  { file: "data-display.d.ts", typeName: "TableProps" },
  { file: "data-display.d.ts", typeName: "StatProps" },
  { file: "data-display.d.ts", typeName: "PillProps" },
  { file: "containers.d.ts", typeName: "CardProps" },
  { file: "containers.d.ts", typeName: "CardHeaderProps" },
  { file: "containers.d.ts", typeName: "CardBodyProps" },
  { file: "controls.d.ts", typeName: "ButtonProps" },
  { file: "charts.d.ts", typeName: "BarChartEntry" },
  { file: "charts.d.ts", typeName: "BarChartProps" },
  { file: "charts.d.ts", typeName: "PieChartEntry" },
  { file: "charts.d.ts", typeName: "PieChartProps" },
];

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findDefinitionSource(fileName: string, manifest: CanvasSdkManifest): string | null {
  const match = manifest.definitionFiles.find((file) => file.path.endsWith(`/${fileName}`));
  return match?.source ?? null;
}

function extractFunctionSignature(source: string, functionName: string): string | null {
  const pattern = new RegExp(
    `export\\s+declare\\s+function\\s+${functionName}\\s*\\(([\\s\\S]*?)\\)\\s*:\\s*([^;]+);`,
    "m",
  );
  const match = source.match(pattern);
  if (!match) return null;
  return `${functionName}(${compactWhitespace(match[1])}): ${compactWhitespace(match[2])}`;
}

function extractTypeShape(source: string, typeName: string): string | null {
  const objectTypePattern = new RegExp(
    `export\\s+type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\};`,
    "m",
  );
  const objectTypeMatch = source.match(objectTypePattern);
  if (objectTypeMatch) {
    return `${typeName} = { ${compactWhitespace(objectTypeMatch[1])} }`;
  }

  const typePattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([^;]+);`, "m");
  const typeMatch = source.match(typePattern);
  if (typeMatch) {
    return `${typeName} = ${compactWhitespace(typeMatch[1])}`;
  }

  const interfacePattern = new RegExp(
    `export\\s+interface\\s+${typeName}\\s*\\{([\\s\\S]*?)\\}`,
    "m",
  );
  const interfaceMatch = source.match(interfacePattern);
  if (interfaceMatch) {
    return `${typeName} { ${compactWhitespace(interfaceMatch[1])} }`;
  }

  return null;
}

function buildCompactSdkSurface(manifest: CanvasSdkManifest): string[] {
  return PROMPT_DEFINITIONS.flatMap((definition) => {
    const source = findDefinitionSource(definition.file, manifest);
    if (!source) return [];

    const items = [
      definition.functionName ? extractFunctionSignature(source, definition.functionName) : null,
      definition.typeName ? extractTypeShape(source, definition.typeName) : null,
    ].filter((value): value is string => Boolean(value));

    return items.map((item) => `- ${item}`);
  });
}

export function getCanvasSdkManifest(): CanvasSdkManifest {
  return canvasSdkManifest;
}

export function buildCanvasSdkPromptSection(): string {
  const manifest = getCanvasSdkManifest();
  const promptPayload = {
    moduleSpecifier: manifest.moduleSpecifier,
    importExamples: manifest.importExamples,
    promptRules: manifest.promptRules,
    groups: manifest.groups.map((group) => ({
      title: group.title,
      source: group.source,
      symbols: group.symbols.map((symbol) => symbol.name),
    })),
  };
  const compactSurface = buildCompactSdkSurface(manifest);

  return [
    "Canvas SDK source of truth:",
    JSON.stringify(promptPayload, null, 2),
    "",
    "Compact API surface:",
    ...compactSurface,
  ].join("\n");
}
