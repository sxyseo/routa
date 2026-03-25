#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PptxGenJS from "pptxgenjs";

import { loadRoutaTokens, pickTextColor } from "./color-tokens.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(__dirname, "..");
const outputDir = path.join(toolRoot, "output");
const outputFile = path.join(outputDir, "routa-color-template.pptx");

const tokens = loadRoutaTokens();
const pptx = new PptxGenJS();

pptx.layout = "LAYOUT_WIDE";
pptx.author = "OpenAI Codex";
pptx.company = "Routa";
pptx.subject = "Routa color-token-based presentation template";
pptx.title = "Routa PPT Template";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "zh-CN",
};

function addFullBleed(slide, color) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color },
    fill: { color },
  });
}

function addLabel(slide, text, opts) {
  slide.addText(text, {
    fontFace: "Aptos",
    margin: 0,
    breakLine: false,
    ...opts,
  });
}

function addTitle(slide, eyebrow, title, body, theme) {
  addLabel(slide, eyebrow.toUpperCase(), {
    x: 0.8,
    y: 0.55,
    w: 2.8,
    h: 0.25,
    fontSize: 10,
    color: theme.kicker,
    bold: true,
    charSpace: 1.5,
  });
  slide.addText(title, {
    x: 0.8,
    y: 0.95,
    w: 6.6,
    h: 0.9,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: theme.title,
    margin: 0,
  });
  slide.addText(body, {
    x: 0.8,
    y: 1.75,
    w: 5.7,
    h: 0.65,
    fontSize: 11,
    color: theme.body,
    margin: 0,
    breakLine: false,
  });
}

function addCoverSlide() {
  const slide = pptx.addSlide();
  const dark = tokens.desktop.dark;
  addFullBleed(slide, dark["--dt-bg-primary"]);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color: dark["--dt-bg-primary"], transparency: 100 },
    fill: {
      color: dark["--dt-bg-primary"],
      transparency: 0,
    },
  });

  slide.addShape(pptx.ShapeType.arc, {
    x: 8.6,
    y: -0.9,
    w: 4.8,
    h: 3.4,
    line: { color: dark["--dt-brand-blue"], transparency: 100 },
    fill: { color: dark["--dt-brand-blue"], transparency: 25 },
  });
  slide.addShape(pptx.ShapeType.arc, {
    x: 9.2,
    y: 0.6,
    w: 3.2,
    h: 2.1,
    line: { color: dark["--dt-brand-orange"], transparency: 100 },
    fill: { color: dark["--dt-brand-orange"], transparency: 18 },
  });
  slide.addShape(pptx.ShapeType.arc, {
    x: 7.8,
    y: 4.4,
    w: 5,
    h: 3,
    line: { color: dark["--dt-brand-green"], transparency: 100 },
    fill: { color: dark["--dt-brand-green"], transparency: 20 },
  });

  slide.addText("Routa Presentation Template", {
    x: 0.8,
    y: 1.1,
    w: 6.3,
    h: 0.9,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: dark["--dt-text-primary"],
    margin: 0,
  });
  slide.addText("基于当前 color tokens 自动生成", {
    x: 0.82,
    y: 2.05,
    w: 4.2,
    h: 0.35,
    fontSize: 12,
    color: dark["--dt-brand-blue-soft"],
    bold: true,
    margin: 0,
  });
  slide.addText(
    "这套模板直接读取 src/app/globals.css 的基础色板，并按 desktop-theme.css 的语义映射生成浅色与深色演示页面。",
    {
      x: 0.8,
      y: 2.55,
      w: 5.5,
      h: 0.8,
      fontSize: 11,
      color: dark["--dt-text-secondary"],
      margin: 0,
    },
  );

  const heroCards = [
    { label: "Primary", color: dark["--dt-brand-blue"], value: tokens.desktop.light["--dt-brand-blue"] },
    { label: "Execution", color: dark["--dt-brand-orange"], value: tokens.desktop.light["--dt-brand-orange"] },
    { label: "Verified", color: dark["--dt-brand-green"], value: tokens.desktop.light["--dt-brand-green"] },
  ];

  heroCards.forEach((card, index) => {
    const x = 0.8 + index * 1.85;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 4.75,
      w: 1.55,
      h: 1.25,
      rectRadius: 0.12,
      line: { color: dark["--dt-border"], transparency: 55 },
      fill: { color: card.color, transparency: 8 },
    });
    slide.addText(card.label, {
      x: x + 0.14,
      y: 4.98,
      w: 1.1,
      h: 0.2,
      fontSize: 10,
      bold: true,
      color: dark["--dt-text-primary"],
      margin: 0,
    });
    slide.addText(`#${card.value}`, {
      x: x + 0.14,
      y: 5.3,
      w: 1.15,
      h: 0.2,
      fontSize: 11,
      color: dark["--dt-text-secondary"],
      margin: 0,
    });
  });

  slide.addText("Routa.js", {
    x: 0.8,
    y: 6.85,
    w: 1.4,
    h: 0.22,
    fontSize: 10,
    color: dark["--dt-text-muted"],
    margin: 0,
  });
  slide.addText(new Date().toISOString().slice(0, 10), {
    x: 11.6,
    y: 6.85,
    w: 0.9,
    h: 0.22,
    align: "right",
    fontSize: 10,
    color: dark["--dt-text-muted"],
    margin: 0,
  });
}

function addPaletteSlide() {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, light["--dt-bg-primary"]);
  addTitle(
    slide,
    "Color Families",
    "基础色板与语义用途",
    "六个 10-step 色带直接来自 Routa 当前 token，适合做封面、章节页、数据高亮和状态标记。",
    {
      kicker: light["--dt-brand-blue"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  );

  tokens.paletteFamilies.forEach((family, row) => {
    const y = 2.55 + row * 0.72;
    slide.addText(family.label, {
      x: 0.8,
      y,
      w: 1.55,
      h: 0.22,
      fontSize: 10.5,
      bold: true,
      color: light["--dt-text-primary"],
      margin: 0,
    });
    slide.addText(family.semantic, {
      x: 0.8,
      y: y + 0.2,
      w: 1.75,
      h: 0.28,
      fontSize: 8.5,
      color: light["--dt-text-muted"],
      margin: 0,
    });

    family.colors.forEach((token, index) => {
      const x = 2.55 + index * 0.93;
      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: 0.78,
        h: 0.46,
        rectRadius: 0.06,
        line: { color: token.hex, transparency: 100 },
        fill: { color: token.hex },
      });
      slide.addText(token.step, {
        x: x + 0.04,
        y: y + 0.05,
        w: 0.3,
        h: 0.14,
        fontSize: 7.5,
        bold: true,
        color: pickTextColor(token.hex),
        margin: 0,
      });
      slide.addText(token.hex, {
        x: x + 0.04,
        y: y + 0.22,
        w: 0.55,
        h: 0.12,
        fontSize: 6.5,
        color: pickTextColor(token.hex),
        margin: 0,
      });
    });
  });
}

function addSemanticSlide() {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, light["--dt-bg-secondary"]);
  addTitle(
    slide,
    "Semantic Tokens",
    "产品语义层",
    "把基础色映射成产品动作和状态后，PPT 页面就能维持和应用界面一致的表达逻辑。",
    {
      kicker: light["--dt-brand-orange"],
      title: light["--dt-text-primary"],
      body: light["--dt-text-secondary"],
    },
  );

  tokens.semanticAliases.forEach((token, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.8 + col * 6.1;
    const y = 2.45 + row * 1.1;

    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 5.55,
      h: 0.82,
      rectRadius: 0.08,
      line: { color: light["--dt-border"] },
      fill: { color: "FFFFFF", transparency: 6 },
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: x + 0.22,
      y: y + 0.18,
      w: 0.6,
      h: 0.46,
      rectRadius: 0.08,
      line: { color: token.lightHex, transparency: 100 },
      fill: { color: token.lightHex },
    });
    slide.addText(token.name, {
      x: x + 1.02,
      y: y + 0.15,
      w: 1.7,
      h: 0.18,
      fontSize: 10.5,
      bold: true,
      color: light["--dt-text-primary"],
      margin: 0,
    });
    slide.addText(token.role, {
      x: x + 1.02,
      y: y + 0.37,
      w: 3.1,
      h: 0.18,
      fontSize: 8.5,
      color: light["--dt-text-secondary"],
      margin: 0,
    });
    slide.addText(`Light #${token.lightHex}  Dark #${token.darkHex}`, {
      x: x + 3.75,
      y: y + 0.3,
      w: 1.45,
      h: 0.15,
      align: "right",
      fontSize: 7.5,
      color: light["--dt-text-muted"],
      margin: 0,
    });
  });
}

function addContentTemplateSlide() {
  const slide = pptx.addSlide();
  const light = tokens.desktop.light;
  addFullBleed(slide, light["--dt-bg-primary"]);

  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.42,
    line: { color: light["--dt-brand-blue"], transparency: 100 },
    fill: { color: light["--dt-brand-blue"] },
  });

  slide.addText("Chapter 01", {
    x: 0.8,
    y: 0.72,
    w: 1.5,
    h: 0.22,
    fontSize: 10,
    bold: true,
    color: light["--dt-brand-blue"],
    margin: 0,
  });
  slide.addText("状态一致、可直接复用的内容页", {
    x: 0.8,
    y: 1.02,
    w: 4.8,
    h: 0.45,
    fontFace: "Aptos Display",
    fontSize: 21,
    bold: true,
    color: light["--dt-text-primary"],
    margin: 0,
  });
  slide.addText(
    "这页示范正文布局、指标卡和重点提示块。你可以把它当作通用业务汇报模板继续复制。",
    {
      x: 0.8,
      y: 1.56,
      w: 4.8,
      h: 0.42,
      fontSize: 10.5,
      color: light["--dt-text-secondary"],
      margin: 0,
    },
  );

  const metrics = [
    { title: "Automation Coverage", value: "84%", color: light["--dt-brand-blue"] },
    { title: "Execution Throughput", value: "31 cards", color: light["--dt-brand-orange"] },
    { title: "Verification Pass", value: "96%", color: light["--dt-brand-green"] },
  ];
  metrics.forEach((metric, index) => {
    const x = 0.8 + index * 1.88;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y: 2.28,
      w: 1.62,
      h: 1.1,
      rectRadius: 0.08,
      line: { color: light["--dt-border-light"] },
      fill: { color: "FFFFFF" },
    });
    slide.addText(metric.title, {
      x: x + 0.14,
      y: 2.46,
      w: 1.2,
      h: 0.2,
      fontSize: 8,
      color: light["--dt-text-muted"],
      margin: 0,
    });
    slide.addText(metric.value, {
      x: x + 0.14,
      y: 2.72,
      w: 1.15,
      h: 0.3,
      fontSize: 19,
      bold: true,
      color: metric.color,
      margin: 0,
    });
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.75,
    y: 1.05,
    w: 5.75,
    h: 5.45,
    rectRadius: 0.1,
    line: { color: light["--dt-border"] },
    fill: { color: "FFFFFF" },
  });
  slide.addText("结构建议", {
    x: 7.05,
    y: 1.38,
    w: 1.6,
    h: 0.22,
    fontSize: 11,
    bold: true,
    color: light["--dt-text-primary"],
    margin: 0,
  });

  const bullets = [
    { color: light["--dt-brand-blue"], text: "标题使用 blue 语义，正文使用 slate 文本层。" },
    { color: light["--dt-brand-orange"], text: "流程、风险、进行中事项优先用 amber 家族。" },
    { color: light["--dt-brand-green"], text: "结果页、验证页、成功数据用 emerald 做主强调。" },
    { color: light["--dt-brand-purple"], text: "AI insight 或探索性内容可用 orchid 作为次强调。" },
  ];
  bullets.forEach((bullet, index) => {
    const y = 1.82 + index * 0.72;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 7.08,
      y,
      w: 0.14,
      h: 0.14,
      line: { color: bullet.color, transparency: 100 },
      fill: { color: bullet.color },
    });
    slide.addText(bullet.text, {
      x: 7.34,
      y: y - 0.04,
      w: 4.75,
      h: 0.28,
      fontSize: 9.5,
      color: light["--dt-text-secondary"],
      margin: 0,
    });
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7.05,
    y: 4.9,
    w: 4.95,
    h: 1.05,
    rectRadius: 0.08,
    line: { color: light["--dt-brand-blue"], transparency: 80 },
    fill: { color: light["--dt-bg-active"] },
  });
  slide.addText("Template note", {
    x: 7.28,
    y: 5.12,
    w: 1.2,
    h: 0.16,
    fontSize: 8.5,
    bold: true,
    color: light["--dt-brand-blue"],
    margin: 0,
  });
  slide.addText("如果你后面要扩展母版页，可以继续把页眉条、章节号和右侧信息框抽成 helper。", {
    x: 7.28,
    y: 5.36,
    w: 4.25,
    h: 0.26,
    fontSize: 9.2,
    color: light["--dt-text-secondary"],
    margin: 0,
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  addCoverSlide();
  addPaletteSlide();
  addSemanticSlide();
  addContentTemplateSlide();

  await pptx.writeFile({ fileName: outputFile });
  console.log(`Generated PPT template: ${outputFile}`);
  console.log(`Tokens sourced from: ${tokens.sourceFiles.globalsCssPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
