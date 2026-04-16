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

export type FeatureSurfaceIndex = {
  generatedAt: string;
  pages: FeatureSurfacePage[];
  apis: FeatureSurfaceApi[];
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

function emptyResponse(repoRoot: string, warnings: string[] = []): FeatureSurfaceIndexResponse {
  return {
    generatedAt: "",
    pages: [],
    apis: [],
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
    repoRoot,
    warnings: [],
  };
}
