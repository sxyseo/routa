import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";

type ReaderMode = "routa" | "walnut";

type SlideDiff = {
  averageDelta: number;
  changedPixelRatio: number;
  matches: boolean;
  maxDelta: number;
  referencePath: string;
  slideIndex: number;
  viewerPath: string;
};

type RenderComparisonResult = {
  fixture: string;
  outputDir: string;
  parity: {
    failures: string[];
    matchingSlides: number;
    slideCount: number;
  };
  reader: ReaderMode;
  slides: SlideDiff[];
};

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const assertMode = process.argv.includes("--assert");
const startServer = process.argv.includes("--start-server");
const verboseMode = process.argv.includes("--verbose");
const port = numberArg("--port") ?? 3000;
const baseUrl = stringArg("--base-url") ?? `http://127.0.0.1:${port}/debug/office-wasm-poc`;
const outputDir = path.resolve(stringArg("--output-dir") ?? "/tmp/routa-office-wasm-pptx-powerpoint-render");
const reader = readerArg("--reader") ?? "routa";
const changedPixelRatioTolerance = numberArg("--changed-ratio") ?? 0.42;
const averageDeltaTolerance = numberArg("--average-delta") ?? 38;
const fixturePaths = positionalArgs().map((arg) => path.resolve(repoRoot, arg));
let activeBaseUrl = baseUrl;

if (fixturePaths.length === 0) {
  fixturePaths.push(path.resolve(repoRoot, "tools/office-wasm-reader/fixtures/agentic_ui_proactive_agent_technical_blueprint.pptx"));
}

async function main(): Promise<void> {
  for (const fixturePath of fixturePaths) {
    assertFile(fixturePath, "PPTX fixture");
  }
  mkdirSync(outputDir, { recursive: true });

  const serverProcess = await ensureServer();
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const results: RenderComparisonResult[] = [];
      for (const fixturePath of fixturePaths) {
        results.push(await compareFixture(browser, fixturePath));
      }

      if (assertMode) {
        for (const result of results) {
          if (result.parity.failures.length > 0) {
            throw new Error(`${result.fixture} PowerPoint-like render comparison failed: ${result.parity.failures.join(", ")}`);
          }
          console.log(`ok ${result.fixture}`);
        }
        return;
      }

      console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(serverProcess);
  }
}

async function compareFixture(browser: Browser, fixturePath: string): Promise<RenderComparisonResult> {
  const fixtureLabel = safeFileLabel(fixturePath);
  const fixtureOutputDir = path.join(outputDir, fixtureLabel);
  rmSync(fixtureOutputDir, { force: true, recursive: true });
  mkdirSync(fixtureOutputDir, { recursive: true });

  const referencePaths = await renderPowerPointLikeReference(fixturePath, path.join(fixtureOutputDir, "reference"));
  const viewerPaths = await renderViewerSlides(browser, fixturePath, fixtureLabel, path.join(fixtureOutputDir, "viewer"));
  const slideCount = Math.min(referencePaths.length, viewerPaths.length);
  const slides: SlideDiff[] = [];
  for (let index = 0; index < slideCount; index++) {
    slides.push(await compareSlideImages(referencePaths[index]!, viewerPaths[index]!, index + 1));
  }

  const failures: string[] = [];
  if (referencePaths.length !== viewerPaths.length) {
    failures.push(`slide count differs: PowerPoint-like=${referencePaths.length}, viewer=${viewerPaths.length}`);
  }
  for (const slide of slides) {
    if (!slide.matches) {
      failures.push(
        `slide ${slide.slideIndex} changedRatio=${slide.changedPixelRatio.toFixed(4)}, averageDelta=${slide.averageDelta.toFixed(2)}, maxDelta=${slide.maxDelta}`,
      );
    }
  }

  return {
    fixture: path.relative(repoRoot, fixturePath),
    outputDir: fixtureOutputDir,
    parity: {
      failures,
      matchingSlides: slides.filter((slide) => slide.matches).length,
      slideCount,
    },
    reader,
    slides,
  };
}

async function renderPowerPointLikeReference(fixturePath: string, referenceDir: string): Promise<string[]> {
  mkdirSync(referenceDir, { recursive: true });
  const officeBin = commandPath("soffice") ?? commandPath("libreoffice");
  if (!officeBin) {
    throw new Error("Missing LibreOffice/soffice. Install LibreOffice or run without the PowerPoint-like visual comparison.");
  }
  const pdftoppmBin = commandPath("pdftoppm");
  if (!pdftoppmBin) {
    throw new Error("Missing pdftoppm. Install poppler to render the PowerPoint-like PDF reference.");
  }

  await execFileAsync(officeBin, ["--headless", "--convert-to", "pdf", "--outdir", referenceDir, fixturePath], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const pdfPath = findConvertedPdf(referenceDir, fixturePath);
  const prefix = path.join(referenceDir, "slide");
  await execFileAsync(pdftoppmBin, ["-png", "-r", "144", pdfPath, prefix], { maxBuffer: 10 * 1024 * 1024 });
  return readdirSync(referenceDir)
    .filter((entry) => /^slide-\d+\.png$/u.test(entry))
    .sort((left, right) => slideImageIndex(left) - slideImageIndex(right))
    .map((entry) => path.join(referenceDir, entry));
}

async function renderViewerSlides(
  browser: Browser,
  fixturePath: string,
  fixtureLabel: string,
  viewerDir: string,
): Promise<string[]> {
  mkdirSync(viewerDir, { recursive: true });
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 1058, width: 2048 } });
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (!isIgnoredConsoleMessage(text)) {
      consoleMessages.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  try {
    await loadPresentation(page, fixturePath, reader);
    const slideCount = await page.getByTestId("presentation-thumbnail").count();
    const screenshots: string[] = [];
    for (let index = 0; index < slideCount; index++) {
      await page.getByTestId("presentation-thumbnail").nth(index).click();
      await page.waitForTimeout(300);
      await page.getByTestId("presentation-slide-canvas").waitFor({ timeout: 15_000 });
      const screenshotPath = path.join(viewerDir, `${fixtureLabel}-${reader}-slide-${String(index + 1).padStart(2, "0")}.png`);
      await page.getByTestId("presentation-slide-canvas").screenshot({ path: screenshotPath });
      screenshots.push(screenshotPath);
    }

    if (consoleMessages.length > 0) {
      throw new Error(`viewer console errors: ${consoleMessages.join("; ")}`);
    }
    return screenshots;
  } finally {
    await page.close();
  }
}

async function loadPresentation(page: Page, fixturePath: string, mode: ReaderMode): Promise<void> {
  const url = new URL(activeBaseUrl);
  url.searchParams.set("reader", mode);
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").setInputFiles(fixturePath);
  await page.getByTestId("presentation-preview").waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () => (document.querySelectorAll('[data-testid="presentation-thumbnail"]').length ?? 0) > 0,
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1_000);
}

async function compareSlideImages(referencePath: string, viewerPath: string, slideIndex: number): Promise<SlideDiff> {
  const [reference, viewer] = await Promise.all([
    normalizedPixels(referencePath),
    normalizedPixels(viewerPath),
  ]);
  let changedPixels = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const channels = reference.info.channels;
  for (let index = 0; index < reference.data.length; index += channels) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 3; channel++) {
      pixelDelta = Math.max(pixelDelta, Math.abs(reference.data[index + channel] - viewer.data[index + channel]));
    }
    totalDelta += pixelDelta;
    if (pixelDelta > 35) {
      changedPixels += 1;
    }
    maxDelta = Math.max(maxDelta, pixelDelta);
  }

  const totalPixels = reference.info.width * reference.info.height;
  const averageDelta = totalDelta / totalPixels;
  const changedPixelRatio = changedPixels / totalPixels;
  return {
    averageDelta,
    changedPixelRatio,
    matches: changedPixelRatio <= changedPixelRatioTolerance && averageDelta <= averageDeltaTolerance,
    maxDelta,
    referencePath,
    slideIndex,
    viewerPath,
  };
}

async function normalizedPixels(filePath: string) {
  return sharp(filePath)
    .resize({ background: "#ffffff", fit: "fill", height: 720, width: 1280 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function ensureServer() {
  if (await canReachDebugPage(activeBaseUrl)) {
    return null;
  }

  if (!startServer) {
    throw new Error(`Office WASM debug page is not reachable at ${activeBaseUrl}. Start the app or pass --start-server.`);
  }

  const existingDefaultUrl = "http://127.0.0.1:3000/debug/office-wasm-poc";
  if (activeBaseUrl !== existingDefaultUrl && (await canReachDebugPage(existingDefaultUrl))) {
    activeBaseUrl = existingDefaultUrl;
    return null;
  }

  const child = (await import("node:child_process")).spawn(
    "npm",
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (verboseMode) {
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

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

function stopServer(child: { exitCode: number | null; kill: (signal: NodeJS.Signals) => void } | null): void {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
}

function commandPath(command: string): string | null {
  const candidates = [
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    `/usr/bin/${command}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return command;
}

function findConvertedPdf(referenceDir: string, fixturePath: string): string {
  const expected = path.join(referenceDir, `${path.basename(fixturePath, path.extname(fixturePath))}.pdf`);
  if (existsSync(expected)) return expected;
  const pdfs = readdirSync(referenceDir).filter((entry) => entry.toLowerCase().endsWith(".pdf"));
  if (pdfs.length === 1) return path.join(referenceDir, pdfs[0]!);
  throw new Error(`Could not find converted PDF for ${fixturePath} in ${referenceDir}`);
}

function slideImageIndex(fileName: string): number {
  const match = /-(\d+)\.png$/u.exec(fileName);
  return match ? Number(match[1]) : 0;
}

function readerArg(name: string): ReaderMode | null {
  const value = stringArg(name);
  return value === "walnut" || value === "routa" ? value : null;
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
  const args = process.argv.slice(2);
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      arg === "--average-delta" ||
      arg === "--base-url" ||
      arg === "--changed-ratio" ||
      arg === "--output-dir" ||
      arg === "--port" ||
      arg === "--reader"
    ) {
      index++;
      continue;
    }
    if (!arg?.startsWith("--")) {
      values.push(arg);
    }
  }
  return values;
}

function safeFileLabel(filePath: string): string {
  return (
    path
      .basename(filePath, path.extname(filePath))
      .replace(/[^a-z0-9._-]+/giu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || shortHash(filePath)
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function assertFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function isIgnoredConsoleMessage(text: string): boolean {
  return (
    text === "[HMR] connected" ||
    text === "[Fast Refresh] rebuilding" ||
    /^Last route changed in \d+ms$/u.test(text) ||
    /^\[Fast Refresh\] done in \d+ms$/u.test(text) ||
    text.includes("Download the React DevTools")
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
