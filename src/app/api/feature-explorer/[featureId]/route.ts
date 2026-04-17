import { NextRequest, NextResponse } from "next/server";
import {
  buildFileTree,
  isContextError,
  parseContext,
  parseFeatureTree,
  resolveRepoRoot,
  tryProxyToRustBackend,
} from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function splitDeclaredApi(declaration: string): { method: string; endpoint: string } {
  const [method, endpoint] = declaration.split(/\s+/, 2);
  if (endpoint) {
    return { method, endpoint };
  }
  return { method: "GET", endpoint: declaration };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  const { featureId } = await params;

  // Try proxying to routa-server first
  const qs = request.nextUrl.searchParams.toString();
  const proxied = await tryProxyToRustBackend(`/${encodeURIComponent(featureId)}`, qs);
  if (proxied) return proxied;

  try {
    const context = parseContext(request.nextUrl.searchParams);
    const repoRoot = await resolveRepoRoot(context);
    const { features, frontendPages, apiEndpoints } = parseFeatureTree(repoRoot);

    const feature = features.find((f) => f.id === featureId);
    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found", featureId },
        { status: 404 },
      );
    }

    const allFiles = [...feature.source_files].sort();
    const fileTree = buildFileTree(allFiles);

    const pageDetails = feature.pages.map((route) => {
      const matched = frontendPages.find((page) => page.route === route);
      return matched ?? { name: route, route, description: "" };
    });

    const apiDetails = feature.apis.map((declaration) => {
      const parsed = splitDeclaredApi(declaration);
      const matched = apiEndpoints.find(
        (api) => api.method.toUpperCase() === parsed.method.toUpperCase() && api.endpoint === parsed.endpoint,
      );
      return matched ?? { group: "", method: parsed.method, endpoint: parsed.endpoint, description: "" };
    });

    const surfaceLinks = [
      ...feature.pages.map((route) => ({ kind: "Page", route, sourcePath: "" })),
      ...feature.apis.map((route) => ({ kind: "API", route, sourcePath: "" })),
    ];

    return NextResponse.json({
      id: feature.id,
      name: feature.name,
      group: feature.group,
      summary: feature.summary,
      status: feature.status,
      pages: feature.pages,
      apis: feature.apis,
      sourceFiles: allFiles,
      relatedFeatures: feature.related_features,
      domainObjects: feature.domain_objects,
      sessionCount: 0,
      changedFiles: allFiles.length,
      updatedAt: "-",
      fileTree,
      surfaceLinks,
      pageDetails,
      apiDetails,
      fileStats: {},
    });
  } catch (error) {
    const message = toMessage(error);
    if (isContextError(message)) {
      return NextResponse.json(
        { error: "Feature explorer context error", details: message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Feature explorer error", details: message },
      { status: 500 },
    );
  }
}
