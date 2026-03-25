#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

import { loadRoutaTokens, pickTextColor } from "./color-tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(toolRoot, "..", "..");
const releaseNotePath = path.join(repoRoot, "docs", "releases", "v0.2.7-release-notes.md");
const outputDir = path.join(toolRoot, "output");
const outputFile = path.join(outputDir, "routa-v0.2.7-release-notes.pptx");

const tokens = loadRoutaTokens();
const shapeType = new PptxGenJS().ShapeType;

function readReleaseNotes() {
  const source = fs.readFileSync(releaseNotePath, "utf8");
  const lines = source.split(/\r?\n/);

  const document = {
    title: "",
    releaseDate: "",
    tag: "",
    overview: [],
    highlights: [],
    technicalSummary: [],
    representativeCommits: [],
    upgradeNotes: [],
    assets: [],
  };

  let section = "";
  let currentHighlight = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      document.title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("**Release Date**:")) {
      document.releaseDate = line.replace("**Release Date**:", "").trim();
      continue;
    }

    if (line.startsWith("**Tag**:")) {
      document.tag = line.replace("**Tag**:", "").replaceAll("`", "").trim();
      continue;
    }

    if (line === "## Overview") {
      section = "overview";
      continue;
    }
    if (line === "## Key Highlights") {
      section = "highlights";
      continue;
    }
    if (line === "## Technical Summary") {
      section = "technicalSummary";
      continue;
    }
    if (line === "## Representative Commits") {
      section = "representativeCommits";
      continue;
    }
    if (line === "## Upgrade Notes") {
      section = "upgradeNotes";
      continue;
    }
    if (line === "## Assets") {
      section = "assets";
      continue;
    }

    if (line.startsWith("### ") && section === "highlights") {
      currentHighlight = {
        title: line.slice(4).trim(),
        bullets: [],
        impact: [],
      };
      document.highlights.push(currentHighlight);
      continue;
    }

    if (section === "overview") {
      document.overview.push(line.replace(/`/g, ""));
      continue;
    }

    if (section === "highlights" && currentHighlight) {
      if (line === "User impact:") {
        continue;
      }
      if (line.startsWith("- ")) {
        const item = line.slice(2).replace(/`/g, "").trim();
        if (currentHighlight.impact.length > 0 || rawLine.includes("User impact")) {
          currentHighlight.impact.push(item);
        } else if (currentHighlight.bullets.length > 0 && currentHighlight.bullets.at(-1) === "__IMPACT__") {
          currentHighlight.bullets.pop();
          currentHighlight.impact.push(item);
        } else {
          currentHighlight.bullets.push(item);
        }
        continue;
      }
      if (line === "User impact:") {
        currentHighlight.bullets.push("__IMPACT__");
      }
      continue;
    }

    if (section === "technicalSummary" && line.startsWith("- ")) {
      document.technicalSummary.push(line.slice(2).replace(/`/g, "").trim());
      continue;
    }

    if (section === "representativeCommits" && line.startsWith("- ")) {
      document.representativeCommits.push(line.slice(2).replace(/`/g, "").trim());
      continue;
    }

    if (section === "upgradeNotes" && line.startsWith("- ")) {
      document.upgradeNotes.push(line.slice(2).replace(/`/g, "").trim());
      continue;
    }

    if (section === "assets" && line.startsWith("- ")) {
      document.assets.push(line.slice(2).replace(/`/g, "").trim());
      continue;
    }
  }

  for (const highlight of document.highlights) {
    const joined = source.split(`### ${highlight.title}`)[1] ?? "";
    const block = joined.split("\n### ")[0];
    const impactBlock = block.split("User impact:")[1] ?? "";
    if (impactBlock) {
      highlight.impact = impactBlock
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).replace(/`/g, "").trim());
      highlight.bullets = block
        .split("User impact:")[0]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).replace(/`/g, "").trim());
    }
  }

  return document;
}

function makePpt() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "Routa";
  pptx.subject = "Routa v0.2.7 release notes";
  pptx.title = "Routa v0.2.7 Release Notes";
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };
  return pptx;
}

function addBackground(slide, color) {
  slide.addShape(shapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color, transparency: 100 },
    fill: { color },
  });
}

function addSectionTitle(slide, eyebrow, title, body, theme) {
  slide.addText(eyebrow.toUpperCase(), {
    x: 0.75,
    y: 0.5,
    w: 2.4,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    charSpace: 1.4,
    color: theme.kicker,
    margin: 0,
  });
  slide.addText(title, {
    x: 0.75,
    y: 0.88,
    w: 7.2,
    h: 0.52,
    fontFace: "Aptos Display",
    fontSize: 23,
    bold: true,
    color: theme.title,
    margin: 0,
  });
  if (body) {
    slide.addText(body, {
      x: 0.75,
      y: 1.48,
      w: 6.6,
      h: 0.42,
      fontSize: 10.5,
      color: theme.body,
      margin: 0,
    });
  }
}

function addBulletList(slide, items, options) {
  const {
    x,
    y,
    w,
    bulletColor,
    textColor,
    fontSize = 11,
    lineGap = 0.48,
    maxItems = items.length,
  } = options;

  items.slice(0, maxItems).forEach((item, index) => {
    const top = y + index * lineGap;
    slide.addShape(shapeType.ellipse, {
      x,
      y: top + 0.06,
      w: 0.11,
      h: 0.11,
      line: { color: bulletColor, transparency: 100 },
      fill: { color: bulletColor },
    });
    slide.addText(item, {
      x: x + 0.22,
      w,
      h: 0.28,
      y: top,
      fontSize,
      color: textColor,
      margin: 0,
      breakLine: false,
    });
  });
}

function addCover(slide, doc) {
  const dark = tokens.desktop.dark;
  addBackground(slide, dark["--dt-bg-primary"]);

  slide.addShape(shapeType.arc, {
    x: 8.9,
    y: -0.4,
    w: 4,
    h: 2.8,
    line: { color: dark["--dt-brand-blue"], transparency: 100 },
    fill: { color: dark["--dt-brand-blue"], transparency: 20 },
  });
  slide.addShape(shapeType.arc, {
    x: 8.2,
    y: 4.4,
    w: 4.6,
    h: 2.7,
    line: { color: dark["--dt-brand-green"], transparency: 100 },
    fill: { color: dark["--dt-brand-green"], transparency: 22 },
  });
  slide.addShape(shapeType.arc, {
    x: 10.1,
    y: 1.7,
    w: 2.2,
    h: 1.6,
    line: { color: dark["--dt-brand-orange"], transparency: 100 },
    fill: { color: dark["--dt-brand-orange"], transparency: 16 },
  });

  slide.addText(doc.tag, {
    x: 0.78,
    y: 0.9,
    w: 1.5,
    h: 0.22,
    fontSize: 11,
    color: dark["--dt-brand-blue-soft"],
    bold: true,
    margin: 0,
  });
  slide.addText(doc.title.replace(/^Release\s+/, ""), {
    x: 0.78,
    y: 1.28,
    w: 6.8,
    h: 1.1,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: dark["--dt-text-primary"],
    margin: 0,
  });
  slide.addText(
    "Generated from docs/releases/v0.2.7-release-notes.md using the Routa presentation color system.",
    {
      x: 0.8,
      y: 2.6,
      w: 5.8,
      h: 0.42,
      fontSize: 10.5,
      color: dark["--dt-text-secondary"],
      margin: 0,
    },
  );

  const meta = [
    { label: "Release Date", value: doc.releaseDate, color: dark["--dt-brand-blue"] },
    { label: "Theme", value: "Desktop Workflow", color: dark["--dt-brand-orange"] },
    { label: "Focus", value: "Kanban + Team Run", color: dark["--dt-brand-green"] },
  ];
  meta.forEach((entry, index) => {
    const x = 0.8 + index * 1.95;
    slide.addShape(shapeType.roundRect, {
      x,
      y: 4.9,
      w: 1.7,
      h: 1.05,
      rectRadius: 0.08,
      line: { color: dark["--dt-border"], transparency: 55 },
      fill: { color: entry.color, transparency: 10 },
    });
    slide.addText(entry.label, {
      x: x + 0.14,
      y: 5.1,
      w: 1.2,
      h: 0.15,
      fontSize: 8,
      color: dark["--dt-text-muted"],
      margin: 0,
    });
    slide.addText(entry.value, {
      x: x + 0.14,
      y: 5.38,
      w: 1.25,
      h: 0.18,
      fontSize: 10.5,
      bold: true,
      color: dark["--dt-text-primary"],
      margin: 0,
    });
  });
}

function addOverview(slide, doc) {
  const light = tokens.desktop.light;
  addBackground(slide, light["--dt-bg-primary"]);
  addSectionTitle(
    slide,
    "Overview",
    "What changed in v0.2.7",
    "This release focuses on reliability, automation, and a tighter desktop coordination experience.",
    {
      kicker: light["--dt-brand-blue"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  );

  slide.addShape(shapeType.roundRect, {
    x: 0.78,
    y: 2.15,
    w: 7.2,
    h: 3.95,
    rectRadius: 0.08,
    line: { color: light["--dt-border"] },
    fill: { color: "FFFFFF" },
  });
  addBulletList(slide, doc.overview, {
    x: 1.08,
    y: 2.55,
    w: 6.45,
    bulletColor: light["--dt-brand-blue"],
    textColor: light["--dt-text-secondary"],
    fontSize: 11,
    lineGap: 0.82,
  });

  slide.addShape(shapeType.roundRect, {
    x: 8.3,
    y: 2.15,
    w: 4.2,
    h: 3.95,
    rectRadius: 0.08,
    line: { color: light["--dt-border-light"] },
    fill: { color: light["--dt-bg-secondary"] },
  });
  slide.addText("Release themes", {
    x: 8.62,
    y: 2.48,
    w: 1.6,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: light["--dt-text-primary"],
    margin: 0,
  });
  [
    { label: "Session replay", color: light["--dt-brand-blue"] },
    { label: "Kanban automation", color: light["--dt-brand-orange"] },
    { label: "Team Run coordination", color: light["--dt-brand-green"] },
    { label: "Desktop visual cleanup", color: light["--dt-brand-purple"] },
    { label: "Release hardening", color: light["--dt-brand-red"] },
  ].forEach((item, index) => {
    const y = 2.9 + index * 0.55;
    slide.addShape(shapeType.roundRect, {
      x: 8.64,
      y,
      w: 2.9,
      h: 0.32,
      rectRadius: 0.08,
      line: { color: item.color, transparency: 100 },
      fill: { color: item.color },
    });
    slide.addText(item.label, {
      x: 8.83,
      y: y + 0.06,
      w: 2.4,
      h: 0.12,
      fontSize: 8.5,
      color: pickTextColor(item.color),
      margin: 0,
    });
  });
}

function addHighlights(slide, doc, startIndex) {
  const light = tokens.desktop.light;
  const palette = [
    light["--dt-brand-blue"],
    light["--dt-brand-orange"],
    light["--dt-brand-green"],
    light["--dt-brand-purple"],
    light["--dt-brand-red"],
  ];

  addBackground(slide, light["--dt-bg-secondary"]);
  addSectionTitle(
    slide,
    "Highlights",
    `Key release highlights ${startIndex + 1}-${Math.min(startIndex + 2, doc.highlights.length)}`,
    "",
    {
      kicker: light["--dt-brand-orange"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  );

  doc.highlights.slice(startIndex, startIndex + 2).forEach((highlight, index) => {
    const color = palette[startIndex + index];
    const x = 0.78 + index * 6.2;

    slide.addShape(shapeType.roundRect, {
      x,
      y: 1.95,
      w: 5.55,
      h: 4.95,
      rectRadius: 0.08,
      line: { color: light["--dt-border"] },
      fill: { color: "FFFFFF" },
    });
    slide.addShape(shapeType.rect, {
      x,
      y: 1.95,
      w: 5.55,
      h: 0.18,
      line: { color, transparency: 100 },
      fill: { color },
    });
    slide.addText(highlight.title.replace(/^\d+\.\s*/, ""), {
      x: x + 0.28,
      y: 2.28,
      w: 4.85,
      h: 0.48,
      fontSize: 15,
      bold: true,
      color: light["--dt-text-primary"],
      margin: 0,
    });
    slide.addText("What changed", {
      x: x + 0.28,
      y: 2.92,
      w: 1.1,
      h: 0.15,
      fontSize: 8,
      bold: true,
      color,
      margin: 0,
    });
    addBulletList(slide, highlight.bullets, {
      x: x + 0.3,
      y: 3.18,
      w: 4.7,
      bulletColor: color,
      textColor: light["--dt-text-secondary"],
      fontSize: 8.8,
      lineGap: 0.37,
      maxItems: 6,
    });

    const impactY = 5.35;
    slide.addText("User impact", {
      x: x + 0.28,
      y: impactY,
      w: 1.1,
      h: 0.15,
      fontSize: 8,
      bold: true,
      color: light["--dt-text-primary"],
      margin: 0,
    });
    addBulletList(slide, highlight.impact, {
      x: x + 0.3,
      y: impactY + 0.24,
      w: 4.7,
      bulletColor: light["--dt-brand-route"],
      textColor: light["--dt-text-secondary"],
      fontSize: 8.5,
      lineGap: 0.32,
      maxItems: 4,
    });
  });
}

function addTechnical(slide, doc) {
  const light = tokens.desktop.light;
  addBackground(slide, light["--dt-bg-primary"]);
  addSectionTitle(
    slide,
    "Technical Summary",
    "Implementation footprint",
    "The release spans ACP, Kanban, Team Run, desktop components, and packaging workflows.",
    {
      kicker: light["--dt-brand-green"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  );

  slide.addShape(shapeType.roundRect, {
    x: 0.78,
    y: 2.1,
    w: 6.05,
    h: 4.65,
    rectRadius: 0.08,
    line: { color: light["--dt-border"] },
    fill: { color: "FFFFFF" },
  });
  addBulletList(slide, doc.technicalSummary, {
    x: 1.08,
    y: 2.45,
    w: 5.3,
    bulletColor: light["--dt-brand-green"],
    textColor: light["--dt-text-secondary"],
    fontSize: 9.5,
    lineGap: 0.62,
  });

  slide.addShape(shapeType.roundRect, {
    x: 7.05,
    y: 2.1,
    w: 5.45,
    h: 4.65,
    rectRadius: 0.08,
    line: { color: light["--dt-border-light"] },
    fill: { color: light["--dt-bg-secondary"] },
  });
  slide.addText("Representative commits", {
    x: 7.36,
    y: 2.42,
    w: 2,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: light["--dt-text-primary"],
    margin: 0,
  });
  addBulletList(slide, doc.representativeCommits, {
    x: 7.36,
    y: 2.78,
    w: 4.5,
    bulletColor: light["--dt-brand-blue"],
    textColor: light["--dt-text-secondary"],
    fontSize: 8.5,
    lineGap: 0.34,
    maxItems: 10,
  });
}

function addUpgrade(slide, doc) {
  const dark = tokens.desktop.dark;
  addBackground(slide, dark["--dt-bg-secondary"]);
  addSectionTitle(
    slide,
    "Upgrade Notes",
    "Who should upgrade and what ships",
    "",
    {
      kicker: dark["--dt-brand-blue-soft"],
      title: dark["--dt-text-primary"],
      body: dark["--dt-text-secondary"],
    },
  );

  slide.addShape(shapeType.roundRect, {
    x: 0.78,
    y: 2.1,
    w: 6.1,
    h: 3.75,
    rectRadius: 0.08,
    line: { color: dark["--dt-border"] },
    fill: { color: dark["--dt-bg-primary"], transparency: 8 },
  });
  slide.addText("Upgrade guidance", {
    x: 1.08,
    y: 2.42,
    w: 1.8,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: dark["--dt-text-primary"],
    margin: 0,
  });
  addBulletList(slide, doc.upgradeNotes, {
    x: 1.08,
    y: 2.82,
    w: 5.2,
    bulletColor: dark["--dt-brand-orange"],
    textColor: dark["--dt-text-secondary"],
    fontSize: 9.5,
    lineGap: 0.62,
  });

  slide.addShape(shapeType.roundRect, {
    x: 7.15,
    y: 2.1,
    w: 5.35,
    h: 3.75,
    rectRadius: 0.08,
    line: { color: dark["--dt-border"] },
    fill: { color: dark["--dt-bg-primary"], transparency: 8 },
  });
  slide.addText("Expected release assets", {
    x: 7.44,
    y: 2.42,
    w: 2.2,
    h: 0.2,
    fontSize: 10,
    bold: true,
    color: dark["--dt-text-primary"],
    margin: 0,
  });
  addBulletList(slide, doc.assets, {
    x: 7.44,
    y: 2.82,
    w: 4.5,
    bulletColor: dark["--dt-brand-green"],
    textColor: dark["--dt-text-secondary"],
    fontSize: 9.5,
    lineGap: 0.5,
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const doc = readReleaseNotes();
  const pptx = makePpt();

  addCover(pptx.addSlide(), doc);
  addOverview(pptx.addSlide(), doc);
  addHighlights(pptx.addSlide(), doc, 0);
  addHighlights(pptx.addSlide(), doc, 2);
  addHighlights(pptx.addSlide(), doc, 4);
  addTechnical(pptx.addSlide(), doc);
  addUpgrade(pptx.addSlide(), doc);

  await pptx.writeFile({ fileName: outputFile });
  console.log(`Generated release notes PPT: ${outputFile}`);
  console.log(`Source markdown: ${releaseNotePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
