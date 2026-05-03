import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type Page } from "playwright";

type SlideBitmap = {
  dataUrl: string;
  height: number;
  index: number;
  width: number;
};

const repoRoot = process.cwd();
const port = numberArg("--port") ?? 3000;
const startServer = process.argv.includes("--start-server");
const activeBaseUrl = stringArg("--base-url") ?? `http://127.0.0.1:${port}/debug/office-wasm-poc`;
const pptxPath = path.resolve(
  repoRoot,
  stringArg("--pptx") ??
    positionalArgs()[0] ??
    path.join(os.homedir(), "Downloads", "agentic_ui_proactive_agent_technical_blueprint.pptx"),
);
const outputPath = path.resolve(
  repoRoot,
  stringArg("--output") ??
    path.join(
      os.homedir(),
      ".cursor/projects/Users-phodal-ai-routa-js/canvases/office-wasm-ppt-renderer.canvas.tsx",
    ),
);

async function main(): Promise<void> {
  if (!existsSync(pptxPath)) {
    throw new Error(`PPTX not found: ${pptxPath}`);
  }

  const serverProcess = await ensureServer();
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const slides = await exportSlides(browser);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, renderCanvasSource(slides), "utf8");
      console.log(JSON.stringify({ outputPath, pptxPath, slideCount: slides.length }, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(serverProcess);
  }
}

async function exportSlides(browser: Browser): Promise<SlideBitmap[]> {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 1058, width: 2048 },
  });
  try {
    await loadPresentation(page);
    return await page.evaluate(`
      (async () => {
      const toDataUrl = async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      };

      const root = document.querySelector('[data-testid="presentation-preview"]');
      const images = Array.from(root?.querySelectorAll("aside img") ?? []);
      return await Promise.all(
        images.map(async (image, index) => ({
          dataUrl: await toDataUrl(image.currentSrc || image.src),
          height: image.naturalHeight,
          index: index + 1,
          width: image.naturalWidth,
        })),
      );
      })()
    `);
  } finally {
    await page.close();
  }
}

async function loadPresentation(page: Page): Promise<void> {
  const url = new URL(activeBaseUrl);
  url.searchParams.set("reader", "routa");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").setInputFiles(pptxPath);
  await page.getByTestId("presentation-preview").waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const root = document.querySelector('[data-testid="presentation-preview"]');
      return (root?.querySelectorAll("aside img").length ?? 0) >= 1 && (root?.querySelectorAll("canvas").length ?? 0) === 0;
    },
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1_000);
}

function renderCanvasSource(slides: SlideBitmap[]): string {
  const sourceLabel = path.basename(pptxPath);
  return `import {
  Button,
  Pill,
  Row,
  Stack,
  Text,
  useCanvasState,
  useHostTheme,
} from "cursor/canvas";

const artifact = ${JSON.stringify(
    {
      generatedBy: "scripts/office-wasm-reader/export-pptx-cursor-canvas.ts",
      reader: "Routa generated",
      shortTitle: shortenFileName(sourceLabel),
      source: pptxPath,
      title: sourceLabel,
    },
    null,
    2,
  )};

const slides = ${JSON.stringify(slides, null, 2)} as const;

export default function OfficeWasmPptRenderer() {
  const theme = useHostTheme();
  const [selectedIndex, setSelectedIndex] = useCanvasState("selected-slide-index", 1);
  const selectedSlide = slides.find((slide) => slide.index === selectedIndex) ?? slides[0];

  return (
    <div
      style={{
        background: theme.bg.editor,
        border: \`1px solid \${theme.stroke.secondary}\`,
        borderRadius: 8,
        color: theme.text.primary,
        display: "grid",
        gridTemplateRows: "52px minmax(0, 1fr)",
        height: "min(820px, calc(100vh - 40px))",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          alignItems: "center",
          borderBottom: \`1px solid \${theme.stroke.secondary}\`,
          display: "grid",
          gap: 12,
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 520px) minmax(0, 1fr)",
          padding: "0 16px",
        }}
      >
        <Row gap={12} align="center" style={{ minWidth: 0 }}>
          <Text size="small" tone="secondary" as="span">Select file</Text>
          <Pill size="sm" active tone="info">{artifact.shortTitle}</Pill>
          <Text size="small" tone="secondary" as="span">Reader</Text>
          <Pill size="sm" active>{artifact.reader}</Pill>
        </Row>
        <Row gap={8} align="center" justify="center" style={{ minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              alignItems: "center",
              background: theme.accent.primary,
              borderRadius: 5,
              color: theme.text.onAccent,
              display: "inline-flex",
              fontSize: 11,
              height: 18,
              justifyContent: "center",
              width: 18,
            }}
          >
            PPT
          </span>
          <Text size="small" weight="semibold" truncate as="span">{artifact.title}</Text>
        </Row>
        <Row gap={10} align="center" justify="end" style={{ minWidth: 0 }}>
          <Text size="small" weight="semibold" as="span">Status</Text>
          <Pill size="sm" tone="success" active>Ready</Pill>
          <Button variant="primary">Play Slideshow</Button>
        </Row>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "clamp(156px, 13vw, 252px) minmax(0, 1fr)",
          minHeight: 0,
        }}
      >
        <aside
          style={{
            borderRight: \`1px solid \${theme.stroke.secondary}\`,
            minHeight: 0,
            overflow: "auto",
            padding: "12px 14px 48px 8px",
          }}
        >
          <Stack gap={10}>
            {slides.map((slide) => (
              <button
                key={slide.index}
                onClick={() => setSelectedIndex(slide.index)}
                style={{
                  alignItems: "flex-start",
                  background: slide.index === selectedSlide.index ? theme.fill.secondary : "transparent",
                  border: \`1px solid \${slide.index === selectedSlide.index ? theme.accent.primary : "transparent"}\`,
                  borderRadius: 8,
                  color: theme.text.primary,
                  cursor: "pointer",
                  display: "flex",
                  gap: 8,
                  padding: "7px 8px 7px 0",
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                <Text
                  size="small"
                  tone="secondary"
                  as="span"
                  style={{
                    flex: "0 0 22px",
                    lineHeight: 1,
                    paddingTop: 4,
                    textAlign: "right",
                  }}
                >
                  {slide.index}
                </Text>
                <img
                  alt=""
                  src={slide.dataUrl}
                  style={{
                    aspectRatio: \`\${slide.width} / \${slide.height}\`,
                    border: \`1px solid \${theme.stroke.secondary}\`,
                    borderRadius: 4,
                    display: "block",
                    flex: "1 1 auto",
                    minWidth: 0,
                    objectFit: "contain",
                    width: "100%",
                  }}
                />
              </button>
            ))}
          </Stack>
        </aside>

        <main
          style={{
            background: theme.fill.primary,
            minHeight: 0,
            overflow: "auto",
            padding: "16px 24px 20px",
          }}
        >
          <div style={{ margin: "0 auto", maxWidth: 1703 }}>
            <img
              alt={\`Slide \${selectedSlide.index}\`}
              src={selectedSlide.dataUrl}
              style={{
                aspectRatio: \`\${selectedSlide.width} / \${selectedSlide.height}\`,
                background: theme.bg.elevated,
                border: \`1px solid \${theme.stroke.secondary}\`,
                borderRadius: 8,
                display: "block",
                objectFit: "contain",
                width: "100%",
              }}
            />
            <div
              style={{
                background: theme.bg.editor,
                border: \`1px solid \${theme.stroke.tertiary}\`,
                borderRadius: 8,
                marginTop: 16,
                padding: "12px 14px",
              }}
            >
              <Text size="small" tone="secondary">
                Slide {selectedSlide.index} / {slides.length} · rendered by the local Office WASM POC and embedded for Cursor Canvas.
              </Text>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
`;
}

function shortenFileName(fileName: string): string {
  if (fileName.length <= 24) return fileName;
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  return `${stem.slice(0, 14)}...${extension}`;
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await canReachDebugPage(activeBaseUrl)) {
    return null;
  }

  if (!startServer) {
    throw new Error(`Office WASM debug page is not reachable at ${activeBaseUrl}. Start the app or pass --start-server.`);
  }

  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode != null) {
      throw new Error(`Next dev server exited before ${activeBaseUrl} became reachable.`);
    }
    if (await canReachDebugPage(activeBaseUrl)) {
      return child;
    }
    await delay(1_000);
  }

  stopServer(child);
  throw new Error(`Timed out waiting for ${activeBaseUrl}.`);
}

async function canReachDebugPage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

function stopServer(child: ChildProcess | null): void {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
}

function numberArg(name: string): number | null {
  const value = stringArg(name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function positionalArgs(): string[] {
  return process.argv.slice(2).filter((arg, index, args) => {
    if (arg.startsWith("--")) return false;
    return !args[index - 1]?.startsWith("--");
  });
}

void main();
