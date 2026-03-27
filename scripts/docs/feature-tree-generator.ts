#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { fromRoot } from "../lib/paths";
import { loadYamlFile } from "../lib/yaml";

type RouteInfo = {
  route: string;
  title: string;
  description: string;
};

type ApiFeature = {
  path: string;
  method: string;
  operationId: string;
  summary: string;
};

type FeatureNode = {
  id?: string;
  name: string;
  description?: string;
  route?: string;
  path?: string;
  count?: number;
  children?: FeatureNode[];
};

type FeatureTree = {
  name: string;
  description: string;
  children: FeatureNode[];
};

type OpenApiMethod = {
  operationId?: string;
  summary?: string;
};

type OpenApiDoc = {
  paths?: Record<string, Record<string, OpenApiMethod>>;
};

const API_CONTRACT = fromRoot("api-contract.yaml");
const APP_DIR = fromRoot("src", "app");
const OUTPUT_MD = fromRoot("docs", "product-specs", "FEATURE_TREE.md");

export function parsePageComment(content: string): { title: string | null; description: string | null } {
  const match = content.match(/\/\*\*\s*(.*?)\s*\*\//s);
  if (!match) {
    return { title: null, description: null };
  }

  const lines = match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^\*\s?/, ""))
    .filter(Boolean);
  if (lines.length === 0) {
    return { title: null, description: null };
  }

  const titleLine = lines[0];
  const titleMatch = titleLine.match(/^(.+?)\s*[-—]\s*\/.*$/);
  const title = titleMatch ? titleMatch[1].trim() : titleLine;
  const description = lines
    .slice(1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return { title, description: description || null };
}

function formatRouteSegment(segment: string): string {
  let normalized = segment.trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith(":")) {
    normalized = normalized.slice(1);
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const inner = normalized.slice(1, -1).replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return inner.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return normalized.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function scanFrontendRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.name !== "page.tsx") {
        continue;
      }
      if (fullPath.includes(`${path.sep}api${path.sep}`)) {
        continue;
      }

      const relDir = path.relative(APP_DIR, path.dirname(fullPath));
      let route = `/${relDir.replace(/\\/g, "/")}`;
      if (route === "/") {
        route = "/";
      } else if (route === "/.") {
        route = "/";
      }
      route = route.replace(/\[([^\]]+)\]/g, ":$1");

      const content = fs.readFileSync(fullPath, "utf8");
      const parsed = parsePageComment(content);
      let title = parsed.title?.trim();

      if (!title) {
        if (route === "/") {
          title = "Home";
        } else {
          const pathSegments = relDir.split(path.sep).filter(Boolean);
          const staticSegments = pathSegments
            .filter((segment) => !(segment.startsWith("[") && segment.endsWith("]")))
            .map(formatRouteSegment)
            .filter(Boolean);
          title = staticSegments.slice(-2).join(" / ").trim() || formatRouteSegment(pathSegments.at(-1) ?? "") || "Page";
        }
      }

      routes.push({
        route,
        title,
        description: parsed.description ?? "",
      });
    }
  }

  walk(APP_DIR);
  return routes.sort((left, right) => left.route.localeCompare(right.route));
}

export function extractApiFeatures(apiContract: OpenApiDoc | null): Record<string, ApiFeature[]> {
  if (!apiContract?.paths) {
    return {};
  }

  const domains = new Map<string, ApiFeature[]>();
  for (const [apiPath, methods] of Object.entries(apiContract.paths)) {
    const match = apiPath.match(/^\/api\/([^/]+)/);
    if (!match) {
      continue;
    }
    const domain = match[1];
    const domainFeatures = domains.get(domain) ?? [];
    for (const [method, spec] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }
      domainFeatures.push({
        path: apiPath,
        method: method.toUpperCase(),
        operationId: spec.operationId ?? "",
        summary: spec.summary ?? "",
      });
    }
    domains.set(domain, domainFeatures);
  }

  return Object.fromEntries([...domains.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function buildFeatureTree(routes: RouteInfo[], apiFeatures: Record<string, ApiFeature[]>): FeatureTree {
  const routesNode: FeatureNode = {
    id: "routes",
    name: "Frontend Pages",
    description: `${routes.length} user-facing pages`,
    children: routes.map((route) => ({
      id: route.route,
      name: route.title,
      route: route.route,
      description: route.description,
    })),
  };

  const domainNames: Record<string, string> = {
    health: "Health",
    agents: "Agents",
    tasks: "Tasks",
    notes: "Notes",
    workspaces: "Workspaces",
    sessions: "Sessions",
    acp: "ACP",
    mcp: "MCP",
    a2a: "A2A",
    skills: "Skills",
    clone: "Clone",
    github: "GitHub",
  };

  const apiNode: FeatureNode = {
    id: "api",
    name: "API Endpoints",
    description: `${Object.values(apiFeatures).reduce((count, features) => count + features.length, 0)} REST endpoints`,
    children: Object.entries(apiFeatures).map(([domain, endpoints]) => ({
      id: `api.${domain}`,
      name: domainNames[domain] ?? domain.replace(/\b\w/g, (char) => char.toUpperCase()),
      count: endpoints.length,
      children: endpoints.map((endpoint) => ({
        id: endpoint.operationId,
        name: endpoint.summary ? `${endpoint.method} ${endpoint.summary}` : `${endpoint.method} ${endpoint.path}`,
        path: endpoint.path,
      })),
    })),
  };

  return {
    name: "Routa.js",
    description: "Multi-agent coordination platform",
    children: [routesNode, apiNode],
  };
}

export function renderMarkdown(tree: FeatureTree): string {
  const lines: string[] = [
    "---",
    "status: generated",
    "purpose: Auto-generated route and API surface index for Routa.js.",
    "sources:",
    "  - src/app/**/page.tsx",
    "  - api-contract.yaml",
    "update_policy:",
    "  - Regenerate with `node --import tsx scripts/docs/feature-tree-generator.ts --save`.",
    "  - Do not hand-edit generated endpoint or route tables.",
    "---",
    "",
    `# ${tree.name} — Product Feature Specification`,
    "",
    `${tree.description}. This document is auto-generated from:`,
    "- Frontend routes: `src/app/**/page.tsx`",
    "- API contract: `api-contract.yaml`",
    "",
    "---",
    "",
  ];

  for (const section of tree.children) {
    if (section.id === "routes") {
      lines.push("## Frontend Pages", "", "| Page | Route | Description |", "|------|-------|-------------|");
      for (const page of section.children ?? []) {
        const description = (page.description ?? "").slice(0, 80);
        const normalizedDescription = description && !description.endsWith(".")
          ? (description.includes(".") ? description.split(".")[0] : description)
          : description;
        lines.push(`| ${page.name} | \`${page.route ?? ""}\` | ${normalizedDescription} |`);
      }
      lines.push("", "---", "");
      continue;
    }

    if (section.id === "api") {
      lines.push("## API Endpoints", "");
      for (const domain of section.children ?? []) {
        lines.push(`### ${domain.name} (${domain.count ?? (domain.children?.length ?? 0)})`, "");
        lines.push("| Method | Endpoint | Description |", "|--------|----------|-------------|");
        for (const endpoint of domain.children ?? []) {
          const [method = "?", ...rest] = endpoint.name.split(" ");
          lines.push(`| ${method} | \`${endpoint.path ?? ""}\` | ${rest.join(" ")} |`);
        }
        lines.push("");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderMermaid(tree: FeatureTree): string {
  const lines = ["mindmap", `  root((${tree.name}))`];

  const addNode = (node: FeatureNode, depth = 2): void => {
    const indent = "  ".repeat(depth);
    const name = node.name.replace(/\(/g, "[").replace(/\)/g, "]").replace(/"/g, "'");
    lines.push(`${indent}${name}`);
    for (const child of node.children ?? []) {
      addNode(child, depth + 1);
    }
  };

  for (const child of tree.children) {
    addNode(child);
  }

  return lines.join("\n");
}

function printTreeTable(tree: FeatureTree): void {
  console.log("=".repeat(100));
  console.log("🌳 FEATURE TREE REPORT");
  console.log("=".repeat(100));
  console.log("");

  const printNode = (node: FeatureNode, prefix = "", isLast = true): void => {
    const connector = isLast ? "└── " : "├── ";
    console.log(`${prefix}${connector}${node.path ? `${node.name} [${node.path}]` : node.name}`);
    const children = node.children ?? [];
    for (const [index, child] of children.entries()) {
      printNode(child, `${prefix}${isLast ? "    " : "│   "}`, index === children.length - 1);
    }
  };

  console.log(`📦 ${tree.name}`);
  console.log(`   ${tree.description}`);
  console.log("");
  for (const [index, child] of tree.children.entries()) {
    printNode(child, "", index === tree.children.length - 1);
  }

  const countNodes = (node: FeatureNode | FeatureTree): number =>
    1 + (node.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

  console.log("");
  console.log("-".repeat(100));
  console.log(`📊 Total features: ${countNodes(tree) - 1}`);
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const routes = scanFrontendRoutes();
  const apiContract = loadYamlFile<OpenApiDoc>(API_CONTRACT);
  const tree = buildFeatureTree(routes, extractApiFeatures(apiContract));

  if (args.has("--json")) {
    console.log(JSON.stringify(tree, null, 2));
    return;
  }
  if (args.has("--mermaid")) {
    console.log(renderMermaid(tree));
    return;
  }
  if (args.has("--save")) {
    fs.mkdirSync(path.dirname(OUTPUT_MD), { recursive: true });
    fs.writeFileSync(OUTPUT_MD, renderMarkdown(tree), "utf8");
    console.log(`✅ Saved to ${OUTPUT_MD}`);
    return;
  }
  printTreeTable(tree);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
