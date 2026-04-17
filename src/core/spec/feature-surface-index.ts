import { promises as fsp } from "fs";
import * as path from "path";

export type FeatureSurfacePage = {
  route: string;
  title: string;
  description: string;
  sourceFile: string;
};

export type FeatureSurfaceApi = {
  domain: string;
  method: string;
  path: string;
  operationId: string;
  summary: string;
};

export type FeatureSurfaceMetadataGroup = {
  id: string;
  name: string;
  description?: string;
};

export type FeatureSurfaceMetadataItem = {
  id: string;
  name: string;
  group?: string;
  summary?: string;
  pages?: string[];
  apis?: string[];
  domainObjects?: string[];
  relatedFeatures?: string[];
  sourceFiles?: string[];
  screenshots?: string[];
  status?: string;
};

export type FeatureSurfaceMetadata = {
  schemaVersion: number;
  capabilityGroups: FeatureSurfaceMetadataGroup[];
  features: FeatureSurfaceMetadataItem[];
};

export type FeatureSurfaceIndex = {
  generatedAt: string;
  pages: FeatureSurfacePage[];
  apis: FeatureSurfaceApi[];
  metadata: FeatureSurfaceMetadata | null;
};

export type FeatureSurfaceIndexResponse = FeatureSurfaceIndex & {
  repoRoot: string;
  warnings: string[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toPage(value: unknown): FeatureSurfacePage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const route = normalizeString((value as { route?: unknown }).route);
  const title = normalizeString((value as { title?: unknown }).title);
  if (!route || !title) {
    return null;
  }

  return {
    route,
    title,
    description: normalizeString((value as { description?: unknown }).description),
    sourceFile: normalizeString((value as { sourceFile?: unknown }).sourceFile),
  };
}

function toApi(value: unknown): FeatureSurfaceApi | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const domain = normalizeString((value as { domain?: unknown }).domain);
  const method = normalizeString((value as { method?: unknown }).method);
  const endpointPath = normalizeString((value as { path?: unknown }).path);
  if (!domain || !method || !endpointPath) {
    return null;
  }

  return {
    domain,
    method,
    path: endpointPath,
    operationId: normalizeString((value as { operationId?: unknown }).operationId),
    summary: normalizeString((value as { summary?: unknown }).summary),
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function toMetadataGroup(value: unknown): FeatureSurfaceMetadataGroup | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = normalizeString((value as { id?: unknown }).id);
  const name = normalizeString((value as { name?: unknown }).name);
  if (!id || !name) {
    return null;
  }

  const description = normalizeString((value as { description?: unknown }).description);
  return {
    id,
    name,
    ...(description ? { description } : {}),
  };
}

function toMetadataItem(value: unknown): FeatureSurfaceMetadataItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = normalizeString((value as { id?: unknown }).id);
  const name = normalizeString((value as { name?: unknown }).name);
  if (!id || !name) {
    return null;
  }

  const group = normalizeString((value as { group?: unknown }).group);
  const summary = normalizeString((value as { summary?: unknown }).summary);
  const status = normalizeString((value as { status?: unknown }).status);
  const pages = toStringArray((value as { pages?: unknown }).pages);
  const apis = toStringArray((value as { apis?: unknown }).apis);
  const domainObjects = toStringArray((value as { domainObjects?: unknown }).domainObjects);
  const relatedFeatures = toStringArray((value as { relatedFeatures?: unknown }).relatedFeatures);
  const sourceFiles = toStringArray((value as { sourceFiles?: unknown }).sourceFiles);
  const screenshots = toStringArray((value as { screenshots?: unknown }).screenshots);

  return {
    id,
    name,
    ...(group ? { group } : {}),
    ...(summary ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(pages.length > 0 ? { pages } : {}),
    ...(apis.length > 0 ? { apis } : {}),
    ...(domainObjects.length > 0 ? { domainObjects } : {}),
    ...(relatedFeatures.length > 0 ? { relatedFeatures } : {}),
    ...(sourceFiles.length > 0 ? { sourceFiles } : {}),
    ...(screenshots.length > 0 ? { screenshots } : {}),
  };
}

function toMetadata(value: unknown): FeatureSurfaceMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const schemaVersion = Number((value as { schemaVersion?: unknown }).schemaVersion);
  const capabilityGroups = Array.isArray((value as { capabilityGroups?: unknown }).capabilityGroups)
    ? (value as { capabilityGroups: unknown[] }).capabilityGroups.map(toMetadataGroup).filter((item): item is FeatureSurfaceMetadataGroup => Boolean(item))
    : [];
  const features = Array.isArray((value as { features?: unknown }).features)
    ? (value as { features: unknown[] }).features.map(toMetadataItem).filter((item): item is FeatureSurfaceMetadataItem => Boolean(item))
    : [];

  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0 ? schemaVersion : 1,
    capabilityGroups,
    features,
  };
}

function emptyResponse(repoRoot: string, warnings: string[] = []): FeatureSurfaceIndexResponse {
  return {
    generatedAt: "",
    pages: [],
    apis: [],
    metadata: null,
    repoRoot,
    warnings,
  };
}

export async function readFeatureSurfaceIndex(repoRoot: string): Promise<FeatureSurfaceIndexResponse> {
  const indexPath = path.join(repoRoot, "docs", "product-specs", "feature-tree.index.json");

  let raw: string;
  try {
    raw = await fsp.readFile(indexPath, "utf-8");
  } catch {
    return emptyResponse(repoRoot, [`Feature surface index not found at ${path.relative(repoRoot, indexPath)}`]);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return emptyResponse(repoRoot, [`Feature surface index is not valid JSON at ${path.relative(repoRoot, indexPath)}`]);
  }

  const pages = Array.isArray((payload as { pages?: unknown }).pages)
    ? ((payload as { pages: unknown[] }).pages.map(toPage).filter((item): item is FeatureSurfacePage => Boolean(item)))
    : [];
  const apis = Array.isArray((payload as { apis?: unknown }).apis)
    ? ((payload as { apis: unknown[] }).apis.map(toApi).filter((item): item is FeatureSurfaceApi => Boolean(item)))
    : [];

  return {
    generatedAt: normalizeString((payload as { generatedAt?: unknown }).generatedAt),
    pages,
    apis,
    metadata: toMetadata((payload as { metadata?: unknown }).metadata),
    repoRoot,
    warnings: [],
  };
}
