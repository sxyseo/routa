// src/word/word-preview.tsx
import { useEffect, useRef } from "react";

// src/shared/office-types.ts
var EXCEL_MAX_COLUMN_COUNT = 16384;
var EXCEL_MAX_ROW_COUNT = 1048576;
var EMPTY_OFFICE_TEXT_STYLE_MAPS = {
  textStyles: /* @__PURE__ */ new Map(),
  images: /* @__PURE__ */ new Map()
};

// src/shared/office-data-coerce.ts
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function asString(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bytesFromUnknown(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return new Uint8Array(value);
  }
  const record = asRecord(value);
  if (record == null) return null;
  const numericKeys = Object.keys(record).filter((key) => /^\d+$/.test(key)).map(Number).sort((left, right) => left - right);
  if (numericKeys.length === 0) return null;
  const bytes = new Uint8Array(numericKeys.length);
  for (const key of numericKeys) {
    bytes[key] = asNumber(record[String(key)]);
  }
  return bytes;
}
function inferImageContentType(id) {
  const extension = id.toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "application/octet-stream";
}

// src/shared/office-color-utils.ts
function hexToRgb(value) {
  const normalized = /^[0-9a-f]{8}$/i.test(value) ? value.slice(2) : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16)
  };
}
function colorAlpha(value) {
  const transform = asRecord(asRecord(value)?.transform);
  const alpha = transform?.alpha;
  if (typeof alpha !== "number" || !Number.isFinite(alpha)) return 1;
  return Math.max(0, Math.min(1, alpha / 1e5));
}
function colorToCss(value) {
  const color = asRecord(value);
  const raw = asString(color?.value);
  const rgb = hexToRgb(raw);
  if (rgb) {
    const argbAlpha = /^[0-9a-f]{8}$/i.test(raw) ? Number.parseInt(raw.slice(0, 2), 16) / 255 : 1;
    const alpha = Math.min(argbAlpha, colorAlpha(color));
    if (alpha < 1) return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${alpha})`;
    return `#${raw.slice(-6)}`;
  }
  const lastColor = asString(color?.lastColor);
  const lastRgb = hexToRgb(lastColor);
  if (lastRgb) return `#${lastColor}`;
  return void 0;
}
function fillToCss(fill) {
  const fillRecord = asRecord(fill);
  if (fillRecord == null || asNumber(fillRecord.type) === 0) return void 0;
  return colorToCss(fillRecord.color);
}
function spreadsheetFillToCss(fill) {
  const fillRecord = asRecord(fill);
  if (fillRecord == null) return void 0;
  return fillToCss(fillRecord) ?? colorToCss(fillRecord.color) ?? colorToCss(asRecord(fillRecord.pattern)?.foregroundColor) ?? colorToCss(asRecord(fillRecord.pattern)?.backgroundColor) ?? colorToCss(asRecord(fillRecord.pattern)?.fill);
}
function lineToCss(line) {
  const lineRecord = asRecord(line);
  const fillRecord = asRecord(lineRecord?.fill);
  const color = colorToCss(fillRecord?.color);
  const width = Math.max(1, Math.min(4, asNumber(lineRecord?.widthEmu) / 9e3));
  return { color, width };
}
function slideBackgroundToCss(slide) {
  const background = asRecord(slide.background);
  const fill = asRecord(background?.fill);
  return fillToCss(fill) ?? "#ffffff";
}

// src/shared/office-text-styles.ts
function paragraphText(paragraph) {
  const runs = asArray(asRecord(paragraph)?.runs);
  return runs.map((run) => asString(asRecord(run)?.text)).join("");
}
function paragraphView(paragraph, styleMaps) {
  const record = asRecord(paragraph);
  const styleId = asString(record?.styleId);
  const style = {
    ...resolvedTextStyle(styleId, styleMaps),
    ...asRecord(record?.paragraphStyle) ?? {},
    ...asRecord(record?.style) ?? {},
    ...paragraphMarkTextStyle(asRecord(record?.textStyle)),
    ...definedRecordProperties(record, TEXT_STYLE_FIELDS)
  };
  const runs = asArray(record?.runs).map(asRecord).filter((run) => run != null).map((run, index) => ({
    hyperlink: asRecord(run.hyperlink),
    id: asString(run.id) || `${asString(record?.id)}-${index}`,
    referenceMarkers: [],
    reviewMarkIds: asArray(run.reviewMarkIds).map(asString).filter(Boolean),
    text: asString(run.text),
    style: {
      ...style,
      ...asRecord(run.textStyle) ?? {}
    }
  }));
  return {
    id: asString(record?.id),
    runs,
    styleId,
    style
  };
}
function paragraphMarkTextStyle(style) {
  if (style == null) return {};
  return definedRecordProperties(style, ["alignment"]);
}
function resolvedTextStyle(styleId, styleMaps, visited = /* @__PURE__ */ new Set()) {
  if (!styleId || visited.has(styleId)) return {};
  const styleRecord = styleMaps.textStyles.get(styleId);
  if (!styleRecord) return {};
  const basedOn = asString(styleRecord.basedOn);
  const nextVisited = new Set(visited);
  nextVisited.add(styleId);
  return {
    ...resolvedTextStyle(basedOn, styleMaps, nextVisited),
    ...asRecord(styleRecord.textStyle) ?? {},
    ...asRecord(styleRecord.paragraphStyle) ?? {},
    ...definedRecordProperties(styleRecord, TEXT_STYLE_FIELDS)
  };
}
var TEXT_STYLE_FIELDS = [
  "alignment",
  "bulletCharacter",
  "indent",
  "lineSpacing",
  "lineSpacingPercent",
  "marginLeft",
  "spaceAfter",
  "spaceBefore"
];
function definedRecordProperties(record, keys) {
  const values = {};
  if (!record) return values;
  for (const key of keys) {
    if (record[key] !== void 0 && record[key] !== null) {
      values[key] = record[key];
    }
  }
  return values;
}
function paragraphStyle(paragraph) {
  const isTitle = paragraph.styleId === "Title";
  const isHeading = /^Heading/i.test(paragraph.styleId);
  const spaceBefore = asNumber(paragraph.style?.spaceBefore);
  const spaceAfter = asNumber(paragraph.style?.spaceAfter);
  const marginLeft = emuToCssPx(paragraph.style?.marginLeft);
  const textIndent = emuToCssPx(paragraph.style?.indent);
  return {
    color: colorToCss(asRecord(paragraph.style?.fill)?.color) ?? "#0f172a",
    fontFamily: officeFontFamily(asString(paragraph.style?.typeface)),
    fontSize: cssFontSize(paragraph.style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14),
    fontWeight: paragraph.style?.bold === true || isTitle || isHeading ? 700 : 400,
    lineHeight: paragraphLineHeight(paragraph),
    margin: 0,
    marginBottom: spaceAfter ? Math.min(28, spaceAfter / 20) : isTitle || isHeading ? 10 : 8,
    marginLeft: marginLeft || void 0,
    marginTop: spaceBefore ? Math.min(32, spaceBefore / 20) : isHeading ? 12 : 0,
    textAlign: paragraphTextAlign(paragraph.style?.alignment),
    textIndent: textIndent || void 0,
    whiteSpace: "pre-wrap"
  };
}
function paragraphLineHeight(paragraph) {
  const exactPoints = asNumber(paragraph.style?.lineSpacing);
  if (exactPoints > 0) return `${Math.max(8, Math.min(96, exactPoints / 100))}pt`;
  const percent = asNumber(paragraph.style?.lineSpacingPercent);
  if (percent > 0) return Math.max(0.8, Math.min(3, percent / 1e5));
  return 1.55;
}
function paragraphTextAlign(alignment) {
  switch (asNumber(alignment)) {
    case 2:
      return "center";
    case 3:
      return "right";
    case 4:
      return "justify";
    default:
      return void 0;
  }
}
function emuToCssPx(value) {
  const emu = asNumber(value);
  if (emu === 0) return 0;
  return emu / 9525;
}
function textRunStyle(run, fontScale = 1) {
  const runFontSize2 = run.style?.fontSize == null ? void 0 : cssFontSize(run.style.fontSize, 14) * fontScale;
  const scheme = docxSchemeStyle(run.style?.scheme);
  const typeface = asString(run.style?.typeface) || scheme.typeface;
  return {
    backgroundColor: scheme.backgroundColor,
    color: colorToCss(asRecord(run.style?.fill)?.color) ?? void 0,
    fontFamily: officeFontFamily(typeface),
    fontSize: runFontSize2 == null ? void 0 : Math.max(fontScale < 1 ? 2 : 8, Math.min(fontScale < 1 ? 12 : 72, runFontSize2)),
    fontStyle: run.style?.italic === true ? "italic" : run.style?.italic === false ? "normal" : void 0,
    fontWeight: run.style?.bold === true ? 700 : run.style?.bold === false ? 400 : void 0,
    ...docxTextDecoration(run.style?.underline),
    textTransform: scheme.textTransform
  };
}
function docxTextDecoration(value) {
  if (value === true) return { textDecoration: "underline" };
  if (value === false) return { textDecoration: "none" };
  const underline = asString(value).toLowerCase();
  if (!underline) return {};
  if (underline === "none") return { textDecoration: "none" };
  return {
    textDecoration: "underline",
    textDecorationStyle: docxUnderlineStyle(underline)
  };
}
function docxUnderlineStyle(underline) {
  if (underline.includes("double")) return "double";
  if (underline.includes("dotted") || underline.includes("dot")) return "dotted";
  if (underline.includes("dash")) return "dashed";
  if (underline.includes("wave") || underline.includes("wavy")) return "wavy";
  return void 0;
}
function docxSchemeStyle(scheme) {
  const parts = asString(scheme).split(";").filter(Boolean);
  const style = { typeface: "" };
  for (const part of parts) {
    if (part === "__docxCaps:true") {
      style.textTransform = "uppercase";
      continue;
    }
    if (part.startsWith("__docxHighlight:")) {
      style.backgroundColor = docxHighlightToCss(part.slice("__docxHighlight:".length));
      continue;
    }
    if (part.startsWith("__docxEastAsiaTypeface:")) {
      style.typeface ||= part.slice("__docxEastAsiaTypeface:".length);
      continue;
    }
    if (part.startsWith("__docxComplexScriptTypeface:")) {
      style.typeface ||= part.slice("__docxComplexScriptTypeface:".length);
    }
  }
  return style;
}
function docxHighlightToCss(value) {
  switch (value.toLowerCase()) {
    case "black":
      return "#000000";
    case "blue":
      return "#0000ff";
    case "cyan":
      return "#00ffff";
    case "darkblue":
      return "#000080";
    case "darkcyan":
      return "#008080";
    case "darkgray":
      return "#808080";
    case "darkgreen":
      return "#008000";
    case "darkmagenta":
      return "#800080";
    case "darkred":
      return "#800000";
    case "darkyellow":
      return "#808000";
    case "green":
      return "#00ff00";
    case "lightgray":
      return "#c0c0c0";
    case "magenta":
      return "#ff00ff";
    case "red":
      return "#ff0000";
    case "white":
      return "#ffffff";
    case "yellow":
      return "#ffff00";
    default:
      return void 0;
  }
}
var OFFICE_FONT_FALLBACK = 'Aptos, Carlito, Calibri, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
var OFFICE_SERIF_FONT_FALLBACK = '"Songti SC", STSong, SimSun, "Noto Serif CJK SC", "Noto Serif CJK", serif';
function officeFontFamily(typeface) {
  const families = officeTypefaceFamilies(typeface);
  if (families.length === 0) return OFFICE_FONT_FALLBACK;
  const renderedFamilies = families.map(formatCssFontFamily);
  const fallback = families.some(isSerifTypeface) ? `${OFFICE_SERIF_FONT_FALLBACK}, ${OFFICE_FONT_FALLBACK}` : OFFICE_FONT_FALLBACK;
  return `${renderedFamilies.join(", ")}, ${fallback}`;
}
function officeTypefaceFamilies(typeface) {
  return typeface.split(/[;,]/u).map((family) => stripWrappingQuotes(family.trim())).filter(Boolean);
}
function stripWrappingQuotes(value) {
  if (value.length >= 2 && (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
function formatCssFontFamily(family) {
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/iu.test(family)) {
    return family;
  }
  const escaped = family.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}
function isSerifTypeface(family) {
  const normalized = family.trim();
  if (/^sans-serif$/iu.test(normalized)) return false;
  return /(^|[\s-])serif($|[\s-])|song|宋|明|仿宋|楷/iu.test(normalized);
}
async function prewarmOfficeFonts(typefaces) {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const fontSet = document.fonts;
  const families = /* @__PURE__ */ new Set(["Aptos", "Carlito", "Calibri", "Arial", ...Array.from(typefaces).filter(Boolean)]);
  await Promise.all(
    Array.from(families).map(async (family) => {
      try {
        await fontSet.load(`400 16px ${officeFontFamily(family)}`);
      } catch {
      }
    })
  );
}
function collectTextBlocks(value, limit = 80) {
  const blocks = [];
  const seen = /* @__PURE__ */ new WeakSet();
  function visit(node) {
    if (blocks.length >= limit) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = asRecord(node);
    if (record == null || seen.has(record)) return;
    seen.add(record);
    const paragraphs = asArray(record.paragraphs);
    if (paragraphs.length > 0) {
      const text = paragraphs.map(paragraphText).filter(Boolean).join("\n");
      if (text.trim()) blocks.push(text);
    }
    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }
  visit(value);
  return blocks;
}
function resolveStyleRecord(record, keys) {
  for (const key of keys) {
    const candidate = asRecord(record?.[key]);
    if (candidate) return candidate;
  }
  return null;
}
function cssFontSize(value, fallbackPx) {
  const raw = asNumber(value);
  if (raw <= 0) return fallbackPx;
  if (raw > 200) return Math.max(8, Math.min(72, raw / 100));
  return Math.max(8, Math.min(72, raw));
}

// src/shared/office-spreadsheet-utils.ts
function columnIndexFromAddress(address) {
  const match = normalizedCellReference(address).match(/^\$?([A-Z]+)/i);
  if (!match) return 0;
  let index = 0;
  for (const char of (match[1] ?? "").toUpperCase()) {
    index = index * 26 + char.charCodeAt(0) - 64;
  }
  return Math.max(0, index - 1);
}
function rowIndexFromAddress(address) {
  const match = normalizedCellReference(address).match(/\$?(\d+)/);
  if (!match) return 1;
  return Math.max(1, Number.parseInt(match[1] ?? "1", 10));
}
function parseCellRange(reference) {
  const normalizedReference = normalizedCellReference(reference);
  const hasRangeSeparator = normalizedReference.includes(":");
  const [startRaw, endRaw = startRaw] = normalizedReference.split(":");
  if (!startRaw) return null;
  const start = parseCellRangeEndpoint(startRaw);
  const end = parseCellRangeEndpoint(endRaw);
  if (!start.hasColumn && !start.hasRow && !end.hasColumn && !end.hasRow) return null;
  const startColumn = start.columnIndex ?? 0;
  const startRow = start.rowIndex ?? 1;
  const endColumn = end.columnIndex ?? (hasRangeSeparator ? EXCEL_MAX_COLUMN_COUNT - 1 : startColumn);
  const endRow = end.rowIndex ?? (hasRangeSeparator ? EXCEL_MAX_ROW_COUNT : startRow);
  return {
    startColumn: Math.min(startColumn, endColumn),
    startRow: Math.min(startRow, endRow),
    columnSpan: Math.abs(endColumn - startColumn) + 1,
    rowSpan: Math.abs(endRow - startRow) + 1
  };
}
function normalizedCellReference(reference) {
  const sheetSeparator = reference.lastIndexOf("!");
  return (sheetSeparator >= 0 ? reference.slice(sheetSeparator + 1) : reference).replace(/^'|'$/g, "").trim();
}
function parseCellRangeEndpoint(reference) {
  const trimmed = reference.trim();
  const columnMatch = trimmed.match(/^\$?([A-Z]+)/i);
  const rowMatch = trimmed.match(/\$?(\d+)/);
  const columnIndex = columnMatch ? columnIndexFromAddress(trimmed) : void 0;
  const rowIndex = rowMatch ? rowIndexFromAddress(trimmed) : void 0;
  return {
    ...columnIndex != null ? { columnIndex } : {},
    hasColumn: columnMatch != null,
    hasRow: rowMatch != null,
    ...rowIndex != null ? { rowIndex } : {}
  };
}
function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}
function cellText(cell) {
  const record = asRecord(cell);
  if (record == null) return "";
  const value = asString(record.value);
  if (value) return value;
  const formula = asString(record.formula) || asString(record.formulaText);
  if (formula) return spreadsheetFormulaDisplayText(formula);
  const paragraphs = asArray(record.paragraphs);
  return paragraphs.map(paragraphText).filter(Boolean).join("\n");
}
function spreadsheetFormulaDisplayText(formula) {
  const hyperlinkLabel = spreadsheetHyperlinkFormulaLabel(formula);
  if (hyperlinkLabel) return hyperlinkLabel;
  return `=${formula.replace(/^=/, "")}`;
}
function spreadsheetHyperlinkFormulaLabel(formula) {
  const normalized = formula.trim().replace(/^=/, "");
  const openIndex = normalized.indexOf("(");
  const closeIndex = normalized.lastIndexOf(")");
  if (openIndex < 0 || closeIndex <= openIndex) return null;
  if (normalized.slice(0, openIndex).trim().toUpperCase() !== "HYPERLINK") return null;
  const args = splitSpreadsheetFormulaArgs(normalized.slice(openIndex + 1, closeIndex));
  const displayArg = args[1]?.trim() || args[0]?.trim();
  if (!displayArg) return null;
  return spreadsheetStringLiteralValue(displayArg) ?? displayArg;
}
function splitSpreadsheetFormulaArgs(source) {
  const args = [];
  let current = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      current += char;
      if (inString && source[index + 1] === '"') {
        current += source[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (char === "," && !inString) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  args.push(current.trim());
  return args;
}
function spreadsheetStringLiteralValue(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
  return trimmed.slice(1, -1).replaceAll('""', '"');
}
function styleAt(values, index) {
  const styleIndex = asNumber(index, -1);
  if (styleIndex < 0) return null;
  return asRecord(asArray(values)[styleIndex]);
}

// src/shared/office-image-utils.ts
import { useMemo } from "react";
function imageReferenceId(value) {
  const record = asRecord(value);
  return asString(record?.id);
}
function elementImageReferenceId(element) {
  const direct = imageReferenceId(element.imageReference);
  if (direct) return direct;
  const fill = asRecord(element.fill);
  const fillImage = imageReferenceId(fill?.imageReference);
  if (fillImage) return fillImage;
  const shapeFill = asRecord(asRecord(element.shape)?.fill);
  return imageReferenceId(shapeFill?.imageReference);
}
function useOfficeImageSources(root) {
  const imageRecords = useMemo(() => {
    const rootImages = asArray(root?.images).map(asRecord).filter((image) => image != null);
    return [...rootImages.map(imagePayloadFromImageRecord), ...collectElementImagePayloads(root)].filter(
      (image) => image != null
    );
  }, [root]);
  const imageSources = useMemo(() => {
    const sources = [];
    for (const image of imageRecords) {
      const bytes = image.bytes;
      if (bytes != null && bytes.byteLength > 0) {
        const contentType = image.contentType || inferImageContentType(image.id);
        const payload = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(payload).set(bytes);
        const blob = new Blob([payload], { type: contentType });
        sources.push({ id: image.id, src: URL.createObjectURL(blob) });
        continue;
      }
      if (image.uri) {
        sources.push({ id: image.id, src: image.uri });
      }
    }
    return sources;
  }, [imageRecords]);
  return useMemo(() => {
    return new Map(imageSources.map((image) => [image.id, image.src]));
  }, [imageSources]);
}
function imagePayloadFromImageRecord(image) {
  const id = asString(image.id);
  if (!id) return null;
  return {
    bytes: bytesFromUnknown(image.data ?? image.bytes),
    contentType: asString(image.contentType),
    id,
    uri: asString(image.uri)
  };
}
function collectElementImagePayloads(root) {
  if (root == null) return [];
  const payloads = [];
  const seen = /* @__PURE__ */ new WeakSet();
  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = asRecord(value);
    if (record == null || seen.has(record)) return;
    seen.add(record);
    const image = asRecord(record.image);
    const id = imageReferenceId(record.imageReference);
    if (image != null && id) {
      payloads.push({
        bytes: bytesFromUnknown(image.data ?? image.bytes),
        contentType: asString(image.contentType),
        id,
        uri: asString(image.uri)
      });
    }
    for (const child of Object.values(record)) {
      if (typeof child === "object" && child !== null) {
        visit(child);
      }
    }
  }
  visit(root);
  return payloads;
}

// src/shared/office-chart-renderer.ts
var PRESENTATION_CHART_COLORS = ["#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"];
function presentationChartById(charts, id) {
  if (!id) return null;
  return charts.find((chart) => presentationChartId(chart) === id) ?? null;
}
function presentationChartId(chart) {
  return asString(chart.id) || asString(chart.uri) || asString(chart.chartId) || asString(chart.relationshipId) || asString(chart.name);
}
function presentationChartReferenceId(value) {
  const record = asRecord(value);
  return asString(record?.id) || asString(record?.chartId) || asString(record?.relationshipId) || asString(record?.referenceId) || asString(record?.ref);
}
function drawPresentationChart(context, chart, rect, slideScale) {
  context.save();
  context.beginPath();
  context.rect(0, 0, rect.width, rect.height);
  context.clip();
  context.fillStyle = "rgba(255, 255, 255, 0.86)";
  context.fillRect(0, 0, rect.width, rect.height);
  context.strokeStyle = "rgba(203, 213, 225, 0.9)";
  context.lineWidth = Math.max(1, slideScale);
  context.strokeRect(0, 0, rect.width, rect.height);
  const title = asString(chart.title);
  const titleHeight = title ? Math.max(18, 20 * slideScale) : 0;
  if (title) {
    context.fillStyle = "#111827";
    context.font = `600 ${Math.max(10, 14 * slideScale)}px Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(title, rect.width / 2, Math.max(4, 8 * slideScale), Math.max(1, rect.width - 16));
  }
  const series = presentationChartSeries(chart);
  if (series.length === 0) {
    context.restore();
    return;
  }
  const options = presentationChartOptions(chart);
  const leftReserve = Math.max(22, 38 * slideScale) + (options.yAxisTitle ? Math.max(12, 18 * slideScale) : 0);
  const bottomReserve = Math.max(26, 44 * slideScale) + (options.xAxisTitle ? Math.max(12, 18 * slideScale) : 0);
  const plot = {
    height: Math.max(1, rect.height - titleHeight - bottomReserve),
    left: leftReserve,
    top: titleHeight + Math.max(10, 18 * slideScale),
    width: Math.max(1, rect.width - leftReserve - Math.max(16, 20 * slideScale))
  };
  const type = asNumber(chart.type);
  if (type === 16 || type === 8) {
    drawPieChart(context, series[0], plot, type === 8, slideScale, options);
  } else if (type === 13 || type === 2 || type === 18) {
    drawLineChart(context, series, plot, slideScale, options);
  } else {
    drawBarChart(context, series, plot, asNumber(chart.barDirection) === 2, slideScale, options);
  }
  drawChartAxisTitles(context, options, plot, rect, slideScale);
  if (chart.hasLegend === true || asNumber(chart.hasLegend) > 0) {
    drawChartLegend(context, series, rect, slideScale);
  }
  context.restore();
}
function presentationChartOptions(chart) {
  const dataLabels = asRecord(chart.dataLabels);
  const xAxis = asRecord(chart.xAxis);
  const yAxis = asRecord(chart.yAxis);
  return {
    showDataLabels: dataLabels?.showValue === true || asNumber(dataLabels?.showValue) > 0,
    showMajorGridlines: yAxis == null || asRecord(yAxis.majorGridlines) != null || asRecord(yAxis.majorGridLines) != null,
    xAxisTitle: asString(xAxis?.title),
    yAxisTitle: asString(yAxis?.title)
  };
}
function presentationChartSeries(chart) {
  const chartCategories = asArray(chart.categories).map(asString).filter(Boolean);
  return asArray(chart.series).map(asRecord).filter((series) => series != null).map((series, index) => {
    const values = asArray(series.values ?? series.data).map((value) => asNumber(value, Number.NaN)).filter(Number.isFinite);
    const seriesCategories = asArray(series.categories).map(asString).filter(Boolean);
    return {
      categories: seriesCategories.length > 0 ? seriesCategories : chartCategories,
      color: fillToCss(series.fill) ?? PRESENTATION_CHART_COLORS[index % PRESENTATION_CHART_COLORS.length] ?? "#156082",
      name: asString(series.name) || `Series ${index + 1}`,
      values
    };
  }).filter((series) => series.values.length > 0);
}
function drawBarChart(context, series, plot, horizontal, slideScale, options) {
  const values = series.flatMap((item) => item.values);
  const max = Math.max(1, ...values);
  drawChartGrid(context, plot, 0, max, slideScale, options.showMajorGridlines);
  const categoryCount = Math.max(...series.map((item) => item.values.length));
  if (categoryCount <= 0) return;
  if (horizontal) {
    const rowHeight = plot.height / categoryCount;
    const barHeight = Math.max(1, rowHeight * 0.72 / series.length);
    for (const [seriesIndex, item] of series.entries()) {
      context.fillStyle = item.color;
      for (const [index, value] of item.values.entries()) {
        const width = Math.max(0, value) / max * plot.width;
        const x = plot.left;
        const y = plot.top + index * rowHeight + rowHeight * 0.14 + seriesIndex * barHeight;
        context.fillRect(x, y, width, Math.max(1, barHeight * 0.82));
        if (options.showDataLabels) {
          drawChartDataLabel(context, value, x + width + 3 * slideScale, y + barHeight * 0.41, slideScale, "left", "middle");
        }
      }
    }
    drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, true, slideScale);
    return;
  }
  const columnWidth = plot.width / categoryCount;
  const barWidth = Math.max(1, columnWidth * 0.72 / series.length);
  for (const [seriesIndex, item] of series.entries()) {
    context.fillStyle = item.color;
    for (const [index, value] of item.values.entries()) {
      const height = Math.max(0, value) / max * plot.height;
      const x = plot.left + index * columnWidth + columnWidth * 0.14 + seriesIndex * barWidth;
      const y = plot.top + plot.height - height;
      context.fillRect(x, y, Math.max(1, barWidth * 0.82), height);
      if (options.showDataLabels) {
        drawChartDataLabel(context, value, x + barWidth * 0.41, y - 2 * slideScale, slideScale, "center", "bottom");
      }
    }
  }
  drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, false, slideScale);
}
function drawLineChart(context, series, plot, slideScale, options) {
  const values = series.flatMap((item) => item.values);
  const range = chartAxisRange(values, false);
  drawChartGrid(context, plot, range.min, range.max, slideScale, options.showMajorGridlines);
  const maxPoints = Math.max(...series.map((item) => item.values.length));
  const xStep = maxPoints <= 1 ? plot.width : plot.width / (maxPoints - 1);
  for (const item of series) {
    context.strokeStyle = item.color;
    context.lineWidth = Math.max(1.5, slideScale * 1.8);
    context.beginPath();
    item.values.forEach((value, index) => {
      const x = plot.left + index * xStep;
      const y = plot.top + plot.height - (value - range.min) / Math.max(1, range.max - range.min) * plot.height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
      if (options.showDataLabels) {
        drawChartDataLabel(context, value, x, y - 4 * slideScale, slideScale, "center", "bottom");
      }
    });
    context.stroke();
  }
  drawChartCategoryLabels(context, series[0]?.categories ?? [], plot, false, slideScale);
}
function drawPieChart(context, series, plot, doughnut, slideScale, options) {
  const total = series.values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return;
  const radius = Math.max(1, Math.min(plot.width, plot.height) * 0.42);
  const cx = plot.left + plot.width / 2;
  const cy = plot.top + plot.height / 2;
  let angle = -Math.PI / 2;
  for (const [index, value] of series.values.entries()) {
    const nextAngle = angle + Math.max(0, value) / total * Math.PI * 2;
    context.fillStyle = PRESENTATION_CHART_COLORS[index % PRESENTATION_CHART_COLORS.length] ?? series.color;
    context.beginPath();
    context.moveTo(cx, cy);
    context.arc(cx, cy, radius, angle, nextAngle);
    context.closePath();
    context.fill();
    if (options.showDataLabels) {
      const midAngle = angle + (nextAngle - angle) / 2;
      drawChartDataLabel(
        context,
        value,
        cx + Math.cos(midAngle) * radius * 0.68,
        cy + Math.sin(midAngle) * radius * 0.68,
        slideScale,
        "center",
        "middle"
      );
    }
    angle = nextAngle;
  }
  if (doughnut) {
    context.fillStyle = "rgba(255, 255, 255, 0.92)";
    context.beginPath();
    context.arc(cx, cy, radius * 0.48, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.lineWidth = Math.max(1, slideScale);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.stroke();
}
function drawChartGrid(context, plot, min, max, slideScale, showMajorGridlines) {
  context.lineWidth = Math.max(0.5, slideScale);
  if (showMajorGridlines) {
    context.strokeStyle = "rgba(148, 163, 184, 0.42)";
    context.setLineDash([Math.max(2, slideScale * 3), Math.max(2, slideScale * 2)]);
    for (let index = 0; index <= 4; index++) {
      const y = plot.top + plot.height / 4 * index;
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.left + plot.width, y);
      context.stroke();
    }
    context.setLineDash([]);
  }
  context.strokeStyle = "rgba(100, 116, 139, 0.65)";
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.top + plot.height);
  context.lineTo(plot.left + plot.width, plot.top + plot.height);
  context.stroke();
  context.fillStyle = "#64748b";
  context.font = `400 ${Math.max(8, 10 * slideScale)}px Arial, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index++) {
    const value = max - (max - min) / 4 * index;
    const y = plot.top + plot.height / 4 * index;
    context.fillText(formatChartTick(value), plot.left - Math.max(4, 6 * slideScale), y);
  }
}
function drawChartAxisTitles(context, options, plot, rect, slideScale) {
  context.fillStyle = "#475569";
  context.font = `600 ${Math.max(8, 10 * slideScale)}px Arial, sans-serif`;
  if (options.xAxisTitle) {
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(options.xAxisTitle, plot.left + plot.width / 2, rect.height - Math.max(4, 7 * slideScale), plot.width);
  }
  if (options.yAxisTitle) {
    context.save();
    context.translate(Math.max(6, 10 * slideScale), plot.top + plot.height / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = "center";
    context.textBaseline = "top";
    context.fillText(options.yAxisTitle, 0, 0, plot.height);
    context.restore();
  }
}
function drawChartDataLabel(context, value, x, y, slideScale, align, baseline) {
  context.fillStyle = "#334155";
  context.font = `600 ${Math.max(7, 9 * slideScale)}px Arial, sans-serif`;
  context.textAlign = align;
  context.textBaseline = baseline;
  context.fillText(formatChartTick(value), x, y, Math.max(24, 48 * slideScale));
}
function drawChartCategoryLabels(context, categories, plot, horizontal, slideScale) {
  if (categories.length === 0) return;
  context.fillStyle = "#64748b";
  context.font = `400 ${Math.max(7, 9 * slideScale)}px Arial, sans-serif`;
  context.textBaseline = "top";
  if (horizontal) {
    context.textAlign = "right";
    const rowHeight = plot.height / categories.length;
    categories.slice(0, 12).forEach((category, index) => {
      context.fillText(category, plot.left - Math.max(4, 6 * slideScale), plot.top + index * rowHeight + rowHeight * 0.3);
    });
    return;
  }
  context.textAlign = "center";
  const step = categories.length <= 1 ? plot.width : plot.width / categories.length;
  const labelEvery = Math.max(1, Math.ceil(categories.length / 8));
  categories.forEach((category, index) => {
    if (index % labelEvery !== 0) return;
    const x = plot.left + step * index + step / 2;
    context.fillText(category, x, plot.top + plot.height + Math.max(4, 6 * slideScale), step * labelEvery);
  });
}
function drawChartLegend(context, series, rect, slideScale) {
  const swatch = Math.max(6, 8 * slideScale);
  const textSize = Math.max(8, 10 * slideScale);
  context.font = `400 ${textSize}px Arial, sans-serif`;
  context.textAlign = "left";
  context.textBaseline = "middle";
  let x = Math.max(8, rect.width * 0.2);
  const y = rect.height - Math.max(8, 14 * slideScale);
  for (const item of series.slice(0, 4)) {
    context.fillStyle = item.color;
    context.fillRect(x, y - swatch / 2, swatch, swatch);
    x += swatch + 4 * slideScale;
    context.fillStyle = "#64748b";
    context.fillText(item.name, x, y);
    x += context.measureText(item.name).width + 14 * slideScale;
  }
}
function chartAxisRange(values, includeZero) {
  if (values.length === 0) return { max: 1, min: 0 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  return { max: max + padding, min: min - padding };
}
function formatChartTick(value) {
  if (Math.abs(value) >= 1e3) return `${Math.round(value / 1e3)}k`;
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/u, "");
}

// src/word/word-layout.ts
var WORD_PREVIEW_CONTENT_WIDTH_PX = 720;
function wordImageStyle(element, imageSrc, pageLayout) {
  const contentWidth = pageLayout ? wordPageContentWidthPx(pageLayout) : WORD_PREVIEW_CONTENT_WIDTH_PX;
  const box = wordElementBox(element, contentWidth, 280, contentWidth);
  const fullBleed = pageLayout ? wordIsFullBleedElement(element, pageLayout) : false;
  const pageOverlay = pageLayout ? wordIsPageOverlayAnchoredElement(element, pageLayout) : false;
  const topBleed = fullBleed && wordElementY(element) <= 2;
  return {
    aspectRatio: box.hasDecodedSize ? `${box.rawWidth} / ${box.rawHeight}` : void 0,
    backgroundImage: `url("${imageSrc}")`,
    backgroundPosition: wordImageBackgroundPosition(element),
    backgroundRepeat: "no-repeat",
    backgroundSize: wordImageBackgroundSize(element, box, pageLayout),
    ...wordImageLineStyle(element),
    borderRadius: wordImageBorderRadius(element, pageLayout),
    boxShadow: wordImageBoxShadow(element, pageLayout),
    boxSizing: "border-box",
    display: "block",
    height: box.hasDecodedSize ? void 0 : box.height,
    left: pageOverlay && pageLayout ? wordPageAnchoredLeft(element, pageLayout, fullBleed ? pageLayout.widthPx : box.width) : void 0,
    marginLeft: pageOverlay ? void 0 : fullBleed ? "calc(-1 * var(--word-page-padding-left, 0px))" : wordImageFlowMarginLeft(element, box, pageLayout),
    marginTop: pageOverlay ? void 0 : topBleed ? "calc(-1 * var(--word-page-padding-top, 0px) - 16px)" : box.marginTop,
    maxHeight: box.hasDecodedSize ? void 0 : 360,
    maxWidth: fullBleed ? "none" : "100%",
    position: pageOverlay ? "absolute" : void 0,
    top: pageOverlay && pageLayout ? wordPageAnchoredTop(element, pageLayout, box.height) : void 0,
    width: fullBleed && pageLayout ? pageLayout.widthPx : box.hasDecodedSize ? box.width : "100%",
    zIndex: wordImageZIndex(element, pageOverlay)
  };
}
function wordChartStyle(element, pageLayout) {
  const contentWidth = pageLayout ? wordPageContentWidthPx(pageLayout, 560) : WORD_PREVIEW_CONTENT_WIDTH_PX;
  const box = wordElementBox(element, Math.min(560, contentWidth), 300, contentWidth);
  return {
    display: "block",
    height: box.height,
    margin: "12px 0 18px",
    marginLeft: box.marginLeft,
    marginTop: box.marginTop,
    maxWidth: "100%",
    width: box.width
  };
}
function wordTableContainerStyle(element, pageLayout) {
  const contentWidth = pageLayout ? wordPageContentWidthPx(pageLayout) : WORD_PREVIEW_CONTENT_WIDTH_PX;
  const box = wordElementBox(element, contentWidth, 0, contentWidth);
  return {
    margin: "12px 0 18px",
    marginLeft: box.marginLeft,
    marginTop: box.marginTop,
    maxWidth: "100%",
    overflowX: "auto",
    width: box.hasDecodedSize ? box.width : "100%"
  };
}
function wordTextBoxStyle(element, pageLayout) {
  const contentWidth = wordPageContentWidthPx(pageLayout);
  const box = wordElementBox(element, contentWidth, 80, contentWidth);
  return {
    boxSizing: "border-box",
    display: "block",
    height: box.hasDecodedSize ? box.height : void 0,
    left: wordPageAnchoredLeft(element, pageLayout, box.width),
    overflow: "hidden",
    position: "absolute",
    top: wordPageAnchoredTop(element, pageLayout, box.height),
    width: box.width,
    zIndex: wordImageZIndex(element, true) ?? 2
  };
}
function wordPositionedShapeStyle(element, pageLayout) {
  const contentWidth = wordPageContentWidthPx(pageLayout);
  const box = wordElementBox(element, contentWidth, 80, contentWidth);
  const line = lineToCss(element.line);
  const background = wordFillToCss(element.fill);
  return {
    backgroundColor: background,
    borderColor: line.color,
    borderStyle: line.color || asNumber(asRecord(element.line)?.widthEmu) > 0 ? "solid" : void 0,
    borderWidth: line.color || asNumber(asRecord(element.line)?.widthEmu) > 0 ? line.width : void 0,
    boxSizing: "border-box",
    display: "block",
    height: box.hasDecodedSize ? box.height : void 0,
    marginLeft: box.marginLeft,
    marginTop: box.marginTop,
    width: box.width
  };
}
function wordBodyContentStyle(root) {
  const columns = wordSectionColumns(root);
  const style = {
    boxSizing: "border-box",
    gridRow: 2,
    maxWidth: "100%",
    minHeight: 0,
    minWidth: 0,
    width: "100%"
  };
  if (!columns) return style;
  return {
    ...style,
    columnCount: columns.count,
    columnGap: columns.gapPx,
    columnRuleColor: columns.separator ? "#cbd5e1" : void 0,
    columnRuleStyle: columns.separator ? "solid" : void 0,
    columnRuleWidth: columns.separator ? 1 : void 0
  };
}
function wordDocumentPageStyleFromLayout(pageLayout) {
  return {
    height: pageLayout.heightPx > 0 ? Math.max(680, pageLayout.heightPx) : 680,
    paddingBottom: pageLayout.paddingBottom,
    paddingLeft: pageLayout.paddingLeft,
    paddingRight: pageLayout.paddingRight,
    paddingTop: pageLayout.paddingTop,
    width: pageLayout.widthPx > 0 ? pageLayout.widthPx : "100%"
  };
}
function wordDocumentPageCssVars(pageLayout) {
  return {
    "--word-page-padding-left": `${pageLayout.paddingLeft}px`,
    "--word-page-padding-right": `${pageLayout.paddingRight}px`,
    "--word-page-padding-top": `${pageLayout.paddingTop}px`
  };
}
function wordPageLayout(root) {
  const page = wordPageSetup(root);
  const widthPx = wordPageUnitToPx(page?.widthEmu ?? root?.widthEmu);
  const heightPx = wordPageUnitToPx(page?.heightEmu ?? root?.heightEmu);
  const margin = asRecord(page?.pageMargin);
  return {
    heightPx,
    paddingBottom: wordPageMarginPx(margin?.bottom, 56),
    paddingLeft: wordPageMarginPx(margin?.left, 64),
    paddingRight: wordPageMarginPx(margin?.right, 64),
    paddingTop: wordPageMarginPx(margin?.top, 56),
    widthPx: widthPx > 0 ? Math.max(480, Math.min(960, widthPx)) : 0
  };
}
function wordElementBox(element, fallbackWidth, fallbackHeight, containerWidth = WORD_PREVIEW_CONTENT_WIDTH_PX) {
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const yPx = emuToPx(box?.yEmu);
  const hasDecodedSize = rawWidth > 0 && (rawHeight > 0 || fallbackHeight <= 0);
  const width = hasDecodedSize ? Math.max(24, Math.min(containerWidth, rawWidth)) : fallbackWidth;
  const height = hasDecodedSize && rawHeight > 0 ? Math.max(18, rawHeight * (width / rawWidth)) : fallbackHeight;
  const maxOffset = Math.max(0, containerWidth - width);
  return {
    hasDecodedSize,
    height,
    marginLeft: xPx > 0 ? Math.min(maxOffset, xPx) : void 0,
    marginTop: yPx > 0 ? Math.min(240, yPx) : void 0,
    rawHeight,
    rawWidth,
    width
  };
}
function wordIsFullBleedElement(element, pageLayout) {
  if (pageLayout.widthPx <= 0) return false;
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const xPx = emuToPx(box?.xEmu);
  return rawWidth >= pageLayout.widthPx - 2 && Math.abs(xPx) <= 2;
}
function wordTableRowStyle(row) {
  const height = emuToPx(row.heightEmu ?? row.height);
  return {
    height: height > 0 ? Math.max(12, Math.min(240, height)) : void 0
  };
}
function wordTableStyle(hasColumnWidths) {
  return {
    borderCollapse: "collapse",
    minWidth: "70%",
    tableLayout: hasColumnWidths ? "fixed" : "auto",
    width: "100%"
  };
}
function wordTableCellStyle(cell, background, color) {
  return {
    backgroundColor: background,
    backgroundImage: wordTableDiagonalBorders(cell.lines),
    color,
    ...wordTableCellBorders(cell.lines),
    paddingBottom: tableCellPaddingPx(cell.marginBottom, 3),
    paddingLeft: tableCellPaddingPx(cell.marginLeft, 5),
    paddingRight: tableCellPaddingPx(cell.marginRight, 5),
    paddingTop: tableCellPaddingPx(cell.marginTop, 3),
    verticalAlign: wordVerticalAlign(cell.anchor)
  };
}
function wordPageContentWidthPx(pageLayout, fallback = WORD_PREVIEW_CONTENT_WIDTH_PX) {
  const contentWidth = pageLayout.widthPx - pageLayout.paddingLeft - pageLayout.paddingRight;
  return contentWidth > 0 ? Math.max(120, contentWidth) : fallback;
}
function wordFillToCss(fill) {
  const fillRecord = asRecord(fill);
  return fillToCss(fillRecord) ?? colorToCss(fillRecord?.color);
}
function readableTextColor(background) {
  const rgb = hexCssToRgb(background);
  if (rgb == null) return "#0f172a";
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance < 0.45 ? "#ffffff" : "#0f172a";
}
function wordImageBackgroundSize(element, box, pageLayout) {
  const crop = wordImageCrop(element);
  if (crop) {
    return `${100 / crop.visibleWidthPercent}% ${100 / crop.visibleHeightPercent}%`;
  }
  if (pageLayout && wordIsTopCircularPortraitImage(element, pageLayout, box)) return "cover";
  return "contain";
}
function wordImageBackgroundPosition(element) {
  const crop = wordImageCrop(element);
  if (!crop) return "center";
  return `${crop.xPercent}% ${crop.yPercent}%`;
}
function wordImageCrop(element) {
  const rect = asRecord(asRecord(element.fill)?.srcRect);
  if (!rect) return null;
  const left = wordCropFraction(rect.l);
  const top = wordCropFraction(rect.t);
  const right = wordCropFraction(rect.r);
  const bottom = wordCropFraction(rect.b);
  if (left === 0 && top === 0 && right === 0 && bottom === 0) return null;
  const visibleWidthPercent = Math.max(0.01, 1 - left - right);
  const visibleHeightPercent = Math.max(0.01, 1 - top - bottom);
  return {
    visibleHeightPercent,
    visibleWidthPercent,
    xPercent: left + right > 0 ? left / (left + right) * 100 : 50,
    yPercent: top + bottom > 0 ? top / (top + bottom) * 100 : 50
  };
}
function wordCropFraction(value) {
  const percentage = asNumber(value);
  if (!Number.isFinite(percentage) || percentage <= 0) return 0;
  return Math.min(0.99, percentage / 1e5);
}
function wordImageBorderRadius(element, pageLayout) {
  if (!pageLayout) return void 0;
  return wordIsTopCircularPortraitImage(element, pageLayout) ? "50%" : void 0;
}
function wordImageBoxShadow(element, pageLayout) {
  const protocolShadow = wordImageProtocolShadow(element);
  const portraitShadow = pageLayout && wordIsTopCircularPortraitImage(element, pageLayout) ? "inset 0 0 0 3px #ffffff, 0 0 0 2px rgba(71, 85, 105, 0.75)" : void 0;
  return [portraitShadow, protocolShadow].filter(Boolean).join(", ") || void 0;
}
function wordImageLineStyle(element) {
  const line = asRecord(element.line);
  if (!line) return {};
  const border = lineToCss(line);
  if (!border.color && asNumber(line.widthEmu) <= 0) return {};
  return {
    borderColor: border.color ?? "#0f172a",
    borderStyle: "solid",
    borderWidth: border.width
  };
}
function wordImageProtocolShadow(element) {
  for (const effect of asArray(element.effects)) {
    const shadow = asRecord(asRecord(effect)?.shadow);
    const color = colorToCss(shadow?.color);
    if (!shadow || !color) continue;
    const distance = emuToPx(shadow.distance);
    const direction = asNumber(shadow.direction) / 6e4 / 180 * Math.PI;
    return `${formatCssPx(Math.cos(direction) * distance)} ${formatCssPx(Math.sin(direction) * distance)} ${formatCssPx(emuToPx(shadow.blurRadius))} ${color}`;
  }
  return void 0;
}
function wordImageZIndex(element, pageOverlay) {
  if (!pageOverlay) return void 0;
  const decoded = asNumber(element.zIndex, 0);
  if (decoded < 0) return -1;
  if (decoded > 0) return Math.min(1e3, 2 + decoded);
  return 2;
}
function wordImageFlowMarginLeft(element, box, pageLayout) {
  if (!pageLayout || box.marginLeft == null) return box.marginLeft;
  if (!wordIsPageMarginAlignedTopImage(element, pageLayout)) return box.marginLeft;
  return Math.max(0, box.marginLeft - pageLayout.paddingLeft);
}
function wordIsPageFooterAnchoredElement(element, pageLayout) {
  if (pageLayout.heightPx <= 0 || pageLayout.widthPx <= 0 || wordIsFullBleedElement(element, pageLayout)) {
    return false;
  }
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const yPx = emuToPx(box?.yEmu);
  const footerBandTop = Math.max(pageLayout.heightPx * 0.72, pageLayout.heightPx - pageLayout.paddingBottom - 180);
  return rawWidth > 0 && rawHeight > 0 && yPx >= footerBandTop && yPx + rawHeight <= pageLayout.heightPx + 4;
}
function wordIsPageOverlayAnchoredElement(element, pageLayout) {
  if (wordIsPageFooterAnchoredElement(element, pageLayout)) return true;
  if (wordIsTopPageAnchoredSmallImage(element, pageLayout)) return true;
  if (wordIsTopGroupedPictureChildElement(element, pageLayout)) return true;
  if (!wordIsFullBleedElement(element, pageLayout)) return false;
  const yPx = wordElementY(element);
  return yPx > 2 && yPx < pageLayout.heightPx;
}
function wordIsTopPageAnchoredSmallImage(element, pageLayout) {
  if (wordIsFullBleedElement(element, pageLayout)) return false;
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const yPx = emuToPx(box?.yEmu);
  return rawWidth > 0 && rawHeight > 0 && rawWidth <= pageLayout.widthPx * 0.28 && rawHeight <= pageLayout.heightPx * 0.12 && xPx >= pageLayout.paddingLeft * 0.75 && yPx >= pageLayout.paddingTop * 0.8 && yPx <= pageLayout.heightPx * 0.2;
}
function wordIsTopGroupedPictureChildElement(element, pageLayout) {
  if (wordIsFullBleedElement(element, pageLayout)) return false;
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const yPx = emuToPx(box?.yEmu);
  return rawWidth > 0 && rawHeight > 0 && rawWidth <= pageLayout.widthPx * 0.4 && rawHeight >= pageLayout.heightPx * 0.18 && rawHeight <= pageLayout.heightPx * 0.32 && xPx >= pageLayout.paddingLeft && xPx + rawWidth <= pageLayout.widthPx - pageLayout.paddingRight && yPx >= 0 && yPx <= pageLayout.heightPx * 0.08;
}
function wordIsPageMarginAlignedTopImage(element, pageLayout) {
  if (wordIsFullBleedElement(element, pageLayout)) return false;
  const box = asRecord(element.bbox);
  const rawWidth = emuToPx(box?.widthEmu);
  const rawHeight = emuToPx(box?.heightEmu);
  const xPx = emuToPx(box?.xEmu);
  const yPx = emuToPx(box?.yEmu);
  return rawWidth > 0 && rawHeight > 0 && rawWidth <= pageLayout.widthPx * 0.35 && rawHeight <= pageLayout.heightPx * 0.16 && xPx >= pageLayout.paddingLeft * 0.75 && xPx <= pageLayout.paddingLeft * 1.3 && yPx <= pageLayout.heightPx * 0.32;
}
function wordIsTopCircularPortraitImage(element, pageLayout, elementBox) {
  if (!wordIsPageMarginAlignedTopImage(element, pageLayout)) return false;
  const box = elementBox ?? wordElementBox(element, wordPageContentWidthPx(pageLayout), 280, wordPageContentWidthPx(pageLayout));
  const aspectRatio = box.rawWidth > 0 && box.rawHeight > 0 ? box.rawWidth / box.rawHeight : box.width / box.height;
  return box.width >= 72 && box.width <= 180 && box.height >= 72 && box.height <= 180 && aspectRatio >= 0.85 && aspectRatio <= 1.15;
}
function wordPageAnchoredLeft(element, pageLayout, width) {
  const xPx = emuToPx(asRecord(element.bbox)?.xEmu);
  if (wordIsFullBleedElement(element, pageLayout)) return 0;
  const maxLeft = pageLayout.widthPx - width;
  return Math.max(0, Math.min(maxLeft, xPx));
}
function wordPageAnchoredTop(element, pageLayout, height) {
  const yPx = emuToPx(asRecord(element.bbox)?.yEmu);
  if (wordIsFullBleedElement(element, pageLayout) && yPx <= pageLayout.paddingTop) return 0;
  const maxTop = pageLayout.heightPx - height;
  return Math.max(0, Math.min(maxTop, yPx));
}
function wordElementY(element) {
  return emuToPx(asRecord(element.bbox)?.yEmu);
}
function wordTableDiagonalBorders(lines) {
  const lineRecord = asRecord(lines);
  if (lineRecord == null) return void 0;
  const gradients = [
    wordTableDiagonalBorder(lineRecord.diagonalDown ?? lineRecord.topLeftToBottomRight, "to bottom right"),
    wordTableDiagonalBorder(lineRecord.diagonalUp ?? lineRecord.topRightToBottomLeft, "to top right")
  ].filter(Boolean);
  return gradients.length > 0 ? gradients.join(", ") : void 0;
}
function wordTableDiagonalBorder(line, direction) {
  const lineRecord = asRecord(line);
  if (lineRecord == null) return void 0;
  const border = lineToCss(lineRecord);
  const color = border.color ?? "#cbd5e1";
  const halfWidth = Math.max(0.5, Math.min(3, border.width / 2));
  return `linear-gradient(${direction}, transparent calc(50% - ${halfWidth}px), ${color} calc(50% - ${halfWidth}px), ${color} calc(50% + ${halfWidth}px), transparent calc(50% + ${halfWidth}px))`;
}
function wordTableCellBorders(lines) {
  const lineRecord = asRecord(lines);
  if (lineRecord == null || Object.keys(lineRecord).length === 0) {
    return {
      borderColor: "#cbd5e1",
      borderStyle: "solid",
      borderWidth: 1
    };
  }
  return {
    borderWidth: 0,
    ...wordTableBorderSide("Top", lineRecord.top),
    ...wordTableBorderSide("Right", lineRecord.right),
    ...wordTableBorderSide("Bottom", lineRecord.bottom),
    ...wordTableBorderSide("Left", lineRecord.left)
  };
}
function wordTableBorderSide(side, line) {
  const lineRecord = asRecord(line);
  if (lineRecord == null) return {};
  const border = lineToCss(lineRecord);
  const css = {};
  css[`border${side}Color`] = border.color ?? "#cbd5e1";
  css[`border${side}Style`] = wordTableBorderStyle(lineRecord.style);
  css[`border${side}Width`] = border.width;
  return css;
}
function wordTableBorderStyle(style) {
  switch (asNumber(style)) {
    case 2:
      return "dashed";
    case 3:
      return "dotted";
    case 4:
    case 5:
      return "dashed";
    default:
      return "solid";
  }
}
function tableCellPaddingPx(value, fallback) {
  const emu = asNumber(value);
  if (emu <= 0) return fallback;
  return Math.max(2, Math.min(28, emuToPx(emu)));
}
function wordVerticalAlign(anchor) {
  switch (asString(anchor)) {
    case "center":
      return "middle";
    case "bottom":
      return "bottom";
    default:
      return "top";
  }
}
function wordSectionColumns(root) {
  const sections = asRecord(root?.columns) ? [root] : asArray(root?.sections).map(asRecord);
  for (const section of sections) {
    const columns = asRecord(section?.columns);
    const count = Math.floor(asNumber(columns?.count));
    if (count > 1) {
      const spaceTwips = asNumber(columns?.space);
      return {
        count,
        gapPx: spaceTwips > 0 ? Math.max(8, Math.min(96, spaceTwips / 15)) : void 0,
        separator: columns?.separator === true || columns?.hasSeparatorLine === true
      };
    }
  }
  return null;
}
function wordPageSetup(root) {
  const directPageSetup = asRecord(root?.pageSetup);
  if (directPageSetup) return directPageSetup;
  for (const section of asArray(root?.sections).map(asRecord)) {
    const pageSetup = asRecord(section?.pageSetup);
    if (pageSetup) return pageSetup;
  }
  return null;
}
function wordPageUnitToPx(value) {
  const raw = asNumber(value);
  if (raw <= 0) return 0;
  return raw > 1e5 ? raw / 9525 : raw / 15;
}
function wordPageMarginPx(value, fallback) {
  const px = wordPageUnitToPx(value);
  if (px <= 0) return fallback;
  return Math.max(24, Math.min(120, px));
}
function emuToPx(value) {
  return asNumber(value) / 9525;
}
function formatCssPx(value) {
  const rounded = Math.abs(value) < 0.01 ? 0 : Math.round(value * 100) / 100;
  return `${rounded}px`;
}
function hexCssToRgb(value) {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

// src/word/word-crop-marks.tsx
import { Fragment, jsx } from "react/jsx-runtime";
function WordPageCropMarks({ pageLayout }) {
  return /* @__PURE__ */ jsx(Fragment, { children: ["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => /* @__PURE__ */ jsx(
    "span",
    {
      "aria-hidden": "true",
      "data-testid": "word-page-crop-mark",
      style: wordPageCropMarkStyle(corner, pageLayout)
    },
    corner
  )) });
}
function wordPageCropMarkStyle(corner, pageLayout) {
  const size = 28;
  const offset = 2;
  const horizontalSide = corner.endsWith("left") ? "left" : "right";
  const verticalSide = corner.startsWith("top") ? "top" : "bottom";
  const style = {
    borderColor: "#a3a3a3",
    borderStyle: "solid",
    borderWidth: 0,
    height: size,
    pointerEvents: "none",
    position: "absolute",
    width: size,
    zIndex: 5
  };
  style[horizontalSide] = `${pageLayout[horizontalSide === "left" ? "paddingLeft" : "paddingRight"] - size - offset}px`;
  style[verticalSide] = `${pageLayout[verticalSide === "top" ? "paddingTop" : "paddingBottom"] - size - offset}px`;
  style[`border${horizontalSide === "left" ? "Right" : "Left"}Width`] = 2;
  style[`border${verticalSide === "top" ? "Bottom" : "Top"}Width`] = 2;
  return style;
}

// src/word/word-numbering.ts
function wordNumberingMarkers(elements, root, styleMaps) {
  const numberingByParagraphId = /* @__PURE__ */ new Map();
  for (const numbering of asArray(root?.paragraphNumberings)) {
    const record = asRecord(numbering);
    const paragraphId = asString(record?.paragraphId);
    const numId = asString(record?.numId);
    if (!paragraphId || !numId) continue;
    numberingByParagraphId.set(paragraphId, {
      level: Math.max(0, Math.floor(asNumber(record?.level))),
      numId
    });
  }
  const numberingDefinitions = wordNumberingDefinitionLevels(root);
  const counters = /* @__PURE__ */ new Map();
  const markers = /* @__PURE__ */ new Map();
  for (const paragraph of wordParagraphRecords(elements)) {
    const view = paragraphView(paragraph, styleMaps);
    const numbering = numberingByParagraphId.get(view.id);
    if (!numbering) continue;
    resetDeeperNumberingLevels(counters, numbering.numId, numbering.level);
    const counterKey = `${numbering.numId}:${numbering.level}`;
    const definition = numberingDefinitions.get(counterKey);
    const current = counters.has(counterKey) ? (counters.get(counterKey) ?? 0) + 1 : Math.max(1, Math.floor(asNumber(view.style?.autoNumberStartAt, asNumber(definition?.startAt, 1))));
    counters.set(counterKey, current);
    const marker = wordNumberingMarkerForDefinition(asString(view.style?.autoNumberType), definition, current);
    if (marker) markers.set(view.id, marker);
  }
  return markers;
}
function wordNumberingDefinitionLevels(root) {
  const levelsByKey = /* @__PURE__ */ new Map();
  for (const definition of asArray(root?.numberingDefinitions).map(asRecord)) {
    const numId = asString(definition?.numId);
    if (!numId) continue;
    for (const level of asArray(definition?.levels).map(asRecord)) {
      const levelIndex = Math.max(0, Math.floor(asNumber(level?.level)));
      levelsByKey.set(`${numId}:${levelIndex}`, {
        levelText: asString(level?.levelText),
        numberFormat: asString(level?.numberFormat),
        startAt: Math.max(1, Math.floor(asNumber(level?.startAt, 1)))
      });
    }
  }
  return levelsByKey;
}
function wordParagraphRecords(elements) {
  const paragraphs = [];
  for (const element of elements) {
    const record = asRecord(element);
    if (!record) continue;
    paragraphs.push(...asArray(record.paragraphs));
    const table = asRecord(record.table);
    for (const row of asArray(table?.rows)) {
      const rowRecord = asRecord(row);
      for (const cell of asArray(rowRecord?.cells)) {
        paragraphs.push(...asArray(asRecord(cell)?.paragraphs));
      }
    }
  }
  return paragraphs;
}
function resetDeeperNumberingLevels(counters, numId, level) {
  const prefix = `${numId}:`;
  for (const key of Array.from(counters.keys())) {
    if (!key.startsWith(prefix)) continue;
    const keyLevel = Number.parseInt(key.slice(prefix.length), 10);
    if (keyLevel > level) counters.delete(key);
  }
}
function wordNumberingMarker(type, value) {
  const alphaLc = alphabeticMarker(value, false);
  const alphaUc = alphabeticMarker(value, true);
  const romanUc = romanMarker(value);
  const romanLc = romanUc.toLowerCase();
  return {
    alphaLcParenR: `${alphaLc})`,
    alphaLcPeriod: `${alphaLc}.`,
    alphaUcParenR: `${alphaUc})`,
    alphaUcPeriod: `${alphaUc}.`,
    arabicParenR: `${value})`,
    arabicPeriod: `${value}.`,
    romanLcParenR: `${romanLc})`,
    romanLcPeriod: `${romanLc}.`,
    romanUcParenR: `${romanUc})`,
    romanUcPeriod: `${romanUc}.`
  }[type] ?? "";
}
function wordNumberingMarkerForDefinition(autoNumberType, definition, value) {
  if (autoNumberType) return wordNumberingMarker(autoNumberType, value);
  if (!definition) return "";
  const format = definition.numberFormat;
  const levelText = definition.levelText;
  if (format === "bullet") return wordBulletMarker(levelText);
  const markerValue = wordNumberingMarker(wordNumberingFormatAutoType(format), value);
  if (!markerValue) return "";
  if (!levelText.includes("%")) return markerValue;
  return levelText.replace(/%\d+/g, markerValue.replace(/[.)]$/u, ""));
}
function wordNumberingFormatAutoType(format) {
  return {
    decimal: "arabicPeriod",
    lowerLetter: "alphaLcPeriod",
    lowerRoman: "romanLcPeriod",
    upperLetter: "alphaUcPeriod",
    upperRoman: "romanUcPeriod"
  }[format] ?? "";
}
function alphabeticMarker(value, uppercase) {
  let remaining = Math.max(1, value);
  let marker = "";
  while (remaining > 0) {
    remaining -= 1;
    marker = String.fromCharCode(97 + remaining % 26) + marker;
    remaining = Math.floor(remaining / 26);
  }
  return uppercase ? marker.toUpperCase() : marker;
}
function romanMarker(value) {
  let remaining = Math.max(1, Math.min(3999, value));
  let marker = "";
  for (const [symbol, amount] of [
    ["M", 1e3],
    ["CM", 900],
    ["D", 500],
    ["CD", 400],
    ["C", 100],
    ["XC", 90],
    ["L", 50],
    ["XL", 40],
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1]
  ]) {
    while (remaining >= amount) {
      marker += symbol;
      remaining -= amount;
    }
  }
  return marker;
}
function wordBulletMarker(levelText) {
  return {
    "\uF0A7": "\u25AA",
    "\uF0B7": "\u2022",
    "\uF0D8": "\u27A2",
    "\uF0FC": "\u2713"
  }[levelText] ?? (levelText || "\u2022");
}

// src/word/word-paragraph-utils.ts
function wordParagraphHasVisibleContent(paragraph) {
  return Boolean(paragraph.marker) || paragraph.runs.some((run) => run.text.trim() !== "" || (run.referenceMarkers?.length ?? 0) > 0);
}
function wordElementsHaveRenderableContent(elements) {
  return elements.some((element) => {
    const record = asRecord(element);
    if (!record) return false;
    if (elementImageReferenceId(record) || asRecord(record.table) || asRecord(record.chartReference)) return true;
    return asArray(record.paragraphs).some(
      (paragraph) => wordParagraphHasVisibleContent(paragraphView(paragraph, { images: /* @__PURE__ */ new Map(), textStyles: /* @__PURE__ */ new Map() }))
    );
  });
}
function wordEmptyParagraphEstimatedHeight(style) {
  const before = Math.min(4, asNumber(style?.spaceBefore) / 20);
  const after = Math.min(4, asNumber(style?.spaceAfter) / 20);
  return Math.max(2, before + after);
}
function wordEmptyParagraphStyle(style) {
  return {
    ...style,
    fontSize: 0,
    lineHeight: 0,
    marginBottom: Math.min(asNumber(style.marginBottom), 4),
    marginTop: Math.min(asNumber(style.marginTop), 4),
    minHeight: 2
  };
}

// src/word/word-pagination.ts
import { measureRichInlineStats, prepareRichInline } from "@chenglou/pretext/rich-inline";

// src/word/word-table-pagination.ts
function wordSplitOversizedTableElements(elements, capacity, context) {
  return elements.flatMap((element) => wordSplitOversizedTableElement(element, capacity, context));
}
function wordTableElementEstimatedHeight(table, context) {
  const rowHeights = asArray(table.rows).map(asRecord).filter((row) => row != null).map((row) => wordTableRowEstimatedHeight(row, context));
  return Math.max(36, Math.min(900, wordTableEstimatedHeight(rowHeights)));
}
function wordSplitOversizedTableElement(element, capacity, context) {
  const record = asRecord(element);
  const table = asRecord(record?.table);
  const rows = asArray(table?.rows).map(asRecord).filter((row) => row != null);
  if (!record || !table || rows.length <= 1 || capacity <= 0) return [element];
  const rowHeights = rows.map((row) => wordTableRowEstimatedHeight(row, context));
  if (wordTableEstimatedHeight(rowHeights) <= capacity * 0.92) return [element];
  const chunks = [];
  let chunkRows = [];
  let chunkHeight = 0;
  const pushChunk = () => {
    if (chunkRows.length === 0) return;
    chunks.push({
      ...record,
      id: `${asString(record.id) || "table"}-chunk-${chunks.length + 1}`,
      table: { ...table, rows: chunkRows }
    });
    chunkRows = [];
    chunkHeight = 0;
  };
  rows.forEach((row, index) => {
    const rowHeight = rowHeights[index] ?? WORD_ESTIMATED_TABLE_ROW_HEIGHT;
    if (chunkRows.length > 0 && chunkHeight + rowHeight > Math.max(80, capacity * 1.18)) pushChunk();
    chunkRows.push(row);
    chunkHeight += rowHeight;
  });
  pushChunk();
  return chunks;
}
function wordTableEstimatedHeight(rowHeights) {
  return rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) + 24;
}
function wordTableRowEstimatedHeight(row, context) {
  const explicitHeight = emuToPx2(row.heightEmu ?? row.height);
  const cells = asArray(row.cells).map(asRecord).filter((cell) => cell != null);
  const cellContentWidth = context.contentWidth == null ? void 0 : Math.max(72, context.contentWidth / Math.max(1, cells.length) - 10);
  const contentHeight = cells.reduce((maxHeight, cell) => {
    const paragraphHeight = asArray(cell.paragraphs).reduce((total, paragraph) => {
      const height = cellContentWidth == null || context.tableParagraphHeight == null ? context.paragraphHeight(paragraph) : context.tableParagraphHeight(paragraph, cellContentWidth);
      return total + height;
    }, 0);
    return Math.max(maxHeight, paragraphHeight + tableCellPaddingPx2(cell.marginTop, 3) + tableCellPaddingPx2(cell.marginBottom, 3));
  }, 0);
  return Math.max(WORD_ESTIMATED_TABLE_ROW_HEIGHT, explicitHeight, contentHeight);
}
function tableCellPaddingPx2(value, fallback) {
  const emu = asNumber(value);
  if (emu <= 0) return fallback;
  return Math.max(2, Math.min(28, emuToPx2(emu)));
}
function emuToPx2(value) {
  return asNumber(value) / 9525;
}
var WORD_ESTIMATED_TABLE_ROW_HEIGHT = 20;

// src/word/word-text-box.tsx
import { jsx as jsx2 } from "react/jsx-runtime";
function WordPositionedTextBox({
  children,
  element,
  pageLayout
}) {
  return /* @__PURE__ */ jsx2("div", { "data-testid": "word-text-box", style: wordTextBoxStyle(element, pageLayout), children });
}
function wordIsPositionedTextBoxElement(element) {
  const bbox = asRecord(element.bbox);
  return asNumber(bbox?.widthEmu) > 0 && asNumber(bbox?.heightEmu) > 0 && asArray(element.paragraphs).length > 0 && !elementImageReferenceId(element) && asRecord(element.chartReference) == null && asRecord(element.table) == null;
}

// src/word/word-pagination.ts
var WORD_HEADING2_RULE_ESTIMATED_EXTRA_PX = 28;
var WORD_PRETEXT_WORD_LAYOUT_COMPENSATION = 1.06;
function wordPreviewPages(root, rootElements, styleMaps) {
  const sections = asArray(root?.sections).map(asRecord).filter((section) => section != null);
  const inheritedSectionContent = { footer: [], header: [] };
  const sectionPages = sections.map((section, index) => {
    const headerElements = wordInheritedSectionContentElements(section, "header", inheritedSectionContent);
    const footerElements = wordInheritedSectionContentElements(section, "footer", inheritedSectionContent);
    return {
      elements: asArray(section.elements),
      footerElements,
      headerElements,
      id: asString(section.id) || `section-${index + 1}`,
      root: section
    };
  }).filter((page) => page.elements.length > 0);
  if (sectionPages.some((page) => page.elements.length > 0)) {
    return wordPreviewSectionPages(root, rootElements, sectionPages, styleMaps);
  }
  return wordPaginatePreviewPages([
    {
      elements: wordCollapseTinyDuplicateImages(rootElements, root),
      footerElements: wordSectionContentElements(root, "footer"),
      headerElements: wordSectionContentElements(root, "header"),
      id: "document",
      root
    }
  ], styleMaps);
}
function wordInheritedSectionContentElements(section, key, inheritedContent) {
  const elements = wordSectionContentElements(section, key);
  if (elements.length === 0) return inheritedContent[key];
  inheritedContent[key] = elements;
  return elements;
}
function wordPreviewSectionPages(root, rootElements, sectionPages, styleMaps) {
  if (rootElements.length === 0) {
    return wordPaginatePreviewPages(
      sectionPages.map((page) => ({ ...page, elements: wordCollapseTinyDuplicateImages(page.elements, root) })),
      styleMaps
    );
  }
  let offset = 0;
  const pages = sectionPages.map((page, index) => {
    const nextOffset = offset + page.elements.length;
    const elements = index === sectionPages.length - 1 ? rootElements.slice(offset) : rootElements.slice(offset, nextOffset);
    offset = nextOffset;
    return { ...page, elements };
  }).filter((page) => page.elements.length > 0);
  return wordPaginatePreviewPages(
    pages.map((page) => ({ ...page, elements: wordCollapseTinyDuplicateImages(page.elements, root) })),
    styleMaps
  );
}
function wordPaginatePreviewPages(pages, styleMaps) {
  return wordMergePreviewOrphanPages(pages.flatMap((page) => wordPaginatePreviewPage(page, styleMaps)));
}
function wordPaginatePreviewPage(page, styleMaps) {
  const layout = wordPageLayout(page.root);
  const capacity = wordPageBodyCapacity(layout, page);
  const tableHeightContext = wordTableHeightContext(styleMaps, layout);
  const elements = wordSplitOversizedTableElements(page.elements, capacity, tableHeightContext);
  if (capacity <= 0 || elements.length <= 1) return [{ ...page, elements }];
  if (wordIsCoverLikeFullBleedPage(page, layout)) return [page];
  const chunks = [];
  let current = [];
  let currentHeight = 0;
  for (const [index, element] of elements.entries()) {
    const estimatedHeight = wordElementEstimatedHeight(element, styleMaps, layout);
    const nextElement = elements[index + 1];
    const keepWithNextHeight = wordElementKeepWithNextHeight(element, nextElement, styleMaps, layout);
    const shouldBreak = current.length > 0 && (currentHeight + estimatedHeight > capacity || currentHeight + estimatedHeight + keepWithNextHeight > capacity);
    if (shouldBreak) {
      chunks.push(wordPreviewPageChunk(page, chunks.length, current));
      current = [];
      currentHeight = 0;
    }
    current.push(element);
    currentHeight += estimatedHeight;
  }
  if (current.length > 0) {
    chunks.push(wordPreviewPageChunk(page, chunks.length, current));
  }
  return chunks.length > 0 ? chunks : [page];
}
function wordElementKeepWithNextHeight(element, nextElement, styleMaps, layout) {
  if (nextElement == null || !wordIsHeading2ParagraphElement(element)) return 0;
  return Math.min(32, wordElementEstimatedHeight(nextElement, styleMaps, layout));
}
function wordIsCoverLikeFullBleedPage(page, pageLayout) {
  return page.elements.length <= 12 && page.elements.some((element) => {
    const record = asRecord(element);
    return record != null && elementImageReferenceId(record) !== "" && wordIsFullBleedElement(record, pageLayout);
  });
}
function wordPreviewPageChunk(page, index, elements) {
  return {
    ...page,
    elements,
    id: `${page.id}-page-${index + 1}`
  };
}
function wordMergePreviewOrphanPages(pages) {
  const merged = [];
  for (const page of pages) {
    const previous = merged.at(-1);
    if (previous && wordCanMergeOrphanPage(previous, page)) {
      merged[merged.length - 1] = {
        ...previous,
        elements: [...previous.elements, ...page.elements]
      };
      continue;
    }
    merged.push(page);
  }
  return merged;
}
function wordCanMergeOrphanPage(previous, page) {
  return wordPreviewPageBaseId(previous.id) === wordPreviewPageBaseId(page.id) && page.elements.length === 1 && wordIsPlainParagraphElement(page.elements[0]) && !wordIsHeadingParagraphElement(page.elements[0]) && wordPlainParagraphTextLength(page.elements[0]) <= WORD_ORPHAN_PARAGRAPH_MAX_TEXT_LENGTH;
}
function wordPreviewPageBaseId(id) {
  return id.replace(/-page-\d+$/u, "");
}
function wordIsPlainParagraphElement(element) {
  const record = asRecord(element);
  return record != null && asRecord(record.table) == null && asRecord(record.chartReference) == null && elementImageReferenceId(record) === "" && asArray(record.paragraphs).length > 0;
}
function wordIsHeadingParagraphElement(element) {
  const paragraphs = asArray(asRecord(element)?.paragraphs).map(asRecord);
  return paragraphs.some((paragraph) => /^Heading/i.test(asString(paragraph?.styleId)));
}
function wordIsHeading2ParagraphElement(element) {
  const paragraphs = asArray(asRecord(element)?.paragraphs).map(asRecord);
  return paragraphs.some((paragraph) => asString(paragraph?.styleId) === "Heading2");
}
function wordPlainParagraphTextLength(element) {
  return asArray(asRecord(element)?.paragraphs).reduce((total, paragraph) => {
    const runs = asArray(asRecord(paragraph)?.runs);
    return total + runs.reduce((runTotal, run) => runTotal + asString(asRecord(run)?.text).trim().length, 0);
  }, 0);
}
var WORD_ORPHAN_PARAGRAPH_MAX_TEXT_LENGTH = 420;
function wordCollapseTinyDuplicateImages(elements, root) {
  const tinyImageIds = wordTinyImageIds(root);
  const collapsedElements = [];
  let previousImageBoxKey = "";
  for (const element of elements) {
    const record = asRecord(element);
    if (!record) {
      previousImageBoxKey = "";
      collapsedElements.push(element);
      continue;
    }
    const imageId = elementImageReferenceId(record);
    if (!imageId) {
      previousImageBoxKey = "";
      collapsedElements.push(element);
      continue;
    }
    const boxKey = wordImageBoxKey(record);
    const isTinyDuplicate = tinyImageIds.has(imageId) && boxKey !== "" && boxKey === previousImageBoxKey;
    previousImageBoxKey = boxKey;
    if (!isTinyDuplicate) collapsedElements.push(element);
  }
  return wordOrderFigureCaptionImages(collapsedElements);
}
function wordOrderFigureCaptionImages(elements) {
  const orderedElements = [];
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const nextElement = elements[index + 1];
    const followingElement = elements[index + 2];
    const record = asRecord(element);
    const nextRecord = asRecord(nextElement);
    const followingRecord = asRecord(followingElement);
    if (record != null && nextRecord != null && followingRecord != null && wordIsFigureCaptionElement(record) && wordIsPositionedShapeElement(nextRecord) && elementImageReferenceId(followingRecord)) {
      orderedElements.push(nextElement, followingElement, element);
      index += 2;
      continue;
    }
    if (record != null && nextRecord != null && wordIsFigureCaptionElement(record) && elementImageReferenceId(nextRecord)) {
      orderedElements.push(nextElement, element);
      index++;
      continue;
    }
    orderedElements.push(element);
  }
  return orderedElements;
}
function wordIsFigureCaptionElement(element) {
  const text = asArray(element.paragraphs).map((paragraph) => {
    const record = asRecord(paragraph);
    return asArray(record?.runs).map((run) => asString(asRecord(run)?.text)).join("");
  }).join("").trim();
  return /^Figure[-\s]/i.test(text);
}
function wordTinyImageIds(root) {
  const ids = /* @__PURE__ */ new Set();
  for (const image of asArray(root?.images).map(asRecord)) {
    const id = asString(image?.id);
    const bytes = bytesFromUnknown(image?.data ?? image?.bytes);
    if (id && bytes != null && bytes.byteLength > 0 && bytes.byteLength <= 100) {
      ids.add(id);
    }
  }
  return ids;
}
function wordImageBoxKey(element) {
  const box = asRecord(element.bbox);
  const x = Math.round(asNumber(box?.xEmu));
  const y = Math.round(asNumber(box?.yEmu));
  const width = Math.round(asNumber(box?.widthEmu));
  const height = Math.round(asNumber(box?.heightEmu));
  return width > 0 && height > 0 ? `${x}:${y}:${width}:${height}` : "";
}
function wordPageBodyCapacity(layout, page) {
  if (layout.heightPx <= 0) return 0;
  const headerReserve = wordElementsHaveRenderableContent(page.headerElements) ? 16 : 0;
  const footerReserve = wordElementsHaveRenderableContent(page.footerElements) ? 12 : 0;
  return Math.max(180, layout.heightPx - layout.paddingTop - layout.paddingBottom - headerReserve - footerReserve);
}
function wordElementEstimatedHeight(element, styleMaps, pageLayout) {
  const record = asRecord(element);
  if (!record) return 0;
  if (elementImageReferenceId(record)) {
    if (wordIsPageOverlayAnchoredElement(record, pageLayout)) return 0;
    return wordEstimatedBoxHeight(record, pageLayout, 280);
  }
  if (asRecord(record.chartReference)) {
    return wordEstimatedBoxHeight(record, pageLayout, 300) + 18;
  }
  const table = asRecord(record.table);
  if (table) {
    return wordTableElementEstimatedHeight(table, wordTableHeightContext(styleMaps, pageLayout));
  }
  if (wordIsPositionedShapeElement(record)) {
    return wordEstimatedBoxHeight(record, pageLayout, 80);
  }
  const paragraphs = asArray(record.paragraphs);
  if (paragraphs.length === 0) return 0;
  if (wordIsPositionedTextBoxElement(record)) return 0;
  return paragraphs.reduce(
    (total, paragraph) => total + wordParagraphEstimatedHeight(paragraph, styleMaps, pageLayout),
    0
  );
}
function wordEstimatedBoxHeight(element, pageLayout, fallbackHeight) {
  const contentWidth = wordPageContentWidthPx(pageLayout);
  const box = wordElementBox(element, contentWidth, fallbackHeight, contentWidth);
  const fullBleed = wordIsFullBleedElement(element, pageLayout);
  const height = fullBleed && box.rawWidth > 0 ? box.rawHeight * (pageLayout.widthPx / box.rawWidth) : box.height;
  return Math.max(18, Math.min(900, height + (box.marginTop ?? 0) + 16));
}
function wordParagraphEstimatedHeight(paragraph, styleMaps, pageLayout) {
  const view = paragraphView(paragraph, styleMaps);
  const style = view.style;
  if (!wordParagraphHasVisibleContent(view)) {
    return wordEmptyParagraphEstimatedHeight(style);
  }
  const textLength = Math.max(1, view.runs.reduce((total, run) => total + run.text.length, 0));
  const isTitle = view.styleId === "Title";
  const isHeading = /^Heading/i.test(view.styleId);
  const isTableOfContents = view.runs.map((run) => run.text).join("").trim().toLowerCase() === "table of contents";
  const fontSize = isTableOfContents ? wordCssFontSize(style?.fontSize, 30) : wordCssFontSize(style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14);
  const lineHeight = wordEstimatedLineHeight(style, fontSize);
  const contentWidth = Math.max(120, pageLayout.widthPx - pageLayout.paddingLeft - pageLayout.paddingRight);
  const averageCharWidth = Math.max(4, fontSize * 0.5);
  const charsPerLine = Math.max(8, Math.floor(contentWidth / averageCharWidth));
  const explicitLines = view.runs.reduce((count, run) => count + run.text.split("\n").length - 1, 0);
  const lines = Math.max(1, Math.ceil(textLength / charsPerLine) + explicitLines);
  const before = Math.min(32, asNumber(style?.spaceBefore) / 20);
  const after = Math.min(28, asNumber(style?.spaceAfter) / 20);
  const headingRuleReserve = view.styleId === "Heading2" ? WORD_HEADING2_RULE_ESTIMATED_EXTRA_PX : 0;
  const measuredTextHeight = wordMeasuredParagraphTextHeight(view, contentWidth, lineHeight);
  return Math.max(8, before + (measuredTextHeight ?? lines * lineHeight) + after + headingRuleReserve);
}
function wordTableHeightContext(styleMaps, pageLayout) {
  return {
    contentWidth: Math.max(120, pageLayout.widthPx - pageLayout.paddingLeft - pageLayout.paddingRight),
    paragraphHeight: (paragraph) => wordParagraphEstimatedHeight(paragraph, styleMaps, pageLayout),
    tableParagraphHeight: (paragraph, contentWidth) => wordTableParagraphEstimatedHeight(paragraph, styleMaps, contentWidth)
  };
}
function wordTableParagraphEstimatedHeight(paragraph, styleMaps, contentWidth) {
  const view = paragraphView(paragraph, styleMaps);
  const style = view.style;
  if (!wordParagraphHasVisibleContent(view)) return wordEmptyParagraphEstimatedHeight(style);
  const textLength = Math.max(1, view.runs.reduce((total, run) => total + run.text.length, 0));
  const fontSize = Math.min(wordCssFontSize(style?.fontSize, 10.5), 10.5);
  const lineHeight = fontSize * 1.15;
  const averageCharWidth = Math.max(4, fontSize * 0.48);
  const charsPerLine = Math.max(8, Math.floor(contentWidth / averageCharWidth));
  const explicitLines = view.runs.reduce((count, run) => count + run.text.split("\n").length - 1, 0);
  const lines = Math.max(1, Math.ceil(textLength / charsPerLine) + explicitLines);
  const measuredTextHeight = wordMeasuredParagraphTextHeight(view, contentWidth, lineHeight, fontSize);
  return Math.max(20, (measuredTextHeight ?? lines * lineHeight) + 1);
}
function wordMeasuredParagraphTextHeight(paragraph, contentWidth, lineHeight, fallbackFontSize) {
  if (contentWidth <= 0 || lineHeight <= 0) return null;
  if (!wordCanUsePretextMeasurement()) return null;
  if (paragraph.runs.some((run) => run.text.includes("\n"))) return null;
  const items = wordParagraphMeasurementItems(paragraph, fallbackFontSize);
  if (items.length === 0) return null;
  try {
    const prepared = prepareRichInline(items);
    const { lineCount } = measureRichInlineStats(prepared, contentWidth);
    return Math.max(1, lineCount) * lineHeight * WORD_PRETEXT_WORD_LAYOUT_COMPENSATION;
  } catch {
    return null;
  }
}
function wordCanUsePretextMeasurement() {
  return typeof OffscreenCanvas === "function";
}
function wordParagraphMeasurementItems(paragraph, fallbackFontSize) {
  const items = [];
  for (const run of paragraph.runs) {
    if (run.text.length === 0) continue;
    items.push({
      font: wordRunMeasurementFont(run, paragraph, fallbackFontSize),
      text: run.text
    });
  }
  return items;
}
function wordRunMeasurementFont(run, paragraph, fallbackFontSize) {
  const paragraphIsTitle = paragraph.styleId === "Title";
  const paragraphIsHeading = /^Heading/i.test(paragraph.styleId);
  const fontSize = run.style?.fontSize != null ? wordCssFontSize(run.style.fontSize, fallbackFontSize ?? 14) : fallbackFontSize ?? wordCssFontSize(paragraph.style?.fontSize, paragraphIsTitle ? 26 : paragraphIsHeading ? 18 : 14);
  const fontStyle = run.style?.italic === true ? "italic" : paragraph.style?.italic === true ? "italic" : "normal";
  const fontWeight = run.style?.bold === true || paragraph.style?.bold === true || paragraphIsTitle || paragraphIsHeading ? 700 : 400;
  const typeface = asString(run.style?.typeface) || asString(paragraph.style?.typeface);
  return `${fontStyle} ${fontWeight} ${fontSize}px ${officeFontFamily(typeface)}`;
}
function wordEstimatedLineHeight(style, fontSize) {
  const exactPoints = asNumber(style?.lineSpacing);
  if (exactPoints > 0) return Math.max(10, Math.min(128, exactPoints / 100 * (4 / 3)));
  const percent = asNumber(style?.lineSpacingPercent);
  if (percent > 0) return fontSize * Math.max(0.8, Math.min(3, percent / 1e5));
  return fontSize * 1.35;
}
function wordCssFontSize(value, fallbackPx) {
  const raw = asNumber(value);
  if (raw > 200) return Math.max(8, Math.min(72, raw / 100 * (4 / 3)));
  return cssFontSize(value, fallbackPx);
}
function wordSectionContentElements(root, key) {
  const directContent = asRecord(root?.[key]);
  const directElements = asArray(directContent?.elements);
  if (directElements.length > 0) return directElements;
  for (const section of asArray(root?.sections).map(asRecord)) {
    const content = asRecord(section?.[key]);
    const elements = asArray(content?.elements);
    if (elements.length > 0) return elements;
  }
  return [];
}
function wordIsPositionedShapeElement(element) {
  const bbox = asRecord(element.bbox);
  return asNumber(bbox?.widthEmu) > 0 && asNumber(bbox?.heightEmu) > 0 && asArray(element.paragraphs).length === 0 && !elementImageReferenceId(element) && asRecord(element.chartReference) == null && asRecord(element.table) == null && (asRecord(element.fill) != null || asRecord(element.line) != null);
}

// src/word/word-run-renderer.tsx
import { Fragment as Fragment2, jsx as jsx3, jsxs } from "react/jsx-runtime";
function wordHyperlinkHref(hyperlink) {
  const record = asRecord(hyperlink);
  const uri = asString(record?.uri);
  const action = asString(record?.action);
  return uri || action;
}
function WordRun({ inheritFont = false, run }) {
  const href = wordHyperlinkHref(run.hyperlink);
  const style = wordRunStyle(run, href !== "", inheritFont);
  const text = href ? /* @__PURE__ */ jsx3(
    "a",
    {
      href,
      rel: run.hyperlink?.isExternal === true ? "noreferrer" : void 0,
      style,
      target: run.hyperlink?.isExternal === true ? "_blank" : void 0,
      children: run.text
    }
  ) : /* @__PURE__ */ jsx3("span", { style, children: run.text });
  const markers = run.referenceMarkers ?? [];
  if (markers.length === 0) return text;
  return /* @__PURE__ */ jsxs(Fragment2, { children: [
    text,
    markers.map((marker) => /* @__PURE__ */ jsx3("sup", { style: wordReferenceMarkerStyle, children: marker }, `${run.id}-${marker}`))
  ] });
}
function wordParagraphHasTab(paragraph) {
  return paragraph.runs.some((run) => run.text.includes("	"));
}
function wordParagraphUsesLeaderTab(paragraph, trailingText) {
  if (!wordParagraphHasTab(paragraph)) return false;
  if (trailingText) return true;
  const { rightRuns } = wordSplitParagraphRunsAtLastTab(paragraph.runs);
  const rightText = rightRuns.map((run) => run.text).join("").trim();
  return /^\d+$/.test(rightText);
}
function wordSplitParagraphRunsAtLastTab(runs) {
  const leftRuns = [];
  const rightRuns = [];
  let foundTab = false;
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    const tabIndex = run.text.lastIndexOf("	");
    if (!foundTab && tabIndex >= 0) {
      const before = run.text.slice(0, tabIndex);
      const after = run.text.slice(tabIndex + 1);
      if (after) rightRuns.unshift({ ...run, id: `${run.id}-tab-right`, text: after });
      if (before) leftRuns.unshift({ ...run, id: `${run.id}-tab-left`, text: before });
      foundTab = true;
      continue;
    }
    if (foundTab) {
      leftRuns.unshift(run);
    } else {
      rightRuns.unshift(run);
    }
  }
  return { leftRuns, rightRuns };
}
function wordRunStyle(run, hyperlink, inheritFont = false) {
  const style = {
    ...textRunStyle(run),
    ...wordReviewMarkStyle(run.reviewMarkTypes ?? [])
  };
  if (run.style?.fontSize != null) {
    style.fontSize = wordCssFontSize(run.style.fontSize, 14);
  }
  if (inheritFont) {
    delete style.fontFamily;
    delete style.fontSize;
    delete style.fontWeight;
  }
  if (!hyperlink || wordHyperlinkHref(run.hyperlink).startsWith("#")) return style;
  return {
    ...style,
    color: style.color ?? "#2563eb",
    textDecoration: style.textDecoration ?? "underline"
  };
}
function wordReviewMarkStyle(types) {
  if (types.includes(2)) return { color: "#b91c1c", textDecoration: "line-through" };
  if (types.includes(1)) return { backgroundColor: "#dcfce7", textDecoration: "underline", textDecorationColor: "#16a34a" };
  return {};
}
function wordReviewMarkTypes(root) {
  const reviewMarkTypes = /* @__PURE__ */ new Map();
  for (const reviewMark of asArray(root?.reviewMarks).map(asRecord)) {
    const id = asString(reviewMark?.id);
    const type = asNumber(reviewMark?.type);
    if (id && type > 0) reviewMarkTypes.set(id, type);
  }
  return reviewMarkTypes;
}
function wordReferenceMarkers(root) {
  const markers = /* @__PURE__ */ new Map();
  for (const [index, footnote2] of asArray(root?.footnotes).map(asRecord).entries()) {
    if (!footnote2) continue;
    for (const runId of asArray(footnote2.referenceRunIds).map(asString).filter(Boolean)) {
      addReferenceMarker(markers, runId, String(index + 1));
    }
  }
  const commentOrder = /* @__PURE__ */ new Map();
  for (const [index, comment] of asArray(root?.comments).map(asRecord).entries()) {
    const id = asString(comment?.id);
    if (id) commentOrder.set(id, index + 1);
  }
  for (const reference of asArray(root?.commentReferences).map(asRecord)) {
    const commentId = asString(reference?.commentId);
    const markerIndex = commentOrder.get(commentId) ?? commentOrder.size + 1;
    for (const runId of asArray(reference?.runIds).map(asString).filter(Boolean)) {
      addReferenceMarker(markers, runId, `C${markerIndex}`);
    }
  }
  return markers;
}
function addReferenceMarker(markers, runId, marker) {
  const existing = markers.get(runId) ?? [];
  if (!existing.includes(marker)) {
    markers.set(runId, [...existing, marker]);
  }
}
var wordReferenceMarkerStyle = { color: "#475569", fontSize: "0.72em", marginLeft: 2 };

// src/word/word-paragraph-renderer.tsx
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
function WordParagraph({
  fallbackColor,
  paragraph,
  trailingText,
  variant = "body"
}) {
  const style = variant === "table" ? wordTableParagraphStyle(paragraph) : wordParagraphStyle(paragraph);
  if (fallbackColor && asRecord(paragraph.style?.fill)?.color == null) {
    style.color = fallbackColor;
  }
  if (!trailingText && !wordParagraphHasVisibleContent(paragraph)) {
    return /* @__PURE__ */ jsx4("p", { "aria-hidden": "true", style: wordEmptyParagraphStyle(style) });
  }
  if (wordParagraphUsesLeaderTab(paragraph, trailingText)) {
    return /* @__PURE__ */ jsx4(WordTabbedParagraph, { paragraph, style, trailingText });
  }
  const inheritRunFont = wordIsTableOfContentsTitle(paragraph);
  return /* @__PURE__ */ jsxs2("p", { style, children: [
    paragraph.marker ? /* @__PURE__ */ jsx4("span", { "aria-hidden": "true", style: wordParagraphMarkerStyle(paragraph.marker), children: paragraph.marker }) : null,
    paragraph.runs.map((run, index) => /* @__PURE__ */ jsx4(WordRun, { inheritFont: inheritRunFont, run }, run.id || index)),
    trailingText ? /* @__PURE__ */ jsx4("span", { style: wordComputedPageNumberStyle, children: trailingText }) : null
  ] });
}
function WordTabbedParagraph({
  paragraph,
  style,
  trailingText
}) {
  const { leftRuns, rightRuns } = wordSplitParagraphRunsAtLastTab(paragraph.runs);
  return /* @__PURE__ */ jsxs2("p", { style: { ...style, alignItems: "baseline", display: "flex", gap: 8, whiteSpace: "nowrap" }, children: [
    /* @__PURE__ */ jsxs2("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "clip" }, children: [
      paragraph.marker ? /* @__PURE__ */ jsx4("span", { "aria-hidden": "true", style: wordParagraphMarkerStyle(paragraph.marker), children: paragraph.marker }) : null,
      leftRuns.map((run, index) => /* @__PURE__ */ jsx4(WordRun, { run }, `${run.id || index}-left-${index}`))
    ] }),
    /* @__PURE__ */ jsx4("span", { "aria-hidden": "true", style: wordTabLeaderStyle }),
    /* @__PURE__ */ jsxs2("span", { style: { flex: "0 0 auto", textAlign: "right" }, children: [
      rightRuns.map((run, index) => /* @__PURE__ */ jsx4(WordRun, { run }, `${run.id || index}-right-${index}`)),
      trailingText ? /* @__PURE__ */ jsx4("span", { style: wordComputedPageNumberStyle, children: trailingText }) : null
    ] })
  ] });
}
function wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes) {
  const view = paragraphView(paragraph, styleMaps);
  const marker = numberingMarkers.get(view.id) || asString(view.style?.bulletCharacter);
  const runs = view.runs.map((run) => ({
    ...run,
    referenceMarkers: referenceMarkers.get(run.id) ?? [],
    reviewMarkTypes: (run.reviewMarkIds ?? []).map((id) => reviewMarkTypes.get(id) ?? 0).filter((type) => type > 0)
  }));
  return marker ? { ...view, marker, runs } : { ...view, runs };
}
function wordParagraphStyle(paragraph) {
  const style = paragraphStyle(paragraph);
  const isTitle = paragraph.styleId === "Title";
  const isHeading = /^Heading/i.test(paragraph.styleId);
  const isTocTitle = wordIsTableOfContentsTitle(paragraph);
  const fontSize = wordParagraphFontSize(paragraph, paragraph.style, isTitle, isHeading);
  const hasText = paragraph.runs.some((run) => run.text.trim() !== "");
  return {
    ...style,
    ...paragraph.styleId === "Heading2" && hasText ? wordHeading2RuleStyle : {},
    ...isTocTitle ? wordTableOfContentsTitleStyle : {},
    fontSize,
    lineHeight: wordParagraphCssLineHeight(paragraph, fontSize),
    ...wordParagraphHasTab(paragraph) ? wordParagraphTabStopStyle : {}
  };
}
function wordParagraphFontSize(paragraph, style, isTitle, isHeading) {
  if (wordIsTableOfContentsTitle(paragraph)) return wordCssFontSize(style?.fontSize, 30);
  return wordCssFontSize(style?.fontSize, isTitle ? 26 : isHeading ? 18 : 14);
}
function wordIsTableOfContentsTitle(paragraph) {
  const text = paragraph.runs.map((run) => run.text).join("").trim().toLowerCase();
  return text === "table of contents";
}
function wordParagraphCssLineHeight(paragraph, fontSize) {
  const exactPoints = asNumber(paragraph.style?.lineSpacing);
  if (exactPoints > 0) return `${wordEstimatedLineHeight(paragraph.style, fontSize)}px`;
  const percent = asNumber(paragraph.style?.lineSpacingPercent);
  if (percent > 0) return Math.max(0.8, Math.min(3, percent / 1e5));
  return 1.35;
}
function wordTableParagraphStyle(paragraph) {
  const style = wordParagraphStyle(paragraph);
  style.fontSize = Math.min(asNumber(style.fontSize, 10.5), 10.5);
  style.lineHeight = 1.15;
  style.marginBottom = 1;
  style.marginTop = 0;
  return style;
}
var wordHeading2RuleStyle = {
  borderBottom: "1px solid #3c9faa",
  borderTop: "1px solid #3c9faa",
  marginBottom: 18,
  marginTop: 18,
  paddingBottom: 6,
  paddingTop: 6
};
var WORD_PARAGRAPH_TAB_SIZE = 4;
var wordTableOfContentsTitleStyle = {
  fontFamily: '"Bitter", Georgia, "Times New Roman", serif',
  fontWeight: 700,
  marginBottom: 28
};
var wordParagraphTabStopStyle = {
  tabSize: WORD_PARAGRAPH_TAB_SIZE
};
var wordTabLeaderStyle = {
  borderBottom: "1px dotted currentColor",
  flex: "1 1 auto",
  height: 0,
  marginBottom: "0.25em",
  minWidth: 24,
  opacity: 1
};
function wordParagraphMarkerStyle(marker) {
  const isBullet = /^[•●○▪■o]$/u.test(marker);
  return {
    color: isBullet ? "#4aa6b2" : void 0,
    display: "inline-block",
    fontSize: isBullet ? "1.08em" : void 0,
    fontWeight: isBullet ? 700 : void 0,
    minWidth: isBullet ? "1.9em" : "2.25em",
    paddingRight: "0.35em",
    textAlign: "right"
  };
}
var wordComputedPageNumberStyle = { marginLeft: 4 };

// src/word/word-notes-renderer.tsx
import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
function WordSupplementalNotes({
  numberingMarkers,
  referenceMarkers,
  reviewMarkTypes,
  root,
  styleMaps
}) {
  const items = wordSupplementalNoteItems(root, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes);
  if (items.length === 0) return null;
  return /* @__PURE__ */ jsx5("section", { style: wordSupplementalNotesStyle, children: items.map((item) => /* @__PURE__ */ jsxs3("div", { style: wordSupplementalNoteStyle, children: [
    item.meta ? /* @__PURE__ */ jsx5("div", { style: wordSupplementalNoteMetaStyle, children: item.meta }) : null,
    item.paragraphs.map((paragraph, index) => /* @__PURE__ */ jsx5(WordParagraph, { paragraph }, paragraph.id || `${item.id}-${index}`))
  ] }, item.id)) });
}
function wordSupplementalNoteItems(root, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes) {
  const items = [];
  for (const [index, footnote2] of asArray(root?.footnotes).map(asRecord).entries()) {
    if (!footnote2) continue;
    const paragraphs = wordSupplementalParagraphs(
      footnote2,
      String(index + 1),
      styleMaps,
      numberingMarkers,
      referenceMarkers,
      reviewMarkTypes
    );
    if (paragraphs.length > 0) {
      items.push({ id: `footnote-${asString(footnote2.id) || index}`, paragraphs });
    }
  }
  for (const [index, comment] of asArray(root?.comments).map(asRecord).entries()) {
    if (!comment) continue;
    const paragraphs = wordSupplementalParagraphs(
      comment,
      `C${index + 1}`,
      styleMaps,
      numberingMarkers,
      referenceMarkers,
      reviewMarkTypes
    );
    if (paragraphs.length > 0) {
      items.push({
        id: `comment-${asString(comment.id) || index}`,
        meta: wordCommentMeta(comment),
        paragraphs
      });
    }
  }
  return items;
}
function wordCommentMeta(comment) {
  const author = asString(comment.author);
  const initials = asString(comment.initials);
  const createdAt = asString(comment.createdAt || comment.date);
  const parts = [author, initials ? `(${initials})` : "", createdAt].map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : void 0;
}
function wordFooterNeedsComputedPageNumber(elements) {
  const text = elements.map(wordElementVisibleText).join("").trimEnd();
  return /\|\s*$/u.test(text);
}
function wordElementVisibleText(element) {
  const record = asRecord(element);
  if (!record) return "";
  return asArray(record.paragraphs).map((paragraph) => asArray(asRecord(paragraph)?.runs).map((run) => asString(asRecord(run)?.text)).join("")).join("");
}
function wordSupplementalParagraphs(record, marker, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes) {
  return asArray(record.paragraphs).map((paragraph, index) => {
    const view = wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes);
    return index === 0 ? { ...view, marker } : view;
  });
}
var wordSupplementalNotesStyle = {
  borderTop: "1px solid #cbd5e1",
  display: "grid",
  gap: 4,
  gridRow: 3,
  marginTop: 18,
  paddingTop: 10
};
var wordSupplementalNoteStyle = { color: "#334155", fontSize: 12 };
var wordSupplementalNoteMetaStyle = { color: "#64748b", fontSize: 11, fontWeight: 600, marginBottom: 2 };

// src/word/word-table-renderer.tsx
import { jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
function WordTable({
  element,
  numberingMarkers,
  pageLayout,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  table
}) {
  const rows = asArray(table.rows).map(asRecord).filter((row) => row != null);
  if (rows.length === 0) return null;
  const columnWidths = asArray(table.columnWidths).map((width) => asNumber(width)).filter((width) => width > 0);
  const columnWidthTotal = columnWidths.reduce((total, width) => total + width, 0);
  return /* @__PURE__ */ jsx6("div", { style: wordTableContainerStyle(element, pageLayout), children: /* @__PURE__ */ jsxs4("table", { style: wordTableStyle(columnWidths.length > 0), children: [
    columnWidths.length > 0 ? /* @__PURE__ */ jsx6("colgroup", { children: columnWidths.map((width, index) => /* @__PURE__ */ jsx6("col", { style: { width: `${width / columnWidthTotal * 100}%` } }, `${width}-${index}`)) }) : null,
    /* @__PURE__ */ jsx6("tbody", { children: rows.map((row, rowIndex) => /* @__PURE__ */ jsx6("tr", { style: wordTableRowStyle(row), children: asArray(row.cells).map((cell, cellIndex) => {
      const cellRecord = asRecord(cell) ?? {};
      const paragraphs = asArray(cellRecord.paragraphs).map(
        (paragraph) => wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes)
      );
      const background = wordFillToCss(cellRecord.fill) ?? (rowIndex === 0 ? "#f8fafc" : "#ffffff");
      const fallbackTextColor = readableTextColor(background);
      const gridSpan = Math.max(1, Math.floor(asNumber(cellRecord.gridSpan, 1)));
      const rowSpan = Math.max(1, Math.floor(asNumber(cellRecord.rowSpan, 1)));
      return /* @__PURE__ */ jsx6(
        "td",
        {
          colSpan: gridSpan > 1 ? gridSpan : void 0,
          rowSpan: rowSpan > 1 ? rowSpan : void 0,
          style: wordTableCellStyle(cellRecord, background, fallbackTextColor),
          children: paragraphs.length > 0 ? paragraphs.map((paragraph, index) => /* @__PURE__ */ jsx6(
            WordParagraph,
            {
              fallbackColor: fallbackTextColor,
              paragraph,
              variant: "table"
            },
            paragraph.id || index
          )) : asString(cellRecord.text)
        },
        asString(cellRecord.id) || cellIndex
      );
    }) }, asString(row.id) || rowIndex)) })
  ] }) });
}

// src/word/word-preview.tsx
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs5 } from "react/jsx-runtime";
function WordPreview({ labels, proto }) {
  const root = asRecord(proto);
  const elements = asArray(root?.elements);
  const charts = asArray(root?.charts).map(asRecord).filter((chart) => chart != null);
  const imageSources = useOfficeImageSources(root);
  const textStyles = /* @__PURE__ */ new Map();
  for (const style of asArray(root?.textStyles)) {
    const record = asRecord(style);
    const id = asString(record?.id);
    if (record && id) textStyles.set(id, record);
  }
  const styleMaps = { textStyles, images: imageSources };
  const pages = wordPreviewPages(root, elements, styleMaps);
  const numberingMarkers = wordNumberingMarkers(elements, root, styleMaps);
  const referenceMarkers = wordReferenceMarkers(root);
  const reviewMarkTypes = wordReviewMarkTypes(root);
  const hasRenderableBlocks = pages.flatMap((page) => [...page.headerElements, ...page.elements, ...page.footerElements]).some((element) => {
    const record = asRecord(element);
    return record != null && (asArray(record.paragraphs).length > 0 || asRecord(record.table) != null || asRecord(record.chartReference) != null || elementImageReferenceId(record) !== "");
  });
  if (!hasRenderableBlocks) {
    const blocks = collectTextBlocks(elements.length > 0 ? elements : proto, 120);
    if (blocks.length === 0) {
      return /* @__PURE__ */ jsx7("p", { style: { color: "#64748b" }, children: labels.noDocumentBlocks });
    }
    return /* @__PURE__ */ jsx7("div", { "data-testid": "document-preview", style: { display: "grid", gap: 10 }, children: blocks.map((block, index) => /* @__PURE__ */ jsx7("p", { style: documentFallbackBlockStyle, children: block }, `${block.slice(0, 24)}-${index}`)) });
  }
  const renderedPages = pages.map((page, index) => /* @__PURE__ */ jsx7(
    WordDocumentPage,
    {
      charts,
      elements: page.elements,
      footerElements: page.footerElements,
      headerElements: page.headerElements,
      numberingMarkers,
      pageNumber: index + 1,
      pageLayout: wordPageLayout(page.root),
      pageRoot: page.root,
      referenceMarkers,
      reviewMarkTypes,
      supplementalRoot: index === pages.length - 1 ? root : null,
      styleMaps
    },
    page.id || index
  ));
  return pages.length > 1 ? /* @__PURE__ */ jsx7("div", { style: wordDocumentStackStyle, children: renderedPages }) : renderedPages[0];
}
function WordDocumentPage({
  charts,
  elements,
  footerElements,
  headerElements,
  numberingMarkers,
  pageNumber,
  pageLayout,
  pageRoot,
  referenceMarkers,
  reviewMarkTypes,
  supplementalRoot,
  styleMaps
}) {
  return /* @__PURE__ */ jsxs5(
    "article",
    {
      "data-testid": "document-preview",
      style: {
        ...wordDocumentPageStyleFromLayout(pageLayout),
        ...wordDocumentPageCssVars(pageLayout),
        background: "#ffffff",
        borderColor: "#d8e0ea",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxSizing: "border-box",
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
        color: "#0f172a",
        display: "grid",
        gap: 6,
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "auto minmax(0, 1fr) auto auto",
        isolation: "isolate",
        margin: "0 auto",
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        position: "relative"
      },
      children: [
        /* @__PURE__ */ jsx7(WordPageCropMarks, { pageLayout }),
        /* @__PURE__ */ jsx7(
          WordSectionContent,
          {
            charts,
            elements: headerElements,
            numberingMarkers,
            pageNumber,
            referenceMarkers,
            reviewMarkTypes,
            pageLayout,
            styleMaps,
            variant: "header"
          }
        ),
        /* @__PURE__ */ jsx7("section", { "data-testid": "word-body-content", style: wordBodyContentStyle(pageRoot), children: elements.map((element, index) => /* @__PURE__ */ jsx7(
          WordElement,
          {
            charts,
            element: asRecord(element) ?? {},
            numberingMarkers,
            pageLayout,
            referenceMarkers,
            reviewMarkTypes,
            styleMaps
          },
          `${asString(asRecord(element)?.id)}-${index}`
        )) }),
        /* @__PURE__ */ jsx7(
          WordSupplementalNotes,
          {
            numberingMarkers,
            referenceMarkers,
            reviewMarkTypes,
            root: supplementalRoot,
            styleMaps
          }
        ),
        /* @__PURE__ */ jsx7(
          WordSectionContent,
          {
            charts,
            elements: footerElements,
            numberingMarkers,
            pageNumber,
            referenceMarkers,
            reviewMarkTypes,
            pageLayout,
            styleMaps,
            variant: "footer"
          }
        )
      ]
    }
  );
}
function WordSectionContent({
  charts,
  elements,
  numberingMarkers,
  pageNumber,
  pageLayout,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  variant
}) {
  if (!wordElementsHaveRenderableContent(elements)) return null;
  const computedPageNumber = variant === "footer" && pageNumber > 1 && wordFooterNeedsComputedPageNumber(elements) ? String(pageNumber) : void 0;
  return /* @__PURE__ */ jsx7("section", { style: variant === "header" ? wordHeaderContentStyle : wordFooterContentStyle, children: elements.map((element, index) => /* @__PURE__ */ jsx7(
    WordElement,
    {
      charts,
      element: asRecord(element) ?? {},
      numberingMarkers,
      pageLayout,
      referenceMarkers,
      reviewMarkTypes,
      styleMaps,
      trailingText: computedPageNumber && index === elements.length - 1 ? computedPageNumber : void 0
    },
    `${variant}-${asString(asRecord(element)?.id)}-${index}`
  )) });
}
function WordElement({
  charts,
  element,
  numberingMarkers,
  pageLayout,
  referenceMarkers,
  reviewMarkTypes,
  styleMaps,
  trailingText
}) {
  const table = asRecord(element.table);
  if (table) {
    return /* @__PURE__ */ jsx7(
      WordTable,
      {
        element,
        numberingMarkers,
        pageLayout,
        referenceMarkers,
        reviewMarkTypes,
        table,
        styleMaps
      }
    );
  }
  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? styleMaps.images.get(imageId) : void 0;
  if (imageSrc) {
    return /* @__PURE__ */ jsx7(
      "span",
      {
        "aria-label": asString(element.name),
        role: "img",
        style: wordImageStyle(element, imageSrc, pageLayout)
      }
    );
  }
  const chart = presentationChartById(charts, presentationChartReferenceId(element.chartReference));
  if (chart) return /* @__PURE__ */ jsx7(WordChart, { chart, element, pageLayout });
  if (wordIsPositionedShapeElement(element)) {
    return /* @__PURE__ */ jsx7("span", { "aria-hidden": "true", "data-testid": "word-positioned-shape", style: wordPositionedShapeStyle(element, pageLayout) });
  }
  const paragraphs = asArray(element.paragraphs).map(
    (paragraph) => wordParagraphView(paragraph, styleMaps, numberingMarkers, referenceMarkers, reviewMarkTypes)
  );
  if (paragraphs.length === 0) return null;
  const paragraphElements = /* @__PURE__ */ jsx7(Fragment3, { children: paragraphs.map((paragraph, index) => /* @__PURE__ */ jsx7(
    WordParagraph,
    {
      paragraph,
      trailingText: trailingText && index === paragraphs.length - 1 ? trailingText : void 0
    },
    paragraph.id || index
  )) });
  if (wordIsPositionedTextBoxElement(element)) {
    return /* @__PURE__ */ jsx7(WordPositionedTextBox, { element, pageLayout, children: paragraphElements });
  }
  return paragraphElements;
}
function WordChart({ chart, element, pageLayout }) {
  const canvasRef = useRef(null);
  const contentWidth = wordPageContentWidthPx(pageLayout, 560);
  const box = wordElementBox(element, Math.min(560, contentWidth), 300, contentWidth);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(box.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(box.height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, box.width, box.height);
    drawPresentationChart(
      context,
      chart,
      { height: box.height, left: 0, top: 0, width: box.width },
      Math.max(0.7, Math.min(1.2, box.width / 560))
    );
  }, [box.height, box.width, chart]);
  return /* @__PURE__ */ jsx7(
    "canvas",
    {
      "aria-label": asString(chart.title) || "Chart",
      ref: canvasRef,
      role: "img",
      style: wordChartStyle(element, pageLayout)
    }
  );
}
var wordDocumentStackStyle = { display: "grid", gap: 20 };
var wordHeaderContentStyle = {
  borderBottom: "1px solid #e2e8f0",
  boxSizing: "border-box",
  color: "#475569",
  fontSize: 12,
  gridRow: 1,
  marginBottom: 12,
  maxWidth: "100%",
  minWidth: 0,
  paddingBottom: 8,
  width: "100%"
};
var wordFooterContentStyle = {
  borderTop: "1px solid #e2e8f0",
  boxSizing: "border-box",
  color: "#475569",
  fontSize: 12,
  gridRow: 4,
  marginTop: 12,
  maxWidth: "100%",
  minWidth: 0,
  paddingTop: 8,
  width: "100%"
};
var documentFallbackBlockStyle = {
  borderBottom: "1px solid #e2e8f0",
  color: "#0f172a",
  lineHeight: 1.6,
  margin: 0,
  paddingBottom: 10,
  whiteSpace: "pre-wrap"
};

// src/spreadsheet/spreadsheet-preview.tsx
import {
  useEffect as useEffect5,
  useMemo as useMemo4,
  useRef as useRef5,
  useState
} from "react";

// src/spreadsheet/spreadsheet-conditional-formula.ts
var CELL_REFERENCE_PATTERN = /^(?:'[^']+'|[A-Za-z0-9_ ]+!)?(\$?)([A-Z]{1,3})(\$?)(\d+)$/i;
function conditionalFormulaMatches(context) {
  const formula = asArray(context.formulas).map(asString).find(Boolean);
  if (!formula) return false;
  return valueToBoolean(evaluateFormulaExpression(stripFormulaPrefix(formula), context));
}
function conditionalFormulaValue(formula, context) {
  const expression = asString(formula);
  if (!expression) return "";
  return evaluateFormulaValue(stripFormulaPrefix(expression), context);
}
function evaluateFormulaExpression(expression, context) {
  const trimmed = stripOuterParens(expression.trim());
  if (!trimmed) return "";
  const comparison = splitTopLevelComparison(trimmed);
  if (comparison) {
    const left = evaluateFormulaValue(comparison.left, context);
    const right = evaluateFormulaValue(comparison.right, context);
    return compareFormulaValues(left, right, comparison.operator);
  }
  return evaluateFormulaValue(trimmed, context);
}
function evaluateFormulaValue(expression, context) {
  const trimmed = stripOuterParens(expression.trim());
  if (!trimmed) return "";
  const stringLiteral = trimmed.match(/^"((?:[^"]|"")*)"$/);
  if (stringLiteral) return stringLiteral[1].replaceAll('""', '"');
  if (/^(TRUE|FALSE)$/i.test(trimmed)) return /^TRUE$/i.test(trimmed);
  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) return numericValue;
  const cellReference = parseCellReference(trimmed);
  if (cellReference) return cellValueAtReference(cellReference, context);
  const structuredReference = parseStructuredReference(trimmed);
  if (structuredReference) return structuredReferenceValue(structuredReference, context);
  const definedName = definedNameValue(trimmed, context);
  if (definedName != null) return definedName;
  const call = parseFunctionCall(trimmed);
  if (call) return evaluateFormulaFunction(call.name, call.args, context);
  const arithmetic = splitTopLevelArithmetic(trimmed);
  if (arithmetic) {
    return evaluateArithmeticExpression(arithmetic, context);
  }
  if (trimmed.startsWith("-")) {
    const value = Number(evaluateFormulaValue(trimmed.slice(1), context));
    return Number.isFinite(value) ? -value : Number.NaN;
  }
  return trimmed;
}
function evaluateFormulaFunction(name, args, context) {
  const normalizedName = name.toUpperCase();
  if (normalizedName === "AND") {
    return args.every((arg) => valueToBoolean(evaluateFormulaExpression(arg, context)));
  }
  if (normalizedName === "OR") {
    return args.some((arg) => valueToBoolean(evaluateFormulaExpression(arg, context)));
  }
  if (normalizedName === "NOT") {
    return !valueToBoolean(evaluateFormulaExpression(args[0] ?? "", context));
  }
  if (normalizedName === "LT" || normalizedName === "LTE" || normalizedName === "GT" || normalizedName === "GTE") {
    const operator = normalizedName === "LT" ? "<" : normalizedName === "LTE" ? "<=" : normalizedName === "GT" ? ">" : ">=";
    return compareFormulaValues(evaluateFormulaValue(args[0] ?? "", context), evaluateFormulaValue(args[1] ?? "", context), operator);
  }
  if (normalizedName === "ISBLANK") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().length === 0;
  }
  if (normalizedName === "ISNUMBER") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return Number.isFinite(Number(value)) && asString(value).trim().length > 0;
  }
  if (normalizedName === "ISTEXT") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return asString(value).trim().length > 0 && !Number.isFinite(Number(value));
  }
  if (normalizedName === "ISERROR") {
    return spreadsheetFormulaErrorMatches(asString(evaluateFormulaValue(args[0] ?? "", context)));
  }
  if (normalizedName === "ISNA") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().toUpperCase() === "#N/A";
  }
  if (normalizedName === "ISODD") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) && Math.abs(Math.floor(value)) % 2 === 1;
  }
  if (normalizedName === "ISEVEN") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) && Math.abs(Math.floor(value)) % 2 === 0;
  }
  if (normalizedName === "IF") {
    return valueToBoolean(evaluateFormulaExpression(args[0] ?? "", context)) ? evaluateFormulaExpression(args[1] ?? "", context) : evaluateFormulaExpression(args[2] ?? "FALSE", context);
  }
  if (normalizedName === "IFERROR") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return spreadsheetFormulaErrorMatches(asString(value)) ? evaluateFormulaValue(args[1] ?? "", context) : value;
  }
  if (normalizedName === "IFNA") {
    const value = evaluateFormulaValue(args[0] ?? "", context);
    return asString(value).trim().toUpperCase() === "#N/A" ? evaluateFormulaValue(args[1] ?? "", context) : value;
  }
  if (normalizedName === "IFS") {
    return ifsFormulaValue(args, context);
  }
  if (normalizedName === "SWITCH") {
    return switchFormulaValue(args, context);
  }
  if (normalizedName === "CHOOSE") {
    return chooseFormulaValue(args, context);
  }
  if (normalizedName === "LEN") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).length;
  }
  if (normalizedName === "CHAR") {
    const code = Math.trunc(Number(evaluateFormulaValue(args[0] ?? "", context)));
    return Number.isFinite(code) && code >= 1 && code <= 255 ? String.fromCharCode(code) : "#VALUE!";
  }
  if (normalizedName === "TEXTBEFORE" || normalizedName === "TEXTAFTER") {
    return textBeforeAfterFormulaValue(args, context, normalizedName);
  }
  if (normalizedName === "EXACT") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)) === asString(evaluateFormulaValue(args[1] ?? "", context));
  }
  if (normalizedName === "VALUE") {
    return valueFormulaNumber(asString(evaluateFormulaValue(args[0] ?? "", context)));
  }
  if (normalizedName === "LOWER") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).toLowerCase();
  }
  if (normalizedName === "UPPER") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).toUpperCase();
  }
  if (normalizedName === "TRIM") {
    return asString(evaluateFormulaValue(args[0] ?? "", context)).trim().replace(/\s+/g, " ");
  }
  if (normalizedName === "LEFT") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    return value.slice(0, Number.isFinite(count) ? count : 1);
  }
  if (normalizedName === "RIGHT") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    return value.slice(value.length - (Number.isFinite(count) ? count : 1));
  }
  if (normalizedName === "MID") {
    const value = asString(evaluateFormulaValue(args[0] ?? "", context));
    const start = Math.max(1, Math.floor(Number(evaluateFormulaValue(args[1] ?? "1", context))));
    const count = Math.max(0, Math.floor(Number(evaluateFormulaValue(args[2] ?? "0", context))));
    return value.slice(start - 1, start - 1 + (Number.isFinite(count) ? count : 0));
  }
  if (normalizedName === "SUBSTITUTE") {
    return substituteFormulaText(args, context);
  }
  if (normalizedName === "REPLACE") {
    return replaceFormulaText(args, context);
  }
  if (normalizedName === "CONCAT" || normalizedName === "CONCATENATE") {
    return formulaRawArgs(args, context).map(asString).join("");
  }
  if (normalizedName === "TEXTJOIN") {
    return textJoinFormulaText(args, context);
  }
  if (normalizedName === "TEXT") {
    return textFormulaValue(args, context);
  }
  if (normalizedName === "SEARCH" || normalizedName === "FIND") {
    const needle = asString(evaluateFormulaValue(args[0] ?? "", context));
    const haystack = asString(evaluateFormulaValue(args[1] ?? "", context));
    const start = Math.max(1, Math.floor(Number(evaluateFormulaValue(args[2] ?? "1", context))));
    const index = normalizedName === "SEARCH" ? haystack.toLowerCase().indexOf(needle.toLowerCase(), start - 1) : haystack.indexOf(needle, start - 1);
    return index >= 0 ? index + 1 : "#VALUE!";
  }
  if (normalizedName === "ABS") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) ? Math.abs(value) : Number.NaN;
  }
  if (normalizedName === "ROUND" || normalizedName === "ROUNDUP" || normalizedName === "ROUNDDOWN") {
    return roundFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "0", context)),
      normalizedName
    );
  }
  if (normalizedName === "INT") {
    const value = Number(evaluateFormulaValue(args[0] ?? "", context));
    return Number.isFinite(value) ? Math.floor(value) : Number.NaN;
  }
  if (normalizedName === "FLOOR" || normalizedName === "CEILING") {
    return multipleFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "1", context)),
      normalizedName
    );
  }
  if (normalizedName === "ROW") {
    return args.length > 0 ? resolvedCellReferenceValue(args[0], context, "row") : context.rowIndex;
  }
  if (normalizedName === "COLUMN") {
    return args.length > 0 ? resolvedCellReferenceValue(args[0], context, "column") + 1 : context.columnIndex + 1;
  }
  if (normalizedName === "MOD") {
    const dividend = Number(evaluateFormulaValue(args[0] ?? "", context));
    const divisor = Number(evaluateFormulaValue(args[1] ?? "", context));
    return Number.isFinite(dividend) && Number.isFinite(divisor) && divisor !== 0 ? dividend % divisor : Number.NaN;
  }
  if (normalizedName === "SUM") {
    return formulaNumericArgs(args, context).reduce((sum, value) => sum + value, 0);
  }
  if (normalizedName === "SUBTOTAL") {
    return subtotalFormulaValue(args, context);
  }
  if (normalizedName === "AVERAGE") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
  }
  if (normalizedName === "MIN") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? Math.min(...values) : Number.NaN;
  }
  if (normalizedName === "MAX") {
    const values = formulaNumericArgs(args, context);
    return values.length > 0 ? Math.max(...values) : Number.NaN;
  }
  if (normalizedName === "COUNT") {
    return formulaNumericArgs(args, context).length;
  }
  if (normalizedName === "COUNTA") {
    return formulaRawArgs(args, context).filter((value) => asString(value).trim().length > 0).length;
  }
  if (normalizedName === "COUNTBLANK") {
    return countBlankFormulaValues(args, context);
  }
  if (normalizedName === "MEDIAN") {
    return medianFormulaNumber(formulaNumericArgs(args, context));
  }
  if (normalizedName === "LARGE" || normalizedName === "SMALL") {
    return rankedFormulaNumber(
      formulaNumericArgs([args[0] ?? ""], context),
      Number(evaluateFormulaValue(args[1] ?? "1", context)),
      normalizedName
    );
  }
  if (normalizedName === "RANK" || normalizedName === "RANK.EQ") {
    return rankFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      formulaNumericArgs([args[1] ?? ""], context),
      Number(evaluateFormulaValue(args[2] ?? "0", context))
    );
  }
  if (normalizedName === "PERCENTILE" || normalizedName === "PERCENTILE.INC") {
    return percentileFormulaNumber(
      formulaNumericArgs([args[0] ?? ""], context),
      Number(evaluateFormulaValue(args[1] ?? "", context))
    );
  }
  if (normalizedName === "COUNTIF") {
    return countIf(args, context);
  }
  if (normalizedName === "COUNTIFS") {
    return countIfs(args, context);
  }
  if (normalizedName === "SUMIF") {
    return aggregateIf(args, context, "sum");
  }
  if (normalizedName === "SUMIFS") {
    return aggregateIfs(args, context, "sum");
  }
  if (normalizedName === "AVERAGEIF") {
    return aggregateIf(args, context, "average");
  }
  if (normalizedName === "AVERAGEIFS") {
    return aggregateIfs(args, context, "average");
  }
  if (normalizedName === "MINIFS") {
    return aggregateIfs(args, context, "min");
  }
  if (normalizedName === "MAXIFS") {
    return aggregateIfs(args, context, "max");
  }
  if (normalizedName === "INDEX") {
    return indexFormulaValue(args, context);
  }
  if (normalizedName === "MATCH") {
    return matchFormulaValue(args, context);
  }
  if (normalizedName === "VLOOKUP") {
    return vlookupFormulaValue(args, context);
  }
  if (normalizedName === "XLOOKUP") {
    return xlookupFormulaValue(args, context);
  }
  if (normalizedName === "TODAY") {
    return currentExcelSerialDay();
  }
  if (normalizedName === "NOW") {
    return currentExcelSerialNow();
  }
  if (normalizedName === "DATEVALUE") {
    return dateValueFormulaNumber(asString(evaluateFormulaValue(args[0] ?? "", context)));
  }
  if (normalizedName === "TIME") {
    return timeFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "0", context)),
      Number(evaluateFormulaValue(args[1] ?? "0", context)),
      Number(evaluateFormulaValue(args[2] ?? "0", context))
    );
  }
  if (normalizedName === "TIMEVALUE") {
    return timeValueFormulaNumber(asString(evaluateFormulaValue(args[0] ?? "", context)));
  }
  if (normalizedName === "DATE") {
    const year = Number(evaluateFormulaValue(args[0] ?? "", context));
    const month = Number(evaluateFormulaValue(args[1] ?? "", context));
    const day = Number(evaluateFormulaValue(args[2] ?? "", context));
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return excelSerialDay(year, month, day);
    }
    return Number.NaN;
  }
  if (normalizedName === "EDATE") {
    return addExcelSerialMonths(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "0", context))
    );
  }
  if (normalizedName === "EOMONTH") {
    return endOfExcelSerialMonth(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "0", context))
    );
  }
  if (normalizedName === "NETWORKDAYS") {
    return networkDaysFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "", context)),
      formulaNumericArgs([args[2] ?? ""], context)
    );
  }
  if (normalizedName === "WORKDAY") {
    return workdayFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "", context)),
      formulaNumericArgs([args[2] ?? ""], context)
    );
  }
  if (normalizedName === "DATEDIF") {
    return datedifFormulaNumber(
      Number(evaluateFormulaValue(args[0] ?? "", context)),
      Number(evaluateFormulaValue(args[1] ?? "", context)),
      asString(evaluateFormulaValue(args[2] ?? '"D"', context))
    );
  }
  if (normalizedName === "YEAR" || normalizedName === "MONTH" || normalizedName === "DAY" || normalizedName === "WEEKDAY") {
    return excelSerialDatePart(Number(evaluateFormulaValue(args[0] ?? "", context)), normalizedName, Number(evaluateFormulaValue(args[1] ?? "1", context)));
  }
  return "";
}
function compareFormulaValues(left, right, operator) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const leftValue = numeric ? leftNumber : asString(left);
  const rightValue = numeric ? rightNumber : asString(right);
  if (operator === "=") return leftValue === rightValue;
  if (operator === "<>") return leftValue !== rightValue;
  if (operator === ">") return leftValue > rightValue;
  if (operator === ">=") return leftValue >= rightValue;
  if (operator === "<") return leftValue < rightValue;
  if (operator === "<=") return leftValue <= rightValue;
  return false;
}
function ifsFormulaValue(args, context) {
  for (let index = 0; index < args.length - 1; index += 2) {
    if (valueToBoolean(evaluateFormulaExpression(args[index] ?? "", context))) {
      return evaluateFormulaExpression(args[index + 1] ?? "", context);
    }
  }
  return "";
}
function switchFormulaValue(args, context) {
  const target = evaluateFormulaValue(args[0] ?? "", context);
  const hasDefault = args.length > 2 && (args.length - 1) % 2 === 1;
  const pairEnd = hasDefault ? args.length - 1 : args.length;
  for (let index = 1; index < pairEnd - 1; index += 2) {
    if (formulaLookupValuesEqual(evaluateFormulaValue(args[index] ?? "", context), target)) {
      return evaluateFormulaExpression(args[index + 1] ?? "", context);
    }
  }
  return hasDefault ? evaluateFormulaExpression(args[args.length - 1] ?? "", context) : "";
}
function chooseFormulaValue(args, context) {
  const index = Math.trunc(Number(evaluateFormulaValue(args[0] ?? "", context)));
  if (!Number.isFinite(index) || index < 1 || index >= args.length) return "";
  return evaluateFormulaExpression(args[index] ?? "", context);
}
function textBeforeAfterFormulaValue(args, context, mode) {
  const text = asString(evaluateFormulaValue(args[0] ?? "", context));
  const delimiter = asString(evaluateFormulaValue(args[1] ?? "", context));
  const instance = Math.trunc(Number(evaluateFormulaValue(args[2] ?? "1", context)));
  const ifNotFound = args[5] != null ? asString(evaluateFormulaValue(args[5], context)) : "#N/A";
  if (!delimiter || !Number.isFinite(instance) || instance === 0) return "#VALUE!";
  const indexes = [];
  let searchFrom = 0;
  while (searchFrom <= text.length) {
    const index = text.indexOf(delimiter, searchFrom);
    if (index < 0) break;
    indexes.push(index);
    searchFrom = index + delimiter.length;
  }
  const delimiterIndex = instance > 0 ? indexes[instance - 1] : indexes[indexes.length + instance];
  if (delimiterIndex == null) return ifNotFound;
  return mode === "TEXTBEFORE" ? text.slice(0, delimiterIndex) : text.slice(delimiterIndex + delimiter.length);
}
function valueFormulaNumber(value) {
  const trimmed = value.trim();
  const percent = trimmed.endsWith("%");
  const parsed = Number(trimmed.replace(/%$/, "").replaceAll(",", ""));
  if (!Number.isFinite(parsed)) return Number.NaN;
  return percent ? parsed / 100 : parsed;
}
function substituteFormulaText(args, context) {
  const value = asString(evaluateFormulaValue(args[0] ?? "", context));
  const target = asString(evaluateFormulaValue(args[1] ?? "", context));
  const replacement = asString(evaluateFormulaValue(args[2] ?? "", context));
  if (!target) return value;
  const instanceValue = args.length > 3 ? evaluateFormulaValue(args[3] ?? "", context) : "";
  const instance = Number(instanceValue);
  if (asString(instanceValue).trim().length === 0 || !Number.isFinite(instance)) return value.split(target).join(replacement);
  let seen = 0;
  return value.replaceAll(target, (match) => {
    seen += 1;
    return seen === Math.trunc(instance) ? replacement : match;
  });
}
function replaceFormulaText(args, context) {
  const value = asString(evaluateFormulaValue(args[0] ?? "", context));
  const start = Math.max(1, Math.trunc(Number(evaluateFormulaValue(args[1] ?? "1", context))));
  const count = Math.max(0, Math.trunc(Number(evaluateFormulaValue(args[2] ?? "0", context))));
  const replacement = asString(evaluateFormulaValue(args[3] ?? "", context));
  return `${value.slice(0, start - 1)}${replacement}${value.slice(start - 1 + count)}`;
}
function textJoinFormulaText(args, context) {
  const delimiter = asString(evaluateFormulaValue(args[0] ?? "", context));
  const ignoreEmpty = valueToBoolean(evaluateFormulaValue(args[1] ?? "FALSE", context));
  const values = formulaRawArgs(args.slice(2), context).map(asString);
  return (ignoreEmpty ? values.filter((value) => value.length > 0) : values).join(delimiter);
}
function textFormulaValue(args, context) {
  const value = Number(evaluateFormulaValue(args[0] ?? "", context));
  const format = asString(evaluateFormulaValue(args[1] ?? '"General"', context));
  if (!Number.isFinite(value)) return "";
  const normalizedFormat = format.toLowerCase();
  if (/[yd]/.test(normalizedFormat)) return formatExcelSerialDate(value, format);
  if (/[hs]/.test(normalizedFormat)) return formatExcelSerialTime(value, format);
  if (format.includes("%")) return `${formatNumberWithDecimals(value * 100, format)}%`;
  return formatNumberWithDecimals(value, format);
}
function evaluateArithmeticExpression(expression, context) {
  const left = Number(evaluateFormulaValue(expression.left, context));
  const right = Number(evaluateFormulaValue(expression.right, context));
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
  if (expression.operator === "+") return left + right;
  if (expression.operator === "-") return left - right;
  if (expression.operator === "*") return left * right;
  if (expression.operator === "/") return right !== 0 ? left / right : Number.NaN;
  if (expression.operator === "^") return left ** right;
  return Number.NaN;
}
function roundFormulaNumber(value, digits, mode) {
  if (!Number.isFinite(value) || !Number.isFinite(digits)) return Number.NaN;
  const multiplier = 10 ** Math.trunc(digits);
  if (!Number.isFinite(multiplier) || multiplier === 0) return Number.NaN;
  const scaled = value * multiplier;
  if (mode === "ROUNDUP") return Math.sign(scaled) * Math.ceil(Math.abs(scaled)) / multiplier;
  if (mode === "ROUNDDOWN") return Math.sign(scaled) * Math.floor(Math.abs(scaled)) / multiplier;
  return Math.round(scaled) / multiplier;
}
function multipleFormulaNumber(value, significance, mode) {
  if (!Number.isFinite(value) || !Number.isFinite(significance) || significance === 0) return Number.NaN;
  const divisor = Math.abs(significance);
  return mode === "CEILING" ? Math.ceil(value / divisor) * divisor : Math.floor(value / divisor) * divisor;
}
function cellValueAtReference(reference, context) {
  const rowIndex = reference.rowAbsolute ? reference.rowIndex : context.rowIndex + reference.rowIndex - context.range.startRow;
  const columnIndex = reference.columnAbsolute ? reference.columnIndex : context.columnIndex + reference.columnIndex - context.range.startColumn;
  const cell = rowsBySheetName(context, reference.sheetName).get(rowIndex)?.get(columnIndex) ?? null;
  return cellText(cell);
}
function formulaNumericArgs(args, context) {
  const values = [];
  for (const arg of args) {
    const rangeValues = formulaArgumentCanExpandRange(arg, context) ? formulaRangeValues(arg, context) : null;
    if (rangeValues) {
      values.push(...rangeValues.map(Number).filter(Number.isFinite));
      continue;
    }
    const value = Number(evaluateFormulaValue(arg, context));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}
function formulaRawArgs(args, context) {
  const values = [];
  for (const arg of args) {
    const rangeValues = formulaArgumentCanExpandRange(arg, context) ? formulaRangeValues(arg, context) : null;
    if (rangeValues) {
      values.push(...rangeValues);
      continue;
    }
    values.push(evaluateFormulaValue(arg, context));
  }
  return values;
}
function subtotalFormulaValue(args, context) {
  const functionNumber = Math.trunc(Number(evaluateFormulaValue(args[0] ?? "", context)));
  const values = formulaNumericArgs(args.slice(1), context);
  if (functionNumber === 1 || functionNumber === 101) {
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
  }
  if (functionNumber === 2 || functionNumber === 102) return values.length;
  if (functionNumber === 4 || functionNumber === 104) return values.length > 0 ? Math.max(...values) : Number.NaN;
  if (functionNumber === 5 || functionNumber === 105) return values.length > 0 ? Math.min(...values) : Number.NaN;
  if (functionNumber === 9 || functionNumber === 109) return values.reduce((sum, value) => sum + value, 0);
  if (functionNumber === 3 || functionNumber === 103) {
    return formulaRawArgs(args.slice(1), context).filter((value) => asString(value).trim().length > 0).length;
  }
  return Number.NaN;
}
function formulaArgumentCanExpandRange(expression, context) {
  return formulaRangeTarget(expression, context).includes(":");
}
function formulaRangeValues(expression, context) {
  const cells = formulaRangeCells(expression, context);
  return cells ? cells.map((cell) => cell.value) : null;
}
function formulaRangeCells(expression, context) {
  const target = formulaRangeTarget(expression, context);
  if (!/[A-Z]+\$?\d/i.test(target) && !target.includes(":")) return null;
  const { reference, sheetName } = splitFormulaSheetReference(target);
  const range = parseCellRange(reference);
  if (!range) return null;
  const cells = [];
  for (const [rowIndex, row] of rowsBySheetName(context, sheetName)) {
    if (rowIndex < range.startRow || rowIndex >= range.startRow + range.rowSpan) continue;
    for (const [columnIndex, cell] of row) {
      if (columnIndex < range.startColumn || columnIndex >= range.startColumn + range.columnSpan) continue;
      cells.push({ columnIndex, rowIndex, value: cellText(cell) });
    }
  }
  return cells;
}
function formulaRangeTarget(expression, context) {
  const target = definedNameTarget(stripFormulaPrefix(expression), context) ?? stripFormulaPrefix(expression);
  return offsetFormulaRangeTarget(target, context) ?? target;
}
function countIf(args, context) {
  const cells = formulaRangeCells(args[0] ?? "", context);
  if (!cells) return 0;
  const criterion = formulaCriteria(args[1] ?? "", context);
  return cells.filter((cell) => formulaCriteriaMatches(cell.value, criterion)).length;
}
function countIfs(args, context) {
  if (args.length < 2 || args.length % 2 !== 0) return 0;
  const firstRange = formulaRange(args[0] ?? "", context);
  const firstCells = firstRange ? formulaRangeCells(args[0] ?? "", context) : null;
  if (!firstRange || !firstCells) return 0;
  const criteria = [];
  for (let index = 0; index < args.length; index += 2) {
    const criteriaRange = formulaCriteriaRange(args[index] ?? "", args[index + 1] ?? "", context);
    if (!criteriaRange) return 0;
    criteria.push(criteriaRange);
  }
  return firstCells.filter((cell) => {
    const rowOffset = cell.rowIndex - firstRange.startRow;
    const columnOffset = cell.columnIndex - firstRange.startColumn;
    return criteria.every((item) => formulaCriteriaRangeMatches(item, rowOffset, columnOffset));
  }).length;
}
function countBlankFormulaValues(args, context) {
  let count = 0;
  for (const arg of args) {
    const range = formulaRange(arg, context);
    const cells = formulaRangeCells(arg, context);
    if (range && cells) {
      const area = range.rowSpan * range.columnSpan;
      const explicitBlankCount = cells.filter((cell) => cell.value.trim().length === 0).length;
      count += area <= 1e5 ? area - cells.filter((cell) => cell.value.trim().length > 0).length : explicitBlankCount;
      continue;
    }
    if (asString(evaluateFormulaValue(arg, context)).trim().length === 0) count += 1;
  }
  return count;
}
function medianFormulaNumber(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function rankedFormulaNumber(values, rank, mode) {
  const position = Math.trunc(rank) - 1;
  if (values.length === 0 || !Number.isFinite(position) || position < 0 || position >= values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => mode === "SMALL" ? left - right : right - left);
  return sorted[position];
}
function rankFormulaNumber(value, values, order) {
  if (!Number.isFinite(value) || values.length === 0) return Number.NaN;
  const ascending = Number.isFinite(order) && order !== 0;
  return 1 + values.filter((candidate) => ascending ? candidate < value : candidate > value).length;
}
function percentileFormulaNumber(values, percentile) {
  if (values.length === 0 || !Number.isFinite(percentile) || percentile < 0 || percentile > 1) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function aggregateIf(args, context, kind) {
  const criteriaRange = formulaCriteriaRange(args[0] ?? "", args[1] ?? "", context);
  if (!criteriaRange) return kind === "sum" ? 0 : Number.NaN;
  const sumRange = formulaRange(args[2] ?? "", context) ?? criteriaRange.range;
  const sumCells = formulaRangeCells(args[2] ?? args[0] ?? "", context);
  if (!sumCells) return kind === "sum" ? 0 : Number.NaN;
  const sumByOffset = cellsByOffset(sumCells, sumRange);
  const values = numericValuesMatchingCriteria(criteriaRange, sumByOffset);
  return aggregateNumericValues(values, kind);
}
function aggregateIfs(args, context, kind) {
  if (args.length < 3 || args.length % 2 !== 1) return aggregateEmptyResult(kind);
  const sumRange = formulaRange(args[0] ?? "", context);
  const sumCells = formulaRangeCells(args[0] ?? "", context);
  if (!sumRange || !sumCells) return aggregateEmptyResult(kind);
  const sumByOffset = cellsByOffset(sumCells, sumRange);
  const criteria = [];
  for (let index = 1; index < args.length; index += 2) {
    const criteriaRange = formulaCriteriaRange(args[index] ?? "", args[index + 1] ?? "", context);
    if (!criteriaRange) return aggregateEmptyResult(kind);
    criteria.push(criteriaRange);
  }
  const values = [];
  for (const [key, rawValue] of sumByOffset) {
    const [rowOffsetText, columnOffsetText] = key.split(":");
    const rowOffset = Number(rowOffsetText);
    const columnOffset = Number(columnOffsetText);
    if (!Number.isFinite(rowOffset) || !Number.isFinite(columnOffset)) continue;
    if (!criteria.every((item) => formulaCriteriaRangeMatches(item, rowOffset, columnOffset))) continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) values.push(value);
  }
  return aggregateNumericValues(values, kind);
}
function numericValuesMatchingCriteria(criteriaRange, valuesByOffset) {
  const values = [];
  for (const [key, candidate] of criteriaRange.cellsByOffset) {
    if (!formulaCriteriaMatches(candidate, criteriaRange.criterion)) continue;
    const value = Number(valuesByOffset.get(key) ?? "");
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}
function aggregateNumericValues(values, kind) {
  if (kind === "max") return values.length > 0 ? Math.max(...values) : Number.NaN;
  if (kind === "min") return values.length > 0 ? Math.min(...values) : Number.NaN;
  if (kind === "average") return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
  return values.reduce((sum, value) => sum + value, 0);
}
function aggregateEmptyResult(kind) {
  return kind === "sum" ? 0 : Number.NaN;
}
function formulaCriteriaRange(rangeExpression, criterionExpression, context) {
  const range = formulaRange(rangeExpression, context);
  const cells = formulaRangeCells(rangeExpression, context);
  if (!range || !cells) return null;
  return {
    cellsByOffset: cellsByOffset(cells, range),
    criterion: formulaCriteria(criterionExpression, context),
    range
  };
}
function formulaCriteriaRangeMatches(criteriaRange, rowOffset, columnOffset) {
  const value = criteriaRange.cellsByOffset.get(`${rowOffset}:${columnOffset}`) ?? "";
  return formulaCriteriaMatches(value, criteriaRange.criterion);
}
function formulaRange(expression, context) {
  return parseCellRange(formulaRangeTarget(expression, context));
}
function offsetFormulaRangeTarget(expression, context) {
  const call = parseFunctionCall(stripFormulaPrefix(expression));
  if (!call || call.name.toUpperCase() !== "OFFSET") return null;
  const rawBaseTarget = definedNameTarget(stripFormulaPrefix(call.args[0] ?? ""), context) ?? stripFormulaPrefix(call.args[0] ?? "");
  const baseTarget = offsetFormulaRangeTarget(rawBaseTarget, context) ?? rawBaseTarget;
  const { reference, sheetName } = splitFormulaSheetReference(baseTarget);
  const baseRange = parseCellRange(reference);
  if (!baseRange) return null;
  const rowOffset = Math.trunc(Number(evaluateFormulaValue(call.args[1] ?? "0", context)));
  const columnOffset = Math.trunc(Number(evaluateFormulaValue(call.args[2] ?? "0", context)));
  const rowSpan = Math.max(1, Math.trunc(Number(evaluateFormulaValue(call.args[3] ?? String(baseRange.rowSpan), context))));
  const columnSpan = Math.max(1, Math.trunc(Number(evaluateFormulaValue(call.args[4] ?? String(baseRange.columnSpan), context))));
  if (![rowOffset, columnOffset, rowSpan, columnSpan].every(Number.isFinite)) return null;
  const startColumn = Math.max(0, baseRange.startColumn + columnOffset);
  const startRow = Math.max(1, baseRange.startRow + rowOffset);
  const endColumn = startColumn + columnSpan - 1;
  const endRow = startRow + rowSpan - 1;
  const referenceText = `${columnLabel(startColumn)}${startRow}:${columnLabel(endColumn)}${endRow}`;
  return sheetName ? `${sheetName}!${referenceText}` : referenceText;
}
function indexFormulaValue(args, context) {
  const range = formulaRange(args[0] ?? "", context);
  const cells = formulaRangeCells(args[0] ?? "", context);
  if (!range || !cells) return "";
  const rowOffset = Math.max(0, Math.trunc(Number(evaluateFormulaValue(args[1] ?? "1", context))) - 1);
  const columnOffset = Math.max(0, Math.trunc(Number(evaluateFormulaValue(args[2] ?? "1", context))) - 1);
  return cellsByOffset(cells, range).get(`${rowOffset}:${columnOffset}`) ?? "";
}
function matchFormulaValue(args, context) {
  const cells = formulaRangeCells(args[1] ?? "", context);
  if (!cells) return Number.NaN;
  const lookupValue = evaluateFormulaValue(args[0] ?? "", context);
  const matchType = Number(evaluateFormulaValue(args[2] ?? "1", context));
  return matchLookupPosition(lookupValue, cells.map((cell) => cell.value), Number.isFinite(matchType) ? Math.trunc(matchType) : 1);
}
function vlookupFormulaValue(args, context) {
  const range = formulaRange(args[1] ?? "", context);
  const cells = formulaRangeCells(args[1] ?? "", context);
  if (!range || !cells) return "";
  const columnOffset = Math.trunc(Number(evaluateFormulaValue(args[2] ?? "1", context))) - 1;
  if (!Number.isFinite(columnOffset) || columnOffset < 0 || columnOffset >= range.columnSpan) return "";
  const lookupValue = evaluateFormulaValue(args[0] ?? "", context);
  const exact = !valueToBoolean(evaluateFormulaValue(args[3] ?? "TRUE", context));
  const byOffset = cellsByOffset(cells, range);
  const firstColumn = cells.filter((cell) => cell.columnIndex === range.startColumn).sort((left, right) => left.rowIndex - right.rowIndex);
  const rowPosition = exact ? firstColumn.findIndex((cell) => formulaLookupValuesEqual(cell.value, lookupValue)) : matchLookupPosition(lookupValue, firstColumn.map((cell) => cell.value), 1) - 1;
  return rowPosition >= 0 ? byOffset.get(`${rowPosition}:${columnOffset}`) ?? "" : "";
}
function xlookupFormulaValue(args, context) {
  const lookupCells = formulaRangeCells(args[1] ?? "", context);
  const returnRange = formulaRange(args[2] ?? "", context);
  const returnCells = formulaRangeCells(args[2] ?? "", context);
  if (!lookupCells || !returnRange || !returnCells) return asString(evaluateFormulaValue(args[3] ?? "", context));
  const lookupValue = evaluateFormulaValue(args[0] ?? "", context);
  const matchIndex = lookupCells.findIndex((cell) => formulaLookupValuesEqual(cell.value, lookupValue));
  if (matchIndex < 0) return asString(evaluateFormulaValue(args[3] ?? "", context));
  return returnCells[matchIndex]?.value ?? cellsByOffset(returnCells, returnRange).get(`${matchIndex}:0`) ?? "";
}
function matchLookupPosition(lookupValue, values, matchType) {
  if (matchType === 0) {
    const index = values.findIndex((value) => formulaLookupValuesEqual(value, lookupValue));
    return index >= 0 ? index + 1 : Number.NaN;
  }
  let matchedIndex = -1;
  for (let index = 0; index < values.length; index += 1) {
    const comparison = formulaLookupCompare(values[index], lookupValue);
    if (matchType < 0 ? comparison >= 0 : comparison <= 0) matchedIndex = index;
  }
  return matchedIndex >= 0 ? matchedIndex + 1 : Number.NaN;
}
function formulaLookupValuesEqual(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return asString(left).trim().toLowerCase() === asString(right).trim().toLowerCase();
}
function formulaLookupCompare(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return asString(left).trim().toLowerCase().localeCompare(asString(right).trim().toLowerCase());
}
function cellsByOffset(cells, range) {
  const map = /* @__PURE__ */ new Map();
  for (const cell of cells) {
    map.set(`${cell.rowIndex - range.startRow}:${cell.columnIndex - range.startColumn}`, cell.value);
  }
  return map;
}
function formulaCriteria(expression, context) {
  const value = evaluateFormulaValue(expression, context);
  const text = asString(value);
  const match = text.match(/^(>=|<=|<>|=|>|<)(.*)$/);
  if (!match) return { operator: "=", value };
  return {
    operator: match[1],
    value: match[2]
  };
}
function formulaCriteriaMatches(value, criterion) {
  const rawExpected = asString(criterion.value);
  const actualNumber = Number(value);
  const expectedNumber = Number(rawExpected);
  const numeric = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber) && rawExpected.trim().length > 0;
  const actual = numeric ? actualNumber : value.toLowerCase();
  const expected = numeric ? expectedNumber : rawExpected.toLowerCase();
  if (!numeric && /[*?]/.test(rawExpected)) {
    const wildcard = new RegExp(`^${escapeRegExp(rawExpected).replaceAll("\\*", ".*").replaceAll("\\?", ".")}$`, "i");
    return criterion.operator === "<>" ? !wildcard.test(value) : wildcard.test(value);
  }
  if (criterion.operator === "=") return actual === expected;
  if (criterion.operator === "<>") return actual !== expected;
  if (criterion.operator === ">") return actual > expected;
  if (criterion.operator === ">=") return actual >= expected;
  if (criterion.operator === "<") return actual < expected;
  if (criterion.operator === "<=") return actual <= expected;
  return false;
}
function spreadsheetFormulaErrorMatches(value) {
  const normalized = value.trim().toUpperCase();
  return normalized === "#DIV/0!" || normalized === "#N/A" || normalized === "#NAME?" || normalized === "#NULL!" || normalized === "#NUM!" || normalized === "#REF!" || normalized === "#VALUE!" || normalized === "#SPILL!" || normalized === "#CALC!" || normalized === "#FIELD!" || normalized === "#GETTING_DATA";
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function resolvedCellReferenceValue(expression, context, axis) {
  const reference = parseCellReference(expression);
  if (!reference) return axis === "row" ? context.rowIndex : context.columnIndex;
  if (axis === "row") {
    return reference.rowAbsolute ? reference.rowIndex : context.rowIndex + reference.rowIndex - context.range.startRow;
  }
  return reference.columnAbsolute ? reference.columnIndex : context.columnIndex + reference.columnIndex - context.range.startColumn;
}
function parseCellReference(value) {
  const { reference, sheetName } = splitFormulaSheetReference(value);
  const match = reference.match(CELL_REFERENCE_PATTERN);
  if (!match) return null;
  return {
    columnAbsolute: match[1] === "$",
    columnIndex: columnIndexFromAddress(match[2]),
    rowAbsolute: match[3] === "$",
    rowIndex: Math.max(1, Number.parseInt(match[4] ?? "1", 10)),
    ...sheetName ? { sheetName } : {}
  };
}
function rowsBySheetName(context, sheetName) {
  const normalizedName = asString(sheetName || context.sheetName).toLowerCase();
  if (normalizedName && context.rowsBySheet) {
    for (const [candidateName, rows] of context.rowsBySheet) {
      if (candidateName.toLowerCase() === normalizedName) return rows;
    }
  }
  return context.rowsByIndex;
}
function splitFormulaSheetReference(value) {
  const trimmed = stripFormulaPrefix(value).trim();
  const separator = trimmed.lastIndexOf("!");
  if (separator < 0) return { reference: trimmed };
  return {
    reference: trimmed.slice(separator + 1).trim(),
    sheetName: trimmed.slice(0, separator).replace(/^'|'$/g, "").trim()
  };
}
function parseStructuredReference(value) {
  const currentRowMatch = value.match(/^(?:(.+))?\[@([^\]]+)\]$/);
  if (currentRowMatch) {
    return {
      columnName: cleanStructuredReferenceName(currentRowMatch[2]),
      tableName: cleanStructuredReferenceName(currentRowMatch[1])
    };
  }
  const thisRowMatch = value.match(/^(?:(.+))?\[\[#This Row\],\[([^\]]+)\]\]$/i);
  if (thisRowMatch) {
    return {
      columnName: cleanStructuredReferenceName(thisRowMatch[2]),
      tableName: cleanStructuredReferenceName(thisRowMatch[1])
    };
  }
  const columnMatch = value.match(/^(.+)\[([^\]#@][^\]]*)\]$/);
  if (!columnMatch) return null;
  return {
    columnName: cleanStructuredReferenceName(columnMatch[2]),
    tableName: cleanStructuredReferenceName(columnMatch[1])
  };
}
function structuredReferenceValue(reference, context) {
  const table = structuredReferenceTable(reference.tableName, context);
  if (!table || !reference.columnName) return "";
  const tableRange = parseCellRange(asString(table.reference) || asString(table.ref));
  if (!tableRange) return "";
  const headerRowCount = Math.max(0, asNumber(table.headerRowCount, 1));
  const totalsRowCount = Math.max(0, asNumber(table.totalsRowCount, table.totalsRowShown === true ? 1 : 0));
  const dataStartRow = tableRange.startRow + headerRowCount;
  const dataEndRow = tableRange.startRow + tableRange.rowSpan - totalsRowCount - 1;
  if (context.rowIndex < dataStartRow || context.rowIndex > dataEndRow) return "";
  const columnIndex = structuredReferenceColumnIndex(table, tableRange, reference.columnName, context);
  if (columnIndex == null) return "";
  return cellText(context.rowsByIndex.get(context.rowIndex)?.get(columnIndex) ?? null);
}
function structuredReferenceTable(tableName, context) {
  const normalizedName = tableName.toLowerCase();
  for (const candidate of asArray(context.tables).map(asRecord).filter((table) => table != null)) {
    const tableRange = parseCellRange(asString(candidate.reference) || asString(candidate.ref));
    if (!tableRange) continue;
    const candidateNames = [asString(candidate.name), asString(candidate.displayName)].map((name) => name.toLowerCase());
    const nameMatches = normalizedName.length > 0 && candidateNames.includes(normalizedName);
    const rowMatches = context.rowIndex >= tableRange.startRow && context.rowIndex < tableRange.startRow + tableRange.rowSpan;
    const columnMatches = context.columnIndex >= tableRange.startColumn && context.columnIndex < tableRange.startColumn + tableRange.columnSpan;
    if (nameMatches || !normalizedName && rowMatches && columnMatches) return candidate;
  }
  return null;
}
function structuredReferenceColumnIndex(table, tableRange, columnName, context) {
  const normalizedName = columnName.toLowerCase();
  const columnRecords = asArray(table.columns).map(asRecord).filter((column) => column != null);
  const recordIndex = columnRecords.findIndex((column) => asString(column.name).toLowerCase() === normalizedName);
  if (recordIndex >= 0) return tableRange.startColumn + recordIndex;
  const headerCells = context.rowsByIndex.get(tableRange.startRow);
  for (let offset = 0; offset < tableRange.columnSpan; offset += 1) {
    const columnIndex = tableRange.startColumn + offset;
    if (cellText(headerCells?.get(columnIndex) ?? null).toLowerCase() === normalizedName) return columnIndex;
  }
  return null;
}
function definedNameValue(name, context) {
  if (!/^[A-Z_][A-Z0-9_.]*$/i.test(name)) return null;
  const target = definedNameTarget(name, context);
  if (!target) return "";
  const range = /[A-Z]+\$?\d/i.test(target) ? parseCellRange(target) : null;
  if (range) {
    return cellText(context.rowsByIndex.get(range.startRow)?.get(range.startColumn) ?? null);
  }
  return target;
}
function definedNameTarget(name, context) {
  const normalizedName = name.toLowerCase();
  const records = definedNameRecords(context.definedNames);
  const record = records.find((item) => asString(item.name).toLowerCase() === normalizedName);
  if (!record) return null;
  const target = asString(record.text) || asString(record.formula) || asString(record.value) || asString(record.reference);
  return target ? stripFormulaPrefix(target) : "";
}
function definedNameRecords(definedNames) {
  const wrapper = asRecord(definedNames);
  return [
    ...asArray(definedNames),
    ...asArray(wrapper?.items),
    ...asArray(wrapper?.definedNames)
  ].map(asRecord).filter((item) => item != null);
}
function cleanStructuredReferenceName(value) {
  return asString(value).trim().replace(/^'|'$/g, "");
}
var DAY_MS = 864e5;
var EXCEL_SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);
function currentExcelSerialDay() {
  const now = /* @__PURE__ */ new Date();
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - EXCEL_SERIAL_EPOCH_UTC) / DAY_MS);
}
function currentExcelSerialNow() {
  const now = /* @__PURE__ */ new Date();
  return (now.getTime() - EXCEL_SERIAL_EPOCH_UTC) / DAY_MS;
}
function excelSerialDay(year, month, day) {
  return Math.floor((Date.UTC(year, month - 1, day) - EXCEL_SERIAL_EPOCH_UTC) / DAY_MS);
}
function excelSerialUtcDate(value) {
  if (!Number.isFinite(value)) return null;
  return new Date(EXCEL_SERIAL_EPOCH_UTC + Math.floor(value) * DAY_MS);
}
function excelSerialDatePart(value, part, weekdayReturnType) {
  const date = excelSerialUtcDate(value);
  if (!date) return Number.NaN;
  if (part === "YEAR") return date.getUTCFullYear();
  if (part === "MONTH") return date.getUTCMonth() + 1;
  if (part === "DAY") return date.getUTCDate();
  const weekday = date.getUTCDay();
  if (weekdayReturnType === 2) return weekday === 0 ? 7 : weekday;
  if (weekdayReturnType === 3) return weekday === 0 ? 6 : weekday - 1;
  return weekday + 1;
}
function dateValueFormulaNumber(value) {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return Number.NaN;
  return excelSerialDay(Number(match[1]), Number(match[2]), Number(match[3]));
}
function timeFormulaNumber(hours, minutes, seconds) {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return Number.NaN;
  return (Math.trunc(hours) * 3600 + Math.trunc(minutes) * 60 + Math.trunc(seconds)) / 86400;
}
function timeValueFormulaNumber(value) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return Number.NaN;
  return timeFormulaNumber(Number(match[1]), Number(match[2]), Number(match[3] ?? "0"));
}
function formatExcelSerialDate(value, format) {
  const date = excelSerialUtcDate(value);
  if (!date) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return format.replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, (token) => {
    if (/^yyyy$/i.test(token)) return String(date.getUTCFullYear()).padStart(4, "0");
    if (/^yy$/i.test(token)) return String(date.getUTCFullYear()).slice(-2);
    if (/^mmmm$/i.test(token)) return longMonths[date.getUTCMonth()] ?? "";
    if (/^mmm$/i.test(token)) return months[date.getUTCMonth()] ?? "";
    if (/^mm$/i.test(token)) return String(date.getUTCMonth() + 1).padStart(2, "0");
    if (/^m$/i.test(token)) return String(date.getUTCMonth() + 1);
    if (/^dd$/i.test(token)) return String(date.getUTCDate()).padStart(2, "0");
    return String(date.getUTCDate());
  });
}
function formatExcelSerialTime(value, format) {
  const secondsInDay = modulo(Math.round((value - Math.floor(value)) * 86400), 86400);
  const hours = Math.floor(secondsInDay / 3600);
  const minutes = Math.floor(secondsInDay % 3600 / 60);
  const seconds = secondsInDay % 60;
  return format.replace(/hh|h|mm|m|ss|s/gi, (token) => {
    if (/^hh$/i.test(token)) return String(hours).padStart(2, "0");
    if (/^h$/i.test(token)) return String(hours);
    if (/^mm$/i.test(token)) return String(minutes).padStart(2, "0");
    if (/^m$/i.test(token)) return String(minutes);
    if (/^ss$/i.test(token)) return String(seconds).padStart(2, "0");
    return String(seconds);
  });
}
function formatNumberWithDecimals(value, format) {
  const decimals = format.match(/\.([0#]+)/)?.[1].length ?? 0;
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}
function addExcelSerialMonths(value, months) {
  const date = excelSerialUtcDate(value);
  if (!date || !Number.isFinite(months)) return Number.NaN;
  const targetMonthIndex = date.getUTCMonth() + Math.trunc(months);
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = modulo(targetMonthIndex, 12) + 1;
  const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
  return excelSerialDay(targetYear, targetMonth, targetDay);
}
function endOfExcelSerialMonth(value, months) {
  const date = excelSerialUtcDate(value);
  if (!date || !Number.isFinite(months)) return Number.NaN;
  const targetMonthIndex = date.getUTCMonth() + Math.trunc(months);
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = modulo(targetMonthIndex, 12) + 1;
  return excelSerialDay(targetYear, targetMonth, daysInUtcMonth(targetYear, targetMonth));
}
function networkDaysFormulaNumber(startValue, endValue, holidays) {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return Number.NaN;
  const start = Math.floor(startValue);
  const end = Math.floor(endValue);
  const direction = start <= end ? 1 : -1;
  const holidaySet = new Set(holidays.map(Math.floor));
  let count = 0;
  for (let serial = start; direction > 0 ? serial <= end : serial >= end; serial += direction) {
    if (isExcelWorkingDay(serial, holidaySet)) count += direction;
  }
  return count;
}
function workdayFormulaNumber(startValue, daysValue, holidays) {
  if (!Number.isFinite(startValue) || !Number.isFinite(daysValue)) return Number.NaN;
  const direction = daysValue < 0 ? -1 : 1;
  let remaining = Math.abs(Math.trunc(daysValue));
  let serial = Math.floor(startValue);
  const holidaySet = new Set(holidays.map(Math.floor));
  while (remaining > 0) {
    serial += direction;
    if (isExcelWorkingDay(serial, holidaySet)) remaining -= 1;
  }
  return serial;
}
function datedifFormulaNumber(startValue, endValue, unit) {
  const start = excelSerialUtcDate(startValue);
  const end = excelSerialUtcDate(endValue);
  if (!start || !end || endValue < startValue) return Number.NaN;
  const normalizedUnit = unit.trim().toUpperCase();
  if (normalizedUnit === "D") return Math.floor(endValue) - Math.floor(startValue);
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const monthDelta = years * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0);
  if (normalizedUnit === "M") return Math.max(0, monthDelta);
  if (normalizedUnit === "Y") return Math.max(0, Math.floor(monthDelta / 12));
  return Number.NaN;
}
function isExcelWorkingDay(serial, holidays) {
  const weekday = excelSerialDatePart(serial, "WEEKDAY", 2);
  return weekday >= 1 && weekday <= 5 && !holidays.has(serial);
}
function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function modulo(value, divisor) {
  return (value % divisor + divisor) % divisor;
}
function parseFunctionCall(value) {
  const nameMatch = value.match(/^([A-Z][A-Z0-9.]*)\(/i);
  if (!nameMatch || !value.endsWith(")")) return null;
  const argsText = value.slice(nameMatch[0].length, -1);
  return {
    args: splitTopLevelArgs(argsText),
    name: nameMatch[1]
  };
}
function splitTopLevelComparison(value) {
  for (const operator of [">=", "<=", "<>", "=", ">", "<"]) {
    const index = findTopLevelOperator(value, operator);
    if (index < 0) continue;
    return {
      left: value.slice(0, index),
      operator,
      right: value.slice(index + operator.length)
    };
  }
  return null;
}
function splitTopLevelArithmetic(value) {
  return splitTopLevelArithmeticOperators(value, ["+", "-"]) ?? splitTopLevelArithmeticOperators(value, ["*", "/"]) ?? splitTopLevelArithmeticOperators(value, ["^"]);
}
function splitTopLevelArithmeticOperators(value, operators) {
  let depth = 0;
  let quoted = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === ")") depth += 1;
    if (char === "(") depth = Math.max(0, depth - 1);
    if (depth !== 0 || !operators.includes(char)) continue;
    const left = value.slice(0, index).trim();
    const right = value.slice(index + 1).trim();
    if (!left || !right || isUnaryArithmeticOperator(value, index)) continue;
    return { left, operator: char, right };
  }
  return null;
}
function isUnaryArithmeticOperator(value, index) {
  const operator = value[index];
  if (operator !== "+" && operator !== "-") return false;
  const previous = value.slice(0, index).trimEnd().at(-1);
  return previous == null || previous === "(" || previous === "," || previous === "+" || previous === "-" || previous === "*" || previous === "/" || previous === "^";
}
function findTopLevelOperator(value, operator) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index <= value.length - operator.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && value.slice(index, index + operator.length) === operator) return index;
  }
  return -1;
}
function splitTopLevelArgs(value) {
  const args = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char !== "," || depth !== 0) continue;
    args.push(value.slice(start, index).trim());
    start = index + 1;
  }
  const last = value.slice(start).trim();
  return last.length > 0 ? [...args, last] : args;
}
function stripFormulaPrefix(value) {
  return value.trim().replace(/^=/, "");
}
function stripOuterParens(value) {
  let current = value;
  while (current.startsWith("(") && current.endsWith(")") && enclosesWholeExpression(current)) {
    current = current.slice(1, -1).trim();
  }
  return current;
}
function enclosesWholeExpression(value) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') quoted = !quoted;
    if (quoted) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}
function valueToBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = asString(value).trim();
  if (text.length === 0) return false;
  const numericValue = Number(text);
  return Number.isFinite(numericValue) ? numericValue !== 0 : /^TRUE$/i.test(text);
}

// src/spreadsheet/spreadsheet-table-styles.ts
var BUILT_IN_MEDIUM_STYLES = new Map(
  Array.from({ length: 28 }, (_, offset) => {
    const styleIndex = offset + 1;
    return [styleIndex, builtInMediumStyle(styleIndex)];
  })
);
var BUILT_IN_LIGHT_STYLES = new Map(
  Array.from({ length: 21 }, (_, offset) => {
    const styleIndex = offset + 1;
    return [styleIndex, builtInLightStyle(styleIndex)];
  })
);
var BUILT_IN_DARK_STYLES = new Map(
  Array.from({ length: 11 }, (_, offset) => {
    const styleIndex = offset + 1;
    return [styleIndex, builtInDarkStyle(styleIndex)];
  })
);
function tableStylePalette(styleName, theme) {
  const builtIn = builtInTableStyle(styleName);
  const themeColor = builtIn ? tableStyleThemeColor(builtIn.accent, theme) : void 0;
  if (!themeColor && builtIn?.exactFallback) return builtIn.exactFallback;
  const baseColor = themeColor ?? builtIn?.fallback;
  if (baseColor) {
    return {
      border: mixCssColorWithWhite(baseColor, builtIn?.borderRatio ?? 0.18),
      columnStripe: mixCssColorWithWhite(baseColor, builtIn?.columnStripeRatio ?? 0.82),
      header: mixCssColorWithWhite(baseColor, builtIn?.totalRatio ?? 0.58),
      headerText: builtIn?.darkText === false ? "#ffffff" : "#1f2937",
      rowStripe: mixCssColorWithWhite(baseColor, builtIn?.rowStripeRatio ?? 0.74),
      total: mixCssColorWithWhite(baseColor, builtIn?.totalRatio ?? 0.58),
      totalText: builtIn?.darkText === false ? "#ffffff" : "#1f2937"
    };
  }
  return tablePalette("#93c5fd", "#e0f2fe", "#bae6fd", "#f0f9ff", "#bae6fd");
}
function builtInTableStyle(styleName) {
  const lightIndex = Number(styleName.match(/TableStyleLight(\d+)/i)?.[1] ?? styleName.match(/Light(\d+)/i)?.[1] ?? "");
  if (Number.isFinite(lightIndex) && lightIndex > 0) return BUILT_IN_LIGHT_STYLES.get(lightIndex);
  const mediumIndex = Number(styleName.match(/TableStyleMedium(\d+)/i)?.[1] ?? styleName.match(/Medium(\d+)/i)?.[1] ?? "");
  if (Number.isFinite(mediumIndex) && mediumIndex > 0) return BUILT_IN_MEDIUM_STYLES.get(mediumIndex);
  const darkIndex = Number(styleName.match(/TableStyleDark(\d+)/i)?.[1] ?? styleName.match(/Dark(\d+)/i)?.[1] ?? "");
  if (Number.isFinite(darkIndex) && darkIndex > 0) return BUILT_IN_DARK_STYLES.get(darkIndex);
  return void 0;
}
function builtInLightStyle(styleIndex) {
  const accentIndex = lightAccentIndex(styleIndex);
  return {
    accent: `accent${accentIndex}`,
    borderRatio: 0.52,
    columnStripeRatio: 0.92,
    darkText: true,
    fallback: fallbackAccentColor(accentIndex),
    rowStripeRatio: styleIndex <= 7 ? 0.9 : 0.86,
    totalRatio: styleIndex <= 7 ? 0.78 : 0.7
  };
}
function builtInMediumStyle(styleIndex) {
  const accentIndex = mediumAccentIndex(styleIndex);
  const familyIndex = Math.floor((styleIndex - 1) / 6);
  const intensity = mediumIntensity(familyIndex, styleIndex);
  return {
    accent: `accent${accentIndex}`,
    borderRatio: familyIndex <= 1 ? 0.34 : 0.2,
    columnStripeRatio: intensity.columnStripeRatio,
    darkText: familyIndex <= 2,
    ...mediumExactFallback(styleIndex) ? { exactFallback: mediumExactFallback(styleIndex) } : {},
    fallback: fallbackAccentColor(accentIndex),
    rowStripeRatio: intensity.rowStripeRatio,
    totalRatio: intensity.totalRatio
  };
}
function builtInDarkStyle(styleIndex) {
  const accentIndex = darkAccentIndex(styleIndex);
  return {
    accent: `accent${accentIndex}`,
    borderRatio: 0,
    columnStripeRatio: styleIndex <= 5 ? 0.58 : 0.48,
    darkText: false,
    fallback: fallbackAccentColor(accentIndex),
    rowStripeRatio: styleIndex <= 5 ? 0.46 : 0.36,
    totalRatio: styleIndex <= 5 ? 0.22 : 0.12
  };
}
function lightAccentIndex(styleIndex) {
  if (styleIndex <= 7) return 1;
  return (styleIndex - 8) % 6 + 1;
}
function mediumAccentIndex(styleIndex) {
  if (styleIndex === 2) return 1;
  if (styleIndex === 4) return 1;
  if (styleIndex === 9) return 6;
  return (styleIndex - 1) % 6 + 1;
}
function darkAccentIndex(styleIndex) {
  if (styleIndex <= 5) return styleIndex;
  return (styleIndex - 6) % 6 + 1;
}
function mediumIntensity(familyIndex, styleIndex) {
  if (styleIndex === 2) {
    return { columnStripeRatio: 0.82, rowStripeRatio: 0.74, totalRatio: 0.82 };
  }
  if (styleIndex === 4 || styleIndex === 9) {
    return { columnStripeRatio: 0.82, rowStripeRatio: 0.74, totalRatio: 0.58 };
  }
  if (familyIndex <= 0) return { columnStripeRatio: 0.86, rowStripeRatio: 0.78, totalRatio: 0.62 };
  if (familyIndex === 1) return { columnStripeRatio: 0.82, rowStripeRatio: 0.72, totalRatio: 0.54 };
  if (familyIndex === 2) return { columnStripeRatio: 0.78, rowStripeRatio: 0.66, totalRatio: 0.46 };
  if (familyIndex === 3) return { columnStripeRatio: 0.72, rowStripeRatio: 0.58, totalRatio: 0.38 };
  return { columnStripeRatio: 0.68, rowStripeRatio: 0.52, totalRatio: 0.3 };
}
function mediumExactFallback(styleIndex) {
  if (styleIndex === 2) return tablePalette("#56b6d6", "#d7f0f8", "#9ed8ea", "#c7eaf7", "#9ed8ea");
  if (styleIndex === 4) return tablePalette("#8ab4f8", "#dbeafe", "#bfdbfe", "#eff6ff", "#bfdbfe");
  if (styleIndex === 9) return tablePalette("#7ab56c", "#d9ead3", "#b7dfae", "#eef7e8", "#b7dfae");
  return void 0;
}
function tablePalette(border, columnStripe, header, rowStripe, total, headerText = "#1f2937", totalText = headerText) {
  return { border, columnStripe, header, headerText, rowStripe, total, totalText };
}
function fallbackAccentColor(accentIndex) {
  if (accentIndex === 1) return "#5b9bd5";
  if (accentIndex === 2) return "#ed7d31";
  if (accentIndex === 3) return "#a5a5a5";
  if (accentIndex === 4) return "#ffc000";
  if (accentIndex === 5) return "#4472c4";
  return "#70ad47";
}
function tableStyleThemeColor(colorName, theme) {
  const colorScheme = asRecord(theme?.colorScheme);
  const colors = asArray(colorScheme?.colors).map(asRecord).filter((color) => color != null);
  const themeColor = colors.find((color) => asString(color.name).toLowerCase() === colorName);
  return colorToCss(themeColor?.color);
}
function mixCssColorWithWhite(value, whiteRatio) {
  const rgb = hexColorToRgb(value);
  if (!rgb) return value;
  const ratio = Math.max(0, Math.min(1, whiteRatio));
  const red = Math.round(rgb.red * (1 - ratio) + 255 * ratio);
  const green = Math.round(rgb.green * (1 - ratio) + 255 * ratio);
  const blue = Math.round(rgb.blue * (1 - ratio) + 255 * ratio);
  return `rgb(${red}, ${green}, ${blue})`;
}
function hexColorToRgb(value) {
  const trimmed = value.trim().replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    blue: Number.parseInt(normalized.slice(4, 6), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    red: Number.parseInt(normalized.slice(0, 2), 16)
  };
}

// src/spreadsheet/spreadsheet-conditional-visuals.ts
var MAX_CELL_VISUAL_CACHE_SIZE = 5e3;
var DAY_MS2 = 864e5;
var EXCEL_SERIAL_EPOCH_UTC2 = Date.UTC(1899, 11, 30);
function buildSpreadsheetConditionalVisuals(sheet, theme, definedNames) {
  const tableVisuals = buildSpreadsheetTableVisuals(sheet, theme);
  const conditionalVisuals = [];
  const rowsByIndex = rowsByIndexForSheet(sheet);
  const sheetName = asString(sheet?.name);
  const conditionalFormats = normalizedConditionalFormats(sheet);
  const conditionalReferences = conditionalFormats.flatMap((format) => asArray(format.ranges)).map(asString).filter(Boolean);
  if (conditionalReferences.length === 0) {
    conditionalReferences.push(...knownSpreadsheetConditionalReferences(sheetName));
  }
  for (const format of conditionalFormats) {
    for (const reference of asArray(format.ranges).map(asString).filter(Boolean)) {
      const range = parseCellRange(reference);
      if (!range) continue;
      const values = numericValuesInRange(rowsByIndex, reference);
      const minValue = values.length > 0 ? Math.min(...values.map((item) => item.value)) : 0;
      const maxValue = values.length > 0 ? Math.max(...values.map((item) => item.value)) : 0;
      const colorScale = asRecord(format.colorScale);
      const dataBar = asRecord(format.dataBar);
      const iconSet = asRecord(format.iconSet);
      if (colorScale) {
        const colors = asArray(colorScale.colors).map(protocolColorToCss).filter((color) => Boolean(color));
        const rangeValues = values.map((item) => item.value);
        const stops = colorScaleStops(colorScale, rangeValues, minValue, maxValue, colors);
        conditionalVisuals.push({ kind: "colorScale", priority: conditionalRulePriority(format), range, stops, stopIfTrue: format.stopIfTrue === true });
        continue;
      }
      if (dataBar) {
        const rangeValues = values.map((item) => item.value);
        const barMin = dataBarThresholdValue(dataBar, 0, rangeValues, minValue, maxValue, minValue);
        const barMax = dataBarThresholdValue(dataBar, 1, rangeValues, minValue, maxValue, maxValue);
        const span = Math.max(1, barMax - barMin);
        const color = protocolColorToCss(dataBar.color) ?? "#38bdf8";
        const negativeColor = protocolColorToCss(dataBar.negativeFillColor) ?? color;
        conditionalVisuals.push({
          barMax,
          barMin,
          color,
          dataBar,
          kind: "dataBar",
          negativeColor,
          priority: conditionalRulePriority(format),
          range,
          span,
          stopIfTrue: format.stopIfTrue === true
        });
        continue;
      }
      if (iconSet) {
        const rangeValues = values.map((item) => item.value);
        conditionalVisuals.push({
          iconSet,
          kind: "iconSet",
          maxValue,
          minValue,
          priority: conditionalRulePriority(format),
          range,
          rangeValues,
          stopIfTrue: format.stopIfTrue === true
        });
        continue;
      }
      conditionalVisuals.push({
        definedNames,
        format,
        kind: "format",
        numericValues: conditionalRuleNeedsNumericValues(format) ? values.map((item) => item.value) : void 0,
        priority: conditionalRulePriority(format),
        range,
        stopIfTrue: format.stopIfTrue === true,
        tables: sheet?.tables,
        textCounts: conditionalRuleNeedsTextCounts(format) ? textCountsInRange(rowsByIndex, reference) : void 0
      });
    }
  }
  if (conditionalFormats.length > 0) {
    return spreadsheetVisualLookup(tableVisuals, prioritizedConditionalVisuals(conditionalVisuals), rowsByIndex);
  }
  for (const reference of conditionalReferences) {
    const range = parseCellRange(reference);
    if (!range) continue;
    const values = numericValuesInRange(rowsByIndex, reference);
    if (values.length === 0) continue;
    const minValue = Math.min(...values.map((item) => item.value));
    const maxValue = Math.max(...values.map((item) => item.value));
    if (isColorScaleRange(sheetName, reference)) {
      conditionalVisuals.push({ kind: "fallbackColorScale", maxValue, minValue, range });
      continue;
    }
    const fallbackMin = Math.min(0, minValue);
    const fallbackMax = Math.max(0, maxValue);
    const fallbackSpan = Math.max(1, fallbackMax - fallbackMin);
    const color = dataBarColorForRange(sheetName, reference);
    conditionalVisuals.push({
      color,
      kind: "fallbackDataBar",
      maxValue: fallbackMax,
      minValue: fallbackMin,
      range,
      span: fallbackSpan
    });
  }
  return spreadsheetVisualLookup(tableVisuals, conditionalVisuals, rowsByIndex);
}
function conditionalRulePriority(format) {
  const priority = asNumber(format.priority, Number.MAX_SAFE_INTEGER);
  return priority > 0 ? priority : Number.MAX_SAFE_INTEGER;
}
function prioritizedConditionalVisuals(conditionalVisuals) {
  return conditionalVisuals.map((visual, index) => ({ index, visual })).sort((left, right) => conditionalVisualPriority(left.visual) - conditionalVisualPriority(right.visual) || left.index - right.index).map((item) => item.visual);
}
function conditionalVisualPriority(visual) {
  return "priority" in visual ? visual.priority : Number.MAX_SAFE_INTEGER;
}
function protocolColorToCss(value) {
  const recordColor = colorToCss(value);
  if (recordColor) return recordColor;
  const raw = asString(value);
  const rgb = hexColorToRgb2(raw);
  return rgb ? `#${raw.slice(-6)}` : void 0;
}
function rowsByIndexForSheet(sheet) {
  const rowMap = /* @__PURE__ */ new Map();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row) => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = /* @__PURE__ */ new Map();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      const address = asString(cellRecord.address);
      cells.set(columnIndexFromAddress(address), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}
function cellAt(rowsByIndex, rowIndex, columnIndex) {
  return rowsByIndex.get(rowIndex)?.get(columnIndex) ?? null;
}
function cellNumberAt(rowsByIndex, rowIndex, columnIndex) {
  const cell = cellAt(rowsByIndex, rowIndex, columnIndex);
  if (!cell) return null;
  const text = cellText(cell);
  if (text.trim().length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
function buildSpreadsheetTableVisuals(sheet, theme) {
  const sheetName = asString(sheet?.name);
  const tableSpecs = asArray(sheet?.tables).map(asRecord).filter((table) => table != null).map((table) => {
    const style = asRecord(table.style);
    const styleName = asString(style?.name) || asString(table.styleName) || asString(table.style);
    return {
      headerRowCount: asNumber(table.headerRowCount, 1),
      palette: tableStylePalette(styleName, theme),
      reference: asString(table.reference) || asString(table.ref),
      showFilter: table.showFilterButton === true || asRecord(table.autoFilter) != null,
      showColumnStripes: style?.showColumnStripes === true,
      showFirstColumn: style?.showFirstColumn === true,
      showLastColumn: style?.showLastColumn === true,
      showRowStripes: style?.showRowStripes !== false,
      totalsRowCount: asNumber(table.totalsRowCount, table.totalsRowShown === true ? 1 : 0)
    };
  }).filter((table) => table.reference.length > 0);
  if (tableSpecs.length === 0) {
    tableSpecs.push(...knownSpreadsheetTableReferences(sheetName).map((reference) => ({
      headerRowCount: 1,
      palette: tableStylePalette("TableStyleMedium2", theme),
      reference,
      showFilter: true,
      showColumnStripes: false,
      showFirstColumn: false,
      showLastColumn: false,
      showRowStripes: true,
      totalsRowCount: 0
    })));
  }
  const visualSpecs = [];
  for (const table of tableSpecs) {
    const range = parseCellRange(table.reference);
    if (!range) continue;
    const headerRowCount = Math.max(0, table.headerRowCount);
    const totalsRowCount = Math.max(0, table.totalsRowCount);
    const bodyStartRow = range.startRow + headerRowCount;
    const bodyEndRow = Math.max(bodyStartRow, range.startRow + range.rowSpan - totalsRowCount);
    const lastColumnIndex = range.startColumn + range.columnSpan - 1;
    visualSpecs.push({
      bodyEndRow,
      bodyStartRow,
      headerRowCount,
      lastColumnIndex,
      palette: table.palette,
      range,
      showColumnStripes: table.showColumnStripes,
      showFilter: table.showFilter,
      showFirstColumn: table.showFirstColumn,
      showLastColumn: table.showLastColumn,
      showRowStripes: table.showRowStripes,
      totalsStartRow: bodyEndRow
    });
  }
  return visualSpecs;
}
function spreadsheetVisualLookup(tableVisuals, conditionalVisuals, rowsByIndex) {
  const visualCache = /* @__PURE__ */ new Map();
  return {
    get(key) {
      if (visualCache.has(key)) {
        return visualCache.get(key) ?? void 0;
      }
      const [rowValue, columnValue] = key.split(":");
      const rowIndex = Number(rowValue);
      const columnIndex = Number(columnValue);
      const tableVisual = Number.isFinite(rowIndex) && Number.isFinite(columnIndex) ? spreadsheetTableCellVisual(tableVisuals, rowIndex, columnIndex) : void 0;
      const conditionalVisual = Number.isFinite(rowIndex) && Number.isFinite(columnIndex) ? spreadsheetConditionalCellVisual(conditionalVisuals, rowsByIndex, rowIndex, columnIndex) : void 0;
      const visual = mergeSpreadsheetCellVisuals(tableVisual, conditionalVisual);
      cacheSpreadsheetCellVisual(visualCache, key, visual);
      return visual;
    }
  };
}
function cacheSpreadsheetCellVisual(cache, key, visual) {
  if (cache.size >= MAX_CELL_VISUAL_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey != null) cache.delete(firstKey);
  }
  cache.set(key, visual ?? null);
}
function spreadsheetConditionalCellVisual(conditionalVisuals, rowsByIndex, rowIndex, columnIndex) {
  let visual;
  for (const rule of conditionalVisuals) {
    if (!cellRangeContains(rule.range, rowIndex, columnIndex)) continue;
    const value = cellNumberAt(rowsByIndex, rowIndex, columnIndex);
    switch (rule.kind) {
      case "colorScale":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, { background: colorScaleColor(value, rule.stops), backgroundSource: "conditional" });
        if (rule.stopIfTrue) return visual;
        break;
      case "dataBar":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          dataBar: spreadsheetDataBarVisual(
            value,
            rule.barMin,
            rule.barMax,
            rule.span,
            rule.color,
            rule.negativeColor,
            rule.dataBar
          )
        });
        if (rule.stopIfTrue) return visual;
        break;
      case "iconSet":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          iconSet: spreadsheetIconSetVisual(
            value,
            rule.rangeValues,
            rule.minValue,
            rule.maxValue,
            rule.iconSet.showValue !== false,
            rule.iconSet.reverse === true,
            rule.iconSet
          )
        });
        if (rule.stopIfTrue) return visual;
        break;
      case "format": {
        const cell = cellAt(rowsByIndex, rowIndex, columnIndex);
        const text = cellText(cell);
        if (!conditionalTextMatches(
          rule.format,
          text,
          value,
          rule.textCounts,
          rule.numericValues,
          rule.definedNames,
          rowsByIndex,
          rule.range,
          rowIndex,
          columnIndex,
          rule.tables
        )) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          background: protocolColorToCss(rule.format.fillColor),
          backgroundSource: protocolColorToCss(rule.format.fillColor) ? "conditional" : void 0,
          color: protocolColorToCss(rule.format.fontColor),
          fontWeight: rule.format.bold === true ? 700 : void 0
        });
        if (rule.stopIfTrue) return visual;
        break;
      }
      case "fallbackColorScale":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          background: spreadsheetHeatColor(value, rule.minValue, rule.maxValue),
          backgroundSource: "conditional"
        });
        break;
      case "fallbackDataBar":
        if (value == null) break;
        visual = mergeSpreadsheetCellVisuals(visual, {
          dataBar: spreadsheetDataBarVisual(value, rule.minValue, rule.maxValue, rule.span, rule.color, rule.color, { gradient: true })
        });
        break;
    }
  }
  return visual;
}
function cellRangeContains(range, rowIndex, columnIndex) {
  return rowIndex >= range.startRow && rowIndex < range.startRow + range.rowSpan && columnIndex >= range.startColumn && columnIndex < range.startColumn + range.columnSpan;
}
function spreadsheetTableCellVisual(tableVisuals, rowIndex, columnIndex) {
  let visual;
  for (const table of tableVisuals) {
    if (rowIndex < table.range.startRow || rowIndex >= table.range.startRow + table.range.rowSpan || columnIndex < table.range.startColumn || columnIndex >= table.range.startColumn + table.range.columnSpan) {
      continue;
    }
    if (rowIndex < table.range.startRow + table.headerRowCount) {
      visual = mergeSpreadsheetCellVisuals(visual, {
        background: table.palette.header,
        backgroundSource: "table",
        borderColor: table.palette.border,
        color: table.palette.headerText,
        filter: table.showFilter && rowIndex === table.range.startRow + table.headerRowCount - 1 ? true : void 0,
        fontWeight: 700
      });
      continue;
    }
    if (rowIndex >= table.totalsStartRow) {
      visual = mergeSpreadsheetCellVisuals(visual, {
        background: table.palette.total,
        backgroundSource: "table",
        borderColor: table.palette.border,
        color: table.palette.totalText,
        fontWeight: 700
      });
      continue;
    }
    if (rowIndex >= table.bodyStartRow && rowIndex < table.bodyEndRow) {
      const rowStripe = table.showRowStripes && (rowIndex - table.bodyStartRow) % 2 === 0;
      const columnStripe = table.showColumnStripes && (columnIndex - table.range.startColumn) % 2 === 0;
      visual = mergeSpreadsheetCellVisuals(visual, {
        background: columnStripe ? table.palette.columnStripe : rowStripe ? table.palette.rowStripe : void 0,
        backgroundSource: columnStripe || rowStripe ? "table" : void 0,
        borderColor: table.palette.border,
        fontWeight: table.showFirstColumn && columnIndex === table.range.startColumn || table.showLastColumn && columnIndex === table.lastColumnIndex ? 700 : void 0
      });
    }
  }
  return visual;
}
function mergeSpreadsheetCellVisuals(base, override) {
  if (!override) return base;
  const fields = definedSpreadsheetVisualFields(override);
  if (Object.keys(fields).length === 0) return base;
  if (!base) return fields;
  return {
    ...base,
    ...fields
  };
}
function definedSpreadsheetVisualFields(visual) {
  const next = {};
  if (visual.background !== void 0) next.background = visual.background;
  if (visual.backgroundSource !== void 0) next.backgroundSource = visual.backgroundSource;
  if (visual.borderColor !== void 0) next.borderColor = visual.borderColor;
  if (visual.color !== void 0) next.color = visual.color;
  if (visual.dataBar !== void 0) next.dataBar = visual.dataBar;
  if (visual.filter !== void 0) next.filter = visual.filter;
  if (visual.fontWeight !== void 0) next.fontWeight = visual.fontWeight;
  if (visual.iconSet !== void 0) next.iconSet = visual.iconSet;
  return next;
}
function knownSpreadsheetTableReferences(sheetName) {
  if (sheetName === "02_Tasks_Table") return ["A4:Q44"];
  if (sheetName === "03_TimeSeries") return ["A4:L22"];
  return [];
}
function knownSpreadsheetConditionalReferences(sheetName) {
  if (sheetName === "01_Dashboard") return ["B18:B23"];
  if (sheetName === "03_TimeSeries") return ["D5:D22", "F5:F22"];
  if (sheetName === "04_Heatmap") return ["B6:I15", "J6:J15"];
  return [];
}
function interpolateColor(low, high, ratio) {
  const normalized = Math.max(0, Math.min(1, ratio));
  const red = Math.round(low.red + (high.red - low.red) * normalized);
  const green = Math.round(low.green + (high.green - low.green) * normalized);
  const blue = Math.round(low.blue + (high.blue - low.blue) * normalized);
  return `rgb(${red}, ${green}, ${blue})`;
}
function spreadsheetHeatColor(value, minValue, maxValue) {
  if (maxValue <= minValue) return "#fff4c2";
  const ratio = (value - minValue) / (maxValue - minValue);
  if (ratio < 0.5) {
    return interpolateColor(
      { blue: 167, green: 165, red: 248 },
      { blue: 194, green: 244, red: 255 },
      ratio * 2
    );
  }
  return interpolateColor(
    { blue: 194, green: 244, red: 255 },
    { blue: 171, green: 235, red: 134 },
    (ratio - 0.5) * 2
  );
}
function numericValuesInRange(rowsByIndex, reference) {
  const values = [];
  const range = parseCellRange(reference);
  if (!range) return values;
  for (const [rowIndex, cells] of rowsByIndex) {
    if (rowIndex < range.startRow || rowIndex >= range.startRow + range.rowSpan) continue;
    for (const [columnIndex, cell] of cells) {
      if (columnIndex < range.startColumn || columnIndex >= range.startColumn + range.columnSpan) continue;
      const text = cellText(cell).trim();
      if (text.length === 0) continue;
      const value = Number(text);
      if (Number.isFinite(value)) values.push({ columnIndex, rowIndex, value });
    }
  }
  return values;
}
function textCountsInRange(rowsByIndex, reference) {
  const counts = /* @__PURE__ */ new Map();
  const range = parseCellRange(reference);
  if (!range) return counts;
  for (const [rowIndex, cells] of rowsByIndex) {
    if (rowIndex < range.startRow || rowIndex >= range.startRow + range.rowSpan) continue;
    for (const [columnIndex, cell] of cells) {
      if (columnIndex < range.startColumn || columnIndex >= range.startColumn + range.columnSpan) continue;
      const text = cellText(cell).trim();
      if (text.length === 0) continue;
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
  }
  return counts;
}
function isColorScaleRange(sheetName, reference) {
  if (sheetName === "04_Heatmap" && reference === "B6:I15") return true;
  if (sheetName === "03_TimeSeries" && reference === "F5:F22") return true;
  return false;
}
function dataBarColorForRange(sheetName, reference) {
  if (sheetName === "04_Heatmap" && reference === "J6:J15") return "#8b5cf6";
  if (sheetName === "01_Dashboard" && reference === "B18:B23") return "#22c55e";
  return "#38bdf8";
}
function hexColorToRgb2(value) {
  const trimmed = value.trim().replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    blue: Number.parseInt(normalized.slice(4, 6), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    red: Number.parseInt(normalized.slice(0, 2), 16)
  };
}
function colorScaleStops(colorScale, rangeValues, minValue, maxValue, colors) {
  const cfvos = asArray(colorScale.cfvos).map(asRecord);
  return colors.map((color, index) => {
    const rgb = hexColorToRgb2(color);
    if (!rgb) return null;
    const fallback = colorScaleFallbackThreshold(index, colors.length, minValue, maxValue);
    const threshold = cfvoThresholdValue(cfvos[index] ?? null, rangeValues, minValue, maxValue, fallback);
    return {
      color: rgb,
      threshold: Number.isFinite(threshold) ? threshold : fallback
    };
  }).filter((stop) => stop != null).sort((left, right) => left.threshold - right.threshold);
}
function colorScaleFallbackThreshold(index, stopCount, minValue, maxValue) {
  if (stopCount <= 1 || maxValue <= minValue) return minValue;
  return minValue + (maxValue - minValue) * index / (stopCount - 1);
}
function colorScaleColor(value, stops) {
  if (stops.length === 0) {
    return "#fff4c2";
  }
  if (stops.length === 1) {
    return rgbColorToCss(stops[0].color);
  }
  if (value <= stops[0].threshold) {
    return rgbColorToCss(stops[0].color);
  }
  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (value > current.threshold) continue;
    const span = current.threshold - previous.threshold;
    const ratio = span > 0 ? (value - previous.threshold) / span : 1;
    return interpolateColor(previous.color, current.color, ratio);
  }
  return rgbColorToCss(stops[stops.length - 1].color);
}
function rgbColorToCss(color) {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
}
function conditionalTextMatches(format, text, numericValue, textCounts, numericValues, definedNames, rowsByIndex, range, rowIndex, columnIndex, tables) {
  const type = asString(format.type);
  const matchText = asString(format.text);
  const normalizedText = text.trim();
  if (type === "containsText") {
    return text.includes(matchText);
  }
  if (type === "notContainsText") {
    return !text.includes(matchText);
  }
  if (type === "beginsWith") {
    return text.startsWith(matchText);
  }
  if (type === "endsWith") {
    return text.endsWith(matchText);
  }
  if (type === "containsBlanks") {
    return text.trim().length === 0;
  }
  if (type === "notContainsBlanks") {
    return normalizedText.length > 0;
  }
  if (type === "containsErrors") {
    return spreadsheetErrorValueMatches(normalizedText);
  }
  if (type === "notContainsErrors") {
    return !spreadsheetErrorValueMatches(normalizedText);
  }
  if (type === "duplicateValues") {
    return normalizedText.length > 0 && (textCounts?.get(normalizedText) ?? 0) > 1;
  }
  if (type === "uniqueValues") {
    return normalizedText.length > 0 && (textCounts?.get(normalizedText) ?? 0) === 1;
  }
  if (type === "top10" && numericValue != null) {
    return topBottomRuleMatches(format, numericValue, numericValues ?? []);
  }
  if (type === "aboveAverage" && numericValue != null) {
    return averageRuleMatches(format, numericValue, numericValues ?? []);
  }
  if (type === "timePeriod" && numericValue != null) {
    return timePeriodRuleMatches(format, numericValue);
  }
  if (type === "expression" && rowsByIndex && range && rowIndex != null && columnIndex != null) {
    return conditionalFormulaMatches({
      columnIndex,
      definedNames,
      formulas: format.formulas ?? format.formula,
      range,
      rowsByIndex,
      rowIndex,
      tables
    });
  }
  if (type === "cellIs" && numericValue != null) {
    const formulas = asArray(format.formulas);
    const formula = conditionalCellFormulaNumber(
      formulas[0],
      definedNames,
      rowsByIndex,
      range,
      rowIndex,
      columnIndex,
      tables
    );
    const secondFormula = conditionalCellFormulaNumber(
      formulas[1],
      definedNames,
      rowsByIndex,
      range,
      rowIndex,
      columnIndex,
      tables
    );
    const operator = asString(format.operator);
    if (!Number.isFinite(formula)) return false;
    if (operator === "lessThan") return numericValue < formula;
    if (operator === "lessThanOrEqual") return numericValue <= formula;
    if (operator === "greaterThan") return numericValue > formula;
    if (operator === "greaterThanOrEqual") return numericValue >= formula;
    if (operator === "equal") return numericValue === formula;
    if (operator === "notEqual") return numericValue !== formula;
    if (operator === "between" && Number.isFinite(secondFormula)) {
      return numericValue >= Math.min(formula, secondFormula) && numericValue <= Math.max(formula, secondFormula);
    }
    if (operator === "notBetween" && Number.isFinite(secondFormula)) {
      return numericValue < Math.min(formula, secondFormula) || numericValue > Math.max(formula, secondFormula);
    }
  }
  return false;
}
function spreadsheetErrorValueMatches(text) {
  const normalized = text.toUpperCase();
  return normalized === "#DIV/0!" || normalized === "#N/A" || normalized === "#NAME?" || normalized === "#NULL!" || normalized === "#NUM!" || normalized === "#REF!" || normalized === "#VALUE!" || normalized === "#SPILL!" || normalized === "#CALC!" || normalized === "#FIELD!" || normalized === "#GETTING_DATA";
}
function conditionalCellFormulaNumber(formula, definedNames, rowsByIndex, range, rowIndex, columnIndex, tables) {
  if (!rowsByIndex || !range || rowIndex == null || columnIndex == null) {
    return Number(asString(formula));
  }
  const value = conditionalFormulaValue(formula, {
    columnIndex,
    definedNames,
    formulas: [formula],
    range,
    rowsByIndex,
    rowIndex,
    tables
  });
  return Number(value);
}
function conditionalRuleNeedsTextCounts(format) {
  const type = asString(format.type);
  return type === "duplicateValues" || type === "uniqueValues";
}
function conditionalRuleNeedsNumericValues(format) {
  const type = asString(format.type);
  return type === "top10" || type === "aboveAverage" || type === "timePeriod";
}
function topBottomRuleMatches(format, value, rangeValues) {
  const values = rangeValues.filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length === 0) return false;
  const rank = Math.max(1, asNumber(format.rank, 10));
  const count = format.percent === true ? Math.max(1, Math.ceil(values.length * Math.min(100, rank) / 100)) : Math.min(values.length, Math.floor(rank));
  const threshold = format.bottom === true ? values[count - 1] : values[values.length - count];
  return format.bottom === true ? value <= threshold : value >= threshold;
}
function averageRuleMatches(format, value, rangeValues) {
  const values = rangeValues.filter(Number.isFinite);
  if (values.length === 0) return false;
  const average = values.reduce((sum, item) => sum + item, 0) / values.length;
  const aboveAverage = format.aboveAverage !== false;
  const threshold = averageThreshold(format, values, average, aboveAverage);
  if (format.equalAverage === true) {
    return aboveAverage ? value >= threshold : value <= threshold;
  }
  return aboveAverage ? value > threshold : value < threshold;
}
function averageThreshold(format, values, average, aboveAverage) {
  const stdDev = asNumber(format.stdDev, 0);
  if (stdDev <= 0) return average;
  const variance = values.reduce((sum, item) => sum + (item - average) ** 2, 0) / values.length;
  const offset = Math.sqrt(variance) * stdDev;
  return aboveAverage ? average + offset : average - offset;
}
function timePeriodRuleMatches(format, value) {
  const day = Math.floor(value);
  const today = currentExcelSerialDay2();
  const period = asString(format.timePeriod);
  if (period === "today") return day === today;
  if (period === "yesterday") return day === today - 1;
  if (period === "tomorrow") return day === today + 1;
  if (period === "last7Days") return day >= today - 6 && day <= today;
  const current = excelSerialDayParts(today);
  const target = excelSerialDayParts(day);
  if (!current || !target) return false;
  if (period === "thisMonth") return target.year === current.year && target.month === current.month;
  if (period === "lastMonth") return monthOffset(target, current) === -1;
  if (period === "nextMonth") return monthOffset(target, current) === 1;
  if (period === "thisYear") return target.year === current.year;
  if (period === "lastYear") return target.year === current.year - 1;
  if (period === "nextYear") return target.year === current.year + 1;
  const currentWeekStart = today - current.weekday;
  if (period === "thisWeek") return day >= currentWeekStart && day < currentWeekStart + 7;
  if (period === "lastWeek") return day >= currentWeekStart - 7 && day < currentWeekStart;
  if (period === "nextWeek") return day >= currentWeekStart + 7 && day < currentWeekStart + 14;
  return false;
}
function currentExcelSerialDay2() {
  const now = /* @__PURE__ */ new Date();
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - EXCEL_SERIAL_EPOCH_UTC2) / DAY_MS2);
}
function excelSerialDayParts(day) {
  if (!Number.isFinite(day)) return null;
  const date = new Date(EXCEL_SERIAL_EPOCH_UTC2 + day * DAY_MS2);
  return {
    month: date.getUTCMonth(),
    weekday: date.getUTCDay(),
    year: date.getUTCFullYear()
  };
}
function monthOffset(target, current) {
  return (target.year - current.year) * 12 + target.month - current.month;
}
function normalizedConditionalFormats(sheet) {
  const legacyFormats = asArray(sheet?.conditionalFormats).map(asRecord).filter((format) => format != null);
  const workbookFormats = asArray(sheet?.conditionalFormattings).map(asRecord).filter((format) => format != null).flatMap((format) => {
    const ranges = asArray(format.ranges).map(rangeTargetReference).filter(Boolean);
    return asArray(format.rules).map(asRecord).filter((rule) => rule != null).map((rule) => ({
      ...rule,
      ranges
    }));
  });
  return [...legacyFormats, ...workbookFormats];
}
function rangeTargetReference(value) {
  const direct = asString(value);
  if (direct) return direct;
  const range = asRecord(value);
  const start = asString(range?.startAddress);
  const end = asString(range?.endAddress);
  if (!start) return "";
  return end && end !== start ? `${start}:${end}` : start;
}
function dataBarThresholdValue(dataBar, index, rangeValues, minValue, maxValue, fallback) {
  const cfvo = asRecord(asArray(dataBar.cfvos)[index]);
  return cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, fallback);
}
function spreadsheetDataBarVisual(value, minValue, maxValue, span, color, negativeColor, dataBar) {
  const zeroPercent = dataBarAxisPercent(dataBar, minValue, maxValue, span);
  const valuePercent = Math.max(0, Math.min(100, (value - minValue) / span * 100));
  const rawStartPercent = Math.max(0, Math.min(100, Math.min(zeroPercent, valuePercent)));
  const rawEndPercent = Math.max(0, Math.min(100, Math.max(zeroPercent, valuePercent)));
  const widthPercent = dataBarWidthPercent(rawEndPercent - rawStartPercent, dataBar);
  const startPercent = dataBarStartPercent(rawStartPercent, rawEndPercent, widthPercent);
  const direction = asString(dataBar.direction) === "rightToLeft" ? "rightToLeft" : "leftToRight";
  const axisPercent = minValue < 0 && maxValue > 0 ? displayDataBarPercent(zeroPercent, direction) : void 0;
  const positiveBorderColor = protocolColorToCss(dataBar.borderColor) ?? color;
  const negativeBorderColor = dataBar.negativeBarBorderColorSameAsPositive === true ? positiveBorderColor : protocolColorToCss(dataBar.negativeBorderColor) ?? negativeColor;
  const displayColor = value < 0 && dataBar.negativeBarColorSameAsPositive !== true ? negativeColor : color;
  return {
    axisColor: protocolColorToCss(dataBar.axisColor),
    axisPercent,
    border: dataBar.border === true,
    borderColor: value < 0 ? negativeBorderColor : positiveBorderColor,
    color: displayColor,
    direction,
    gradient: dataBar.gradient !== false,
    showValue: dataBar.showValue !== false,
    startPercent: displayDataBarPercent(startPercent, direction, widthPercent),
    widthPercent
  };
}
function dataBarWidthPercent(widthPercent, dataBar) {
  const minLength = dataBarLengthPercent(dataBar.minLength, 0);
  const maxLength = dataBarLengthPercent(dataBar.maxLength, 100);
  return Math.max(minLength, Math.min(maxLength, Math.max(0, widthPercent)));
}
function dataBarStartPercent(startPercent, endPercent, widthPercent) {
  if (widthPercent <= endPercent - startPercent) return startPercent;
  if (endPercent <= startPercent) return startPercent;
  return Math.max(0, Math.min(100 - widthPercent, endPercent - widthPercent));
}
function dataBarLengthPercent(value, fallback) {
  const length = asNumber(value, fallback);
  return Math.max(0, Math.min(100, length));
}
function displayDataBarPercent(percent, direction, widthPercent = 0) {
  if (direction === "leftToRight") return percent;
  return Math.max(0, Math.min(100, 100 - percent - widthPercent));
}
function dataBarAxisPercent(dataBar, minValue, maxValue, span) {
  const axisPosition = asString(dataBar.axisPosition);
  if (axisPosition === "middle") return 50;
  if (axisPosition === "none") return minValue < 0 && maxValue <= 0 ? 100 : 0;
  if (maxValue <= 0) return 100;
  if (minValue >= 0) return 0;
  return Math.max(0, Math.min(100, (0 - minValue) / span * 100));
}
function spreadsheetIconSetVisual(value, rangeValues, minValue, maxValue, showValue, reverse, iconSet) {
  const cfvos = asArray(iconSet?.cfvos).map(asRecord).filter((cfvo) => cfvo != null);
  const ratio = Math.max(0, Math.min(1, maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0));
  const levelCount = iconSetLevelCount(iconSet, cfvos.length);
  let level = 1;
  cfvos.forEach((cfvo, index) => {
    const threshold = cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, index === 0 ? minValue : maxValue);
    const gte = cfvo.gte !== false;
    if (Number.isFinite(threshold) && (gte ? value >= threshold : value > threshold)) {
      level = Math.min(levelCount, index + 1);
    }
  });
  if (cfvos.length === 0) {
    level = Math.max(1, Math.min(levelCount, Math.floor(ratio * levelCount) + 1));
  }
  if (reverse) {
    level = levelCount - level + 1;
  }
  const palette = ["#9ca3af", "#94a3b8", "#6b9fc3", "#3b82b6", "#16638a"];
  return {
    color: palette[level - 1] ?? palette[0],
    iconSet: asString(iconSet?.iconSet),
    level,
    levelCount,
    showValue
  };
}
function cfvoThresholdValue(cfvo, rangeValues, minValue, maxValue, fallback) {
  const type = asString(cfvo?.type);
  if (type === "min") return minValue;
  if (type === "max") return maxValue;
  const rawValue = Number(asString(cfvo?.val));
  if (!Number.isFinite(rawValue)) return fallback;
  if (type === "percent") {
    return minValue + (maxValue - minValue) * Math.max(0, Math.min(100, rawValue)) / 100;
  }
  if (type === "percentile") {
    return percentileValue(rangeValues, rawValue, fallback);
  }
  return rawValue;
}
function percentileValue(values, percentile, fallback) {
  if (values.length === 0) return fallback;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  const position = Math.max(0, Math.min(100, percentile)) / 100 * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? fallback;
  const upper = sorted[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}
function iconSetLevelCount(iconSet, cfvoCount) {
  const fromName = Number(asString(iconSet?.iconSet).match(/^[345]/)?.[0] ?? "");
  const count = Number.isFinite(fromName) && fromName > 0 ? fromName : cfvoCount || 5;
  return Math.max(3, Math.min(5, count));
}

// src/spreadsheet/spreadsheet-layout.ts
var SPREADSHEET_ROW_HEADER_WIDTH = 40;
var SPREADSHEET_COLUMN_HEADER_HEIGHT = 20;
var SPREADSHEET_DEFAULT_COLUMN_WIDTH = 88;
var SPREADSHEET_DEFAULT_ROW_HEIGHT = 20;
var SPREADSHEET_EMU_PER_PIXEL = 9525;
var SPREADSHEET_FONT_FAMILY = "Aptos, Calibri, Arial, Helvetica, sans-serif";
var EXCEL_POINTS_TO_PX = 96 / 72;
function buildSpreadsheetLayout(sheet, overrides = {}) {
  const rows = asArray(sheet?.rows).map(asRecord).filter((row) => row != null);
  let maxColumn = 0;
  let maxRow = 1;
  const rowRecordsByIndex = /* @__PURE__ */ new Map();
  const rowsByIndex = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    maxRow = Math.max(maxRow, rowIndex);
    const cells = /* @__PURE__ */ new Map();
    rowRecordsByIndex.set(rowIndex, row);
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      const address = asString(cellRecord?.address);
      const columnIndex = columnIndexFromAddress(address);
      maxColumn = Math.max(maxColumn, columnIndex);
      if (cellRecord) cells.set(columnIndex, cellRecord);
    }
    rowsByIndex.set(rowIndex, cells);
  }
  const columnWidthByIndex = /* @__PURE__ */ new Map();
  const columnStyleIndexByIndex = /* @__PURE__ */ new Map();
  const columns = asArray(sheet?.columns).map(asRecord).filter((column) => column != null);
  for (const column of columns) {
    const min = Math.max(1, asNumber(column.min, asNumber(column.index, 1)));
    const max = Math.max(min, asNumber(column.max, min));
    const width = spreadsheetColumnHidden(column) ? 0 : excelColumnWidthPx(asNumber(column.width, asNumber(sheet?.defaultColWidth, 10)));
    const styleIndex = spreadsheetStyleIndex(column.styleIndex);
    for (let index = min - 1; index <= max - 1; index += 1) {
      columnWidthByIndex.set(index, width);
      columnStyleIndexByIndex.set(index, styleIndex);
      maxColumn = Math.max(maxColumn, index);
    }
  }
  for (const drawing of asArray(sheet?.drawings)) {
    const drawingRecord = asRecord(drawing);
    for (const anchor of [asRecord(drawingRecord?.fromAnchor), asRecord(drawingRecord?.toAnchor)]) {
      if (!anchor) continue;
      const columnIndex = protocolNumber(anchor.colId, -1);
      const rowIndex = protocolNumber(anchor.rowId, -1);
      if (columnIndex >= 0) maxColumn = Math.max(maxColumn, columnIndex);
      if (rowIndex >= 0) maxRow = Math.max(maxRow, rowIndex + 1);
    }
  }
  if (columns.length === 0) {
    for (const [index, width] of knownSpreadsheetColumnWidths(asString(sheet?.name))) {
      columnWidthByIndex.set(index, width);
      maxColumn = Math.max(maxColumn, index);
    }
  }
  const mergeByStart = /* @__PURE__ */ new Map();
  const coveredCells = /* @__PURE__ */ new Set();
  for (const mergeRecord of asArray(sheet?.mergedCells)) {
    const mergeValue = asRecord(mergeRecord);
    const reference = asString(mergeValue?.reference) || (asString(mergeValue?.startAddress) && asString(mergeValue?.endAddress) ? `${asString(mergeValue?.startAddress)}:${asString(mergeValue?.endAddress)}` : "") || asString(mergeRecord);
    const merge = parseCellRange(reference);
    if (!merge || merge.columnSpan === 1 && merge.rowSpan === 1) continue;
    mergeByStart.set(spreadsheetCellKey(merge.startRow, merge.startColumn), merge);
    maxColumn = Math.max(maxColumn, merge.startColumn + merge.columnSpan - 1);
    for (let row = merge.startRow; row < merge.startRow + merge.rowSpan; row += 1) {
      for (let column = merge.startColumn; column < merge.startColumn + merge.columnSpan; column += 1) {
        if (row === merge.startRow && column === merge.startColumn) continue;
        coveredCells.add(spreadsheetCellKey(row, column));
      }
    }
  }
  const rowCount = clampInteger(maxRow, 1, EXCEL_MAX_ROW_COUNT);
  const columnCount = clampInteger(Math.max(maxColumn + 1, 6), 1, EXCEL_MAX_COLUMN_COUNT);
  const columnWidths = Array.from(
    { length: columnCount },
    (_, index) => columnWidthByIndex.get(index) ?? SPREADSHEET_DEFAULT_COLUMN_WIDTH
  );
  const columnStyleIndexes = Array.from(
    { length: columnCount },
    (_, index) => columnStyleIndexByIndex.get(index) ?? null
  );
  const rowHeights = Array.from({ length: rowCount }, (_, index) => {
    const row = rowRecordsByIndex.get(index + 1);
    return spreadsheetRowHidden(row) ? 0 : excelRowHeightPx(asNumber(row?.height));
  });
  applySpreadsheetSizeOverrides(columnWidths, overrides.columnWidths);
  applySpreadsheetSizeOverrides(rowHeights, overrides.rowHeights);
  const columnOffsets = prefixSums(SPREADSHEET_ROW_HEADER_WIDTH, columnWidths);
  const rowOffsets = prefixSums(SPREADSHEET_COLUMN_HEADER_HEIGHT, rowHeights);
  const freezePanes = clampSpreadsheetFreezePanes(readSpreadsheetFreezePanes(sheet), columnCount, rowCount);
  return {
    columnCount,
    columnOffsets,
    columnStyleIndexes,
    columnWidths,
    coveredCells,
    freezePanes,
    gridHeight: rowOffsets[rowOffsets.length - 1] ?? SPREADSHEET_COLUMN_HEADER_HEIGHT,
    gridWidth: columnOffsets[columnOffsets.length - 1] ?? SPREADSHEET_ROW_HEADER_WIDTH,
    maxColumn,
    mergeByStart,
    rowCount,
    rowHeights,
    rowOffsets,
    rowRecordsByIndex,
    rows,
    rowsByIndex
  };
}
function applySpreadsheetSizeOverrides(sizes, overrides) {
  if (!overrides) return;
  for (const [rawIndex, rawSize] of Object.entries(overrides)) {
    const index = Number(rawIndex);
    const size = typeof rawSize === "number" ? rawSize : Number.NaN;
    if (!Number.isInteger(index) || index < 0 || index >= sizes.length || !Number.isFinite(size)) continue;
    sizes[index] = Math.max(0, size);
  }
}
function spreadsheetCellKey(rowIndex, columnIndex) {
  return `${rowIndex}:${columnIndex}`;
}
function spreadsheetColumnLeft(layout, columnIndex) {
  return layout.columnOffsets[columnIndex] ?? layout.gridWidth;
}
function spreadsheetRowTop(layout, zeroBasedRowIndex) {
  return layout.rowOffsets[zeroBasedRowIndex] ?? layout.gridHeight;
}
function spreadsheetFrozenBodyWidth(layout) {
  return layout.columnOffsets[layout.freezePanes.columnCount] != null ? (layout.columnOffsets[layout.freezePanes.columnCount] ?? SPREADSHEET_ROW_HEADER_WIDTH) - SPREADSHEET_ROW_HEADER_WIDTH : 0;
}
function spreadsheetFrozenBodyHeight(layout) {
  return layout.rowOffsets[layout.freezePanes.rowCount] != null ? (layout.rowOffsets[layout.freezePanes.rowCount] ?? SPREADSHEET_COLUMN_HEADER_HEIGHT) - SPREADSHEET_COLUMN_HEADER_HEIGHT : 0;
}
function spreadsheetViewportPointToWorld(layout, point, scroll) {
  const frozenRight = SPREADSHEET_ROW_HEADER_WIDTH + spreadsheetFrozenBodyWidth(layout);
  const frozenBottom = SPREADSHEET_COLUMN_HEADER_HEIGHT + spreadsheetFrozenBodyHeight(layout);
  return {
    x: point.x < frozenRight ? point.x : point.x + scroll.left,
    y: point.y < frozenBottom ? point.y : point.y + scroll.top
  };
}
function spreadsheetHitCellAtViewportPoint(layout, point, scroll) {
  const world = spreadsheetViewportPointToWorld(layout, point, scroll);
  if (world.x < SPREADSHEET_ROW_HEADER_WIDTH || world.y < SPREADSHEET_COLUMN_HEADER_HEIGHT) {
    return null;
  }
  const columnIndex = offsetIndexAt(layout.columnOffsets, world.x);
  const rowOffset = offsetIndexAt(layout.rowOffsets, world.y);
  if (columnIndex < 0 || rowOffset < 0 || columnIndex >= layout.columnCount || rowOffset >= layout.rowCount) {
    return null;
  }
  return {
    columnIndex,
    rowIndex: rowOffset + 1,
    rowOffset
  };
}
function spreadsheetVisibleCellRange(layout, viewport2, scroll, overscan = 2) {
  if (layout.columnCount <= 0 || layout.rowCount <= 0 || viewport2.width <= 0 || viewport2.height <= 0) {
    const padding2 = Math.max(0, Math.trunc(overscan));
    return {
      endColumnIndex: Math.min(Math.max(0, layout.columnCount - 1), 20 + padding2),
      endRowOffset: Math.min(Math.max(0, layout.rowCount - 1), 50 + padding2),
      startColumnIndex: 0,
      startRowOffset: 0
    };
  }
  const startX = Math.max(SPREADSHEET_ROW_HEADER_WIDTH, scroll.left);
  const endX = Math.min(layout.gridWidth - 1e-3, Math.max(startX, scroll.left + viewport2.width));
  const startY = Math.max(SPREADSHEET_COLUMN_HEADER_HEIGHT, scroll.top);
  const endY = Math.min(layout.gridHeight - 1e-3, Math.max(startY, scroll.top + viewport2.height));
  const startColumnIndex = offsetIndexAt(layout.columnOffsets, startX);
  const endColumnIndex = offsetIndexAt(layout.columnOffsets, endX);
  const startRowOffset = offsetIndexAt(layout.rowOffsets, startY);
  const endRowOffset = offsetIndexAt(layout.rowOffsets, endY);
  const padding = Math.max(0, Math.trunc(overscan));
  return {
    endColumnIndex: clampInteger(
      (endColumnIndex < 0 ? layout.columnCount - 1 : endColumnIndex) + padding,
      0,
      layout.columnCount - 1
    ),
    endRowOffset: clampInteger(
      (endRowOffset < 0 ? layout.rowCount - 1 : endRowOffset) + padding,
      0,
      layout.rowCount - 1
    ),
    startColumnIndex: clampInteger(
      (startColumnIndex < 0 ? 0 : startColumnIndex) - padding,
      0,
      layout.columnCount - 1
    ),
    startRowOffset: clampInteger(
      (startRowOffset < 0 ? 0 : startRowOffset) - padding,
      0,
      layout.rowCount - 1
    )
  };
}
function spreadsheetDrawingBounds(layout, drawing) {
  const fromAnchor = asRecord(drawing.fromAnchor);
  const toAnchor = asRecord(drawing.toAnchor);
  const fromCol = protocolNumber(fromAnchor?.colId, 0);
  const fromRow = protocolNumber(fromAnchor?.rowId, 0);
  const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(fromAnchor?.colOffset);
  const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(fromAnchor?.rowOffset);
  const bbox = asRecord(asRecord(drawing.shape)?.bbox);
  const width = firstPositiveDimension(
    spreadsheetEmuToPx(drawing.extentCx),
    spreadsheetAnchorEdgePx(toAnchor, "column", layout) - left,
    spreadsheetEmuToPx(bbox?.widthEmu)
  );
  const height = firstPositiveDimension(
    spreadsheetEmuToPx(drawing.extentCy),
    spreadsheetAnchorEdgePx(toAnchor, "row", layout) - top,
    spreadsheetEmuToPx(bbox?.heightEmu)
  );
  return {
    height: Math.max(24, height),
    left,
    top,
    width: Math.max(24, width)
  };
}
function spreadsheetViewportRectSegments(layout, rect, scroll) {
  const xSegments = spreadsheetAxisViewportSegments(
    rect.left,
    rect.width,
    SPREADSHEET_ROW_HEADER_WIDTH,
    spreadsheetFrozenBodyWidth(layout),
    scroll.left
  );
  const ySegments = spreadsheetAxisViewportSegments(
    rect.top,
    rect.height,
    SPREADSHEET_COLUMN_HEADER_HEIGHT,
    spreadsheetFrozenBodyHeight(layout),
    scroll.top
  );
  const segments = [];
  for (const xSegment of xSegments) {
    for (const ySegment of ySegments) {
      if (!xSegment.frozen && !ySegment.frozen) continue;
      segments.push({
        height: ySegment.size,
        left: xSegment.start,
        top: ySegment.start,
        width: xSegment.size
      });
    }
  }
  return segments;
}
function spreadsheetEmuToPx(value) {
  const numericValue = typeof value === "string" ? Number(value) : asNumber(value, 0);
  return Number.isFinite(numericValue) ? numericValue / SPREADSHEET_EMU_PER_PIXEL : 0;
}
function spreadsheetAnchorEdgePx(anchor, axis, layout) {
  if (!anchor) return 0;
  if (axis === "column") {
    return spreadsheetColumnLeft(layout, protocolNumber(anchor.colId, layout.columnCount)) + spreadsheetEmuToPx(anchor.colOffset);
  }
  return spreadsheetRowTop(layout, protocolNumber(anchor.rowId, layout.rowCount)) + spreadsheetEmuToPx(anchor.rowOffset);
}
function firstPositiveDimension(...values) {
  return values.find((value) => Number.isFinite(value) && value > 0) ?? 0;
}
function prefixSums(initial, sizes) {
  const offsets = [initial];
  for (const size of sizes) {
    offsets.push((offsets[offsets.length - 1] ?? initial) + size);
  }
  return offsets;
}
function excelColumnWidthPx(width) {
  if (!Number.isFinite(width) || width <= 0) return SPREADSHEET_DEFAULT_COLUMN_WIDTH;
  return Math.max(32, Math.min(560, Math.floor(width * 7 + 5)));
}
function excelRowHeightPx(heightPoints) {
  return heightPoints && heightPoints > 0 ? Math.max(18, Math.round(heightPoints * EXCEL_POINTS_TO_PX)) : SPREADSHEET_DEFAULT_ROW_HEIGHT;
}
function spreadsheetColumnHidden(column) {
  return column.hidden === true || asString(column.hidden).toLowerCase() === "true" || asNumber(column.hidden) === 1;
}
function spreadsheetRowHidden(row) {
  return row?.hidden === true || asString(row?.hidden).toLowerCase() === "true" || asNumber(row?.hidden) === 1;
}
function spreadsheetStyleIndex(value) {
  if (value == null) return null;
  const index = asNumber(value, -1);
  return index >= 0 ? index : null;
}
function protocolNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
function readSpreadsheetFreezePanes(sheet) {
  const freeze = asRecord(sheet?.freezePanes) ?? asRecord(sheet?.freezePane) ?? asRecord(asRecord(sheet?.viewport)?.freezePanes);
  return {
    columnCount: Math.trunc(protocolNumber(
      freeze?.columnCount ?? freeze?.columns ?? freeze?.colCount ?? freeze?.xSplit,
      0
    )),
    rowCount: Math.trunc(protocolNumber(
      freeze?.rowCount ?? freeze?.rows ?? freeze?.ySplit,
      0
    ))
  };
}
function clampSpreadsheetFreezePanes(freezePanes, columnCount, rowCount) {
  return {
    columnCount: clampInteger(freezePanes.columnCount, 0, Math.max(0, columnCount - 1)),
    rowCount: clampInteger(freezePanes.rowCount, 0, Math.max(0, rowCount - 1))
  };
}
function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function spreadsheetAxisViewportSegments(start, size, headerSize, frozenBodySize, scroll) {
  if (size <= 0) return [];
  const end = start + size;
  const frozenEnd = headerSize + Math.max(0, frozenBodySize);
  const segments = [];
  const frozenSegmentEnd = Math.min(end, frozenEnd);
  if (frozenSegmentEnd > start) {
    segments.push({
      frozen: true,
      size: frozenSegmentEnd - start,
      start
    });
  }
  const scrollStart = Math.max(start, frozenEnd);
  if (end > scrollStart) {
    const projectedStart = scrollStart - scroll;
    const projectedEnd = end - scroll;
    const clippedStart = Math.max(projectedStart, frozenEnd);
    if (projectedEnd > clippedStart) {
      segments.push({
        frozen: false,
        size: projectedEnd - clippedStart,
        start: clippedStart
      });
    }
  }
  return segments;
}
function offsetIndexAt(offsets, value) {
  if (offsets.length < 2 || value < (offsets[0] ?? 0) || value >= (offsets[offsets.length - 1] ?? 0)) {
    return -1;
  }
  let low = 0;
  let high = offsets.length - 2;
  while (low <= high) {
    const index = Math.floor((low + high) / 2);
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? start;
    if (value < start) {
      high = index - 1;
    } else if (value >= end) {
      low = index + 1;
    } else {
      return index;
    }
  }
  return -1;
}
function knownSpreadsheetColumnWidths(sheetName) {
  const widths = /* @__PURE__ */ new Map();
  if (sheetName === "03_TimeSeries") {
    [108, 100, 116, 108, 108, 118, 118, 118, 118, 118, 126, 460].forEach((width, index) => {
      widths.set(index, width);
    });
  }
  if (sheetName === "04_Heatmap") {
    [190, 118, 118, 118, 118, 118, 118, 118, 118, 120, 108, 108, 132, 320].forEach((width, index) => {
      widths.set(index, width);
    });
  }
  return widths;
}

// src/spreadsheet/spreadsheet-cell-overlays.tsx
import { Fragment as Fragment4, jsx as jsx8, jsxs as jsxs6 } from "react/jsx-runtime";
var MAX_VALIDATION_VISUAL_CACHE_SIZE = 5e3;
function buildSpreadsheetSparklineVisuals(sheet) {
  const visuals = /* @__PURE__ */ new Map();
  const rows = rowsByIndexForSheet2(sheet);
  const groupRoot = asRecord(sheet?.sparklineGroups);
  const groups = (groupRoot ? asArray(groupRoot.groups) : asArray(sheet?.sparklineGroups)).map(asRecord).filter((group) => group != null);
  for (const group of groups) {
    const sparklines = asArray(group.sparklines).map(asRecord).filter((sparkline) => sparkline != null);
    for (const sparkline of sparklines) {
      const targetRange = parseCellRange(asString(sparkline.reference));
      if (!targetRange) continue;
      const values = sparklineValues(rows, asString(sparkline.formula) || asString(group.formula));
      if (values.length === 0) continue;
      visuals.set(spreadsheetCellKey(targetRange.startRow, targetRange.startColumn), {
        color: protocolColorToCss(group.seriesColor) ?? "#1f6f8b",
        lineWeight: Math.max(1, asNumber(group.lineWeight, 1.25)),
        markers: group.markers === true,
        type: spreadsheetSparklineType(group.type),
        values
      });
    }
  }
  return visuals;
}
function buildSpreadsheetCommentVisuals(root, sheet) {
  const sheetName = asString(sheet?.name);
  const comments = /* @__PURE__ */ new Set();
  for (const item of [...asArray(root?.notes), ...asArray(root?.threads)]) {
    const record = asRecord(item);
    if (!record) continue;
    const target = spreadsheetCommentTarget(record);
    if (!target.address || target.sheetName && sheetName && target.sheetName !== sheetName) continue;
    comments.add(spreadsheetCellKey(rowIndexFromAddress(target.address), columnIndexFromAddress(target.address)));
  }
  return comments;
}
function buildSpreadsheetValidationVisuals(sheet) {
  const specs = [];
  for (const validation of spreadsheetDataValidationItems(sheet)) {
    const ranges = spreadsheetDataValidationReferences(validation).map(parseCellRange).filter((range) => range != null);
    if (ranges.length === 0) continue;
    const typeCode = asNumber(validation.type, 0);
    const isDropdown = typeCode === 4 && validation.showDropDown !== true;
    specs.push({
      formula: asString(validation.formula1),
      prompt: asString(validation.prompt) || asString(validation.promptTitle),
      ranges,
      type: isDropdown ? "dropdown" : "validation"
    });
  }
  const cache = /* @__PURE__ */ new Map();
  return {
    get(key) {
      if (cache.has(key)) return cache.get(key) ?? void 0;
      const visual = spreadsheetValidationVisualAt(specs, key);
      if (cache.size >= MAX_VALIDATION_VISUAL_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        if (firstKey != null) cache.delete(firstKey);
      }
      cache.set(key, visual ?? null);
      return visual;
    }
  };
}
function spreadsheetValidationVisualAt(specs, key) {
  const [rowValue, columnValue] = key.split(":");
  const rowIndex = Number(rowValue);
  const columnIndex = Number(columnValue);
  if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) return void 0;
  for (const spec of specs) {
    if (!spec.ranges.some((range) => cellRangeContains2(range, rowIndex, columnIndex))) continue;
    return {
      formula: spec.formula,
      prompt: spec.prompt,
      type: spec.type
    };
  }
  return void 0;
}
function cellRangeContains2(range, rowIndex, columnIndex) {
  return rowIndex >= range.startRow && rowIndex < range.startRow + range.rowSpan && columnIndex >= range.startColumn && columnIndex < range.startColumn + range.columnSpan;
}
function SpreadsheetCellContent({
  filterActive,
  hasComment,
  onFilterClick,
  sparkline,
  text,
  validation,
  visual
}) {
  return /* @__PURE__ */ jsxs6(Fragment4, { children: [
    sparkline ? /* @__PURE__ */ jsx8(SpreadsheetSparkline, { visual: sparkline }) : null,
    hasComment ? /* @__PURE__ */ jsx8(SpreadsheetCommentIndicator, {}) : null,
    visual?.dataBar ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
      /* @__PURE__ */ jsx8(
        "span",
        {
          "aria-hidden": "true",
          style: {
            background: visual.dataBar.gradient ? `linear-gradient(${visual.dataBar.direction === "rightToLeft" ? 270 : 90}deg, ${visual.dataBar.color} 0%, ${visual.dataBar.color} 72%, rgba(255,255,255,0) 100%)` : visual.dataBar.color,
            border: visual.dataBar.border ? `1px solid ${visual.dataBar.borderColor ?? visual.dataBar.color}` : void 0,
            bottom: 1,
            left: `${visual.dataBar.startPercent}%`,
            opacity: 0.75,
            position: "absolute",
            top: 1,
            width: `${visual.dataBar.widthPercent}%`,
            zIndex: 0
          }
        }
      ),
      visual.dataBar.axisPercent === void 0 ? null : /* @__PURE__ */ jsx8(
        "span",
        {
          "aria-hidden": "true",
          style: {
            background: visual.dataBar.axisColor ?? "rgba(31, 41, 55, 0.45)",
            bottom: 1,
            left: `${visual.dataBar.axisPercent}%`,
            position: "absolute",
            top: 1,
            width: 1,
            zIndex: 1
          }
        }
      )
    ] }) : null,
    visual?.iconSet ? /* @__PURE__ */ jsx8(SpreadsheetIconSet, { visual: visual.iconSet }) : null,
    sparkline || visual?.iconSet?.showValue === false || visual?.dataBar?.showValue === false ? null : /* @__PURE__ */ jsx8("span", { style: { position: "relative", zIndex: 1 }, children: text }),
    validation ? /* @__PURE__ */ jsx8(SpreadsheetValidationIndicator, { validation }) : null,
    visual?.filter ? /* @__PURE__ */ jsx8(
      "button",
      {
        "aria-label": "Open column filter",
        "data-filter-active": filterActive ? "true" : void 0,
        onPointerDown: (event) => {
          if (!onFilterClick) return;
          event.preventDefault();
          event.stopPropagation();
          onFilterClick(event);
        },
        style: {
          alignItems: "center",
          background: filterActive ? "#dbeafe" : "#ffffff",
          borderColor: filterActive ? "#2563eb" : "#cbd5e1",
          borderRadius: 3,
          borderStyle: "solid",
          borderWidth: 1,
          color: filterActive ? "#1d4ed8" : "#64748b",
          cursor: onFilterClick ? "pointer" : "default",
          display: "inline-flex",
          fontSize: 9,
          height: 14,
          justifyContent: "center",
          lineHeight: 1,
          marginLeft: 6,
          padding: 0,
          position: "relative",
          top: -1,
          verticalAlign: "middle",
          width: 14,
          zIndex: 1
        },
        children: "\u25BE"
      }
    ) : null
  ] });
}
function rowsByIndexForSheet2(sheet) {
  const rowMap = /* @__PURE__ */ new Map();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row) => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = /* @__PURE__ */ new Map();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      cells.set(columnIndexFromAddress(asString(cellRecord.address)), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}
function sparklineValues(rows, reference) {
  const range = parseCellRange(reference);
  if (!range) return [];
  const values = [];
  for (let rowIndex = range.startRow; rowIndex < range.startRow + range.rowSpan; rowIndex += 1) {
    const row = rows.get(rowIndex);
    if (!row) continue;
    for (let columnIndex = range.startColumn; columnIndex < range.startColumn + range.columnSpan; columnIndex += 1) {
      const text = cellText(row.get(columnIndex)).trim();
      if (text.length === 0) continue;
      const value = Number(text);
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}
function spreadsheetSparklineType(value) {
  const raw = asNumber(value, 1);
  if (raw === 2) return "column";
  if (raw === 3) return "stacked";
  return "line";
}
function spreadsheetCommentTarget(record) {
  const target = asRecord(record.target);
  const cell = asRecord(target?.cell) ?? asRecord(target?.cellTarget) ?? asRecord(record.cell);
  return {
    address: asString(record.address) || asString(record.reference) || asString(target?.address) || asString(cell?.address),
    sheetName: asString(record.sheetName) || asString(target?.sheetName) || asString(cell?.sheetName)
  };
}
function spreadsheetDataValidationItems(sheet) {
  const dataValidations = asRecord(sheet?.dataValidations);
  const rawItems = dataValidations ? asArray(dataValidations.items) : asArray(sheet?.dataValidations);
  return rawItems.map(asRecord).filter((validation) => validation != null);
}
function spreadsheetDataValidationReferences(validation) {
  const ranges = asArray(validation.ranges);
  if (ranges.length > 0) {
    return ranges.map((range) => {
      if (typeof range === "string") return range;
      const record = asRecord(range);
      if (!record) return "";
      const startAddress = asString(record.startAddress);
      const endAddress = asString(record.endAddress);
      return startAddress && endAddress && startAddress !== endAddress ? `${startAddress}:${endAddress}` : startAddress;
    }).filter(Boolean);
  }
  return asString(validation.range || validation.reference || validation.sqref).split(/\s+/).filter(Boolean);
}
function SpreadsheetValidationIndicator({ validation }) {
  return /* @__PURE__ */ jsx8(
    "span",
    {
      "aria-hidden": "true",
      style: {
        alignItems: "center",
        background: validation.type === "dropdown" ? "#f8fafc" : "#ffffff",
        borderColor: "#cbd5e1",
        borderRadius: 3,
        borderStyle: "solid",
        borderWidth: 1,
        bottom: 4,
        color: "#475569",
        display: "inline-flex",
        fontSize: 9,
        height: 14,
        justifyContent: "center",
        lineHeight: 1,
        position: "absolute",
        right: 4,
        width: 14,
        zIndex: 2
      },
      title: validation.prompt || validation.formula,
      children: validation.type === "dropdown" ? "\u25BE" : "!"
    }
  );
}
function SpreadsheetCommentIndicator() {
  return /* @__PURE__ */ jsx8(
    "span",
    {
      "aria-hidden": "true",
      style: {
        borderLeftColor: "transparent",
        borderLeftStyle: "solid",
        borderLeftWidth: 8,
        borderTopColor: "#f97316",
        borderTopStyle: "solid",
        borderTopWidth: 8,
        height: 0,
        position: "absolute",
        right: 0,
        top: 0,
        width: 0,
        zIndex: 3
      }
    }
  );
}
function SpreadsheetSparkline({ visual }) {
  const width = 100;
  const height = 28;
  const values = visual.values;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = Math.max(1, max - min);
  const xForIndex = (index) => 4 + index / Math.max(1, values.length - 1) * (width - 8);
  const yForValue = (value) => height - 4 - (value - min) / span * (height - 8);
  const points = values.map((value, index) => `${xForIndex(index)},${yForValue(value)}`).join(" ");
  return /* @__PURE__ */ jsx8(
    "svg",
    {
      "aria-hidden": "true",
      preserveAspectRatio: "none",
      style: { inset: "3px 5px", pointerEvents: "none", position: "absolute", zIndex: 1 },
      viewBox: `0 0 ${width} ${height}`,
      children: visual.type === "line" ? /* @__PURE__ */ jsxs6(Fragment4, { children: [
        /* @__PURE__ */ jsx8("polyline", { fill: "none", points, stroke: visual.color, strokeLinejoin: "round", strokeWidth: visual.lineWeight }),
        visual.markers ? values.map((value, index) => /* @__PURE__ */ jsx8("circle", { cx: xForIndex(index), cy: yForValue(value), fill: visual.color, r: "1.8" }, index)) : null
      ] }) : values.map((value, index) => {
        const barWidth = Math.max(2, (width - 8) / Math.max(1, values.length) * 0.55);
        const x = xForIndex(index) - barWidth / 2;
        const zeroY = yForValue(0);
        const valueY = yForValue(visual.type === "stacked" ? Math.abs(value) : value);
        return /* @__PURE__ */ jsx8(
          "rect",
          {
            fill: visual.color,
            height: Math.max(1, Math.abs(zeroY - valueY)),
            width: barWidth,
            x,
            y: Math.min(zeroY, valueY)
          },
          index
        );
      })
    }
  );
}
function SpreadsheetIconSet({ visual }) {
  const shape = spreadsheetIconSetShape(visual);
  if (shape === "arrow") {
    const rotation = spreadsheetIconSetArrowRotation(visual);
    return /* @__PURE__ */ jsx8(
      "svg",
      {
        "aria-hidden": "true",
        "data-testid": "spreadsheet-icon-set",
        viewBox: "0 0 18 18",
        style: {
          display: "inline-block",
          height: 16,
          marginRight: visual.showValue ? 5 : 0,
          position: "relative",
          top: 1,
          width: 18,
          zIndex: 1
        },
        children: /* @__PURE__ */ jsx8(
          "path",
          {
            d: "M9 2 L15 8 H11 V16 H7 V8 H3 Z",
            fill: visual.color,
            transform: `rotate(${rotation} 9 9)`
          }
        )
      }
    );
  }
  if (shape === "quarter") {
    return /* @__PURE__ */ jsxs6(
      "svg",
      {
        "aria-hidden": "true",
        "data-testid": "spreadsheet-icon-set",
        viewBox: "0 0 18 18",
        style: {
          display: "inline-block",
          height: 16,
          marginRight: visual.showValue ? 5 : 0,
          position: "relative",
          top: 1,
          width: 18,
          zIndex: 1
        },
        children: [
          /* @__PURE__ */ jsx8("circle", { cx: "9", cy: "9", fill: "#f8fafc", r: "6.5", stroke: "#94a3b8", strokeWidth: "1.5" }),
          /* @__PURE__ */ jsx8("path", { d: spreadsheetIconSetQuarterPath(visual), fill: visual.color })
        ]
      }
    );
  }
  if (shape === "traffic") {
    return /* @__PURE__ */ jsx8(
      "svg",
      {
        "aria-hidden": "true",
        "data-testid": "spreadsheet-icon-set",
        viewBox: "0 0 18 18",
        style: {
          display: "inline-block",
          height: 16,
          marginRight: visual.showValue ? 5 : 0,
          position: "relative",
          top: 1,
          width: 18,
          zIndex: 1
        },
        children: /* @__PURE__ */ jsx8("circle", { cx: "9", cy: "9", fill: visual.color, r: "6.5", stroke: "rgba(15, 23, 42, 0.28)", strokeWidth: "1" })
      }
    );
  }
  return /* @__PURE__ */ jsx8(
    "svg",
    {
      "aria-hidden": "true",
      "data-testid": "spreadsheet-icon-set",
      viewBox: "0 0 18 18",
      style: {
        display: "inline-block",
        height: 16,
        marginRight: visual.showValue ? 5 : 0,
        position: "relative",
        top: 2,
        width: 18,
        zIndex: 1
      },
      children: Array.from({ length: 5 }, (_, index) => {
        const height = 3 + index * 2;
        const active = index < visual.level;
        return /* @__PURE__ */ jsx8(
          "rect",
          {
            fill: active ? visual.color : "#c7cdd4",
            height,
            opacity: active ? 1 : 0.55,
            rx: "0.6",
            stroke: active ? "rgba(15, 23, 42, 0.22)" : "#9ca3af",
            strokeWidth: "0.45",
            width: "2.2",
            x: 3 + index * 2.4,
            y: 15 - height
          },
          index
        );
      })
    }
  );
}
function spreadsheetIconSetShape(visual) {
  const iconSet = visual.iconSet.toLowerCase();
  if (iconSet.includes("rating")) {
    return "rating";
  }
  if (iconSet.includes("quarter")) {
    return "quarter";
  }
  if (iconSet.includes("arrow")) {
    return "arrow";
  }
  if (iconSet.includes("traffic") || iconSet.includes("symbol") || iconSet.includes("sign")) {
    return "traffic";
  }
  return "rating";
}
function spreadsheetIconSetArrowRotation(visual) {
  const zeroBasedLevel = Math.max(0, Math.min(visual.levelCount - 1, visual.level - 1));
  const rotations = visual.levelCount >= 5 ? [180, 135, 90, 45, 0] : [180, 90, 0];
  return rotations[Math.min(rotations.length - 1, zeroBasedLevel)] ?? 90;
}
function spreadsheetIconSetQuarterPath(visual) {
  const zeroBasedLevel = Math.max(0, Math.min(4, visual.level - 1));
  if (zeroBasedLevel <= 0) return "";
  if (zeroBasedLevel === 1) return "M9 9 L9 2.5 A6.5 6.5 0 0 1 15.5 9 Z";
  if (zeroBasedLevel === 2) return "M9 9 L9 2.5 A6.5 6.5 0 0 1 9 15.5 Z";
  if (zeroBasedLevel === 3) return "M9 9 L9 2.5 A6.5 6.5 0 1 1 2.5 9 Z";
  return "M9 2.5 A6.5 6.5 0 1 1 9 15.5 A6.5 6.5 0 1 1 9 2.5 Z";
}

// src/spreadsheet/spreadsheet-data-access.ts
var DEFAULT_SPREADSHEET_FONT_FAMILY = "Aptos, Calibri, Arial, Helvetica, sans-serif";
function rowsByIndexForSheet3(sheet) {
  const rowMap = /* @__PURE__ */ new Map();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row) => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = /* @__PURE__ */ new Map();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      const address = asString(cellRecord.address);
      cells.set(columnIndexFromAddress(address), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}
function cellAt2(sheet, rowIndex, columnIndex) {
  return rowsByIndexForSheet3(sheet).get(rowIndex)?.get(columnIndex) ?? null;
}
function defaultSpreadsheetSheetIndex(sheets) {
  if (sheets.length <= 1) return 0;
  const readmeFirst = /^00[_ -]?readme$/i.test(asString(sheets[0]?.name));
  return readmeFirst ? 1 : 0;
}
function spreadsheetSheetTabColor(sheet) {
  return colorToCss(asRecord(sheet?.tabColor) ?? sheet?.tabColor);
}
function spreadsheetFontFamily(typeface) {
  const normalized = typeface.trim();
  if (!normalized) return DEFAULT_SPREADSHEET_FONT_FAMILY;
  const escaped = normalized.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}", ${DEFAULT_SPREADSHEET_FONT_FAMILY}`;
}

// src/spreadsheet/spreadsheet-cell-styles.ts
var sheetCellStyle = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#e2e8f0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#0f172a",
  fontFamily: spreadsheetFontFamily(""),
  lineHeight: 1.35,
  overflow: "hidden",
  overflowWrap: "break-word",
  padding: "7px 9px",
  verticalAlign: "top",
  whiteSpace: "pre-wrap"
};
function spreadsheetCellStyle(cell, styles, visual, sheetName, styleIndex, showGridLines = true) {
  const cellFormat = styleAt(styles?.cellXfs, styleIndex ?? cell?.styleIndex);
  const font = styleAt(styles?.fonts, cellFormat?.fontId);
  const fill = styleAt(styles?.fills, cellFormat?.fillId);
  const border = styleAt(styles?.borders, cellFormat?.borderId);
  const alignment = asRecord(cellFormat?.alignment);
  const fontFill = resolveStyleRecord(font, ["fill", "color"]);
  const fillColor = spreadsheetFillToCss(fill);
  const fontColor = colorToCss(fontFill?.color ?? fontFill);
  const hyperlinkFormula = /^=?\s*HYPERLINK\s*\(/i.test(asString(cell?.formula));
  const gridLineColor = showGridLines ? "#e2e8f0" : "transparent";
  const bottomBorder = spreadsheetBorderCss(border, "bottom", gridLineColor);
  const rightBorder = spreadsheetBorderCss(border, "right", gridLineColor);
  const fallbackStyle = knownSpreadsheetCellStyle(cell, sheetName);
  const horizontalAlignment = asString(alignment?.horizontal) || asString(cellFormat?.horizontalAlignment);
  const verticalAlignment = asString(alignment?.vertical) || asString(cellFormat?.verticalAlignment);
  const wrapText = spreadsheetBool(alignment?.wrapText ?? cellFormat?.wrapText, true);
  const shrinkToFit = spreadsheetBool(alignment?.shrinkToFit ?? cellFormat?.shrinkToFit, false);
  const indent = Math.max(0, asNumber(alignment?.indent ?? cellFormat?.indent, 0));
  const fontSize = font != null ? cssFontSize(font.fontSize, 13) : fallbackStyle.fontSize;
  const textDirection = !horizontalAlignment && /[\u0590-\u08ff]/u.test(cellText(cell)) ? "rtl" : void 0;
  const fallbackTextAlign = visual?.iconSet?.showValue === false ? "left" : fallbackStyle.textAlign ?? (textDirection === "rtl" ? "right" : spreadsheetDefaultTextAlign(cell));
  const justifyContent = horizontalAlignment ? spreadsheetHorizontalJustifyContent(horizontalAlignment) : spreadsheetJustifyContentForTextAlign(fallbackTextAlign);
  const visualBackground = visual?.background;
  const background = visual?.backgroundSource === "table" ? fillColor ?? visualBackground ?? fallbackStyle.background : visualBackground ?? fillColor ?? fallbackStyle.background;
  return {
    ...sheetCellStyle,
    ...fallbackStyle,
    alignItems: spreadsheetVerticalAlignItems(verticalAlignment),
    background,
    borderBottomColor: visual?.borderColor ?? bottomBorder.color,
    borderBottomStyle: bottomBorder.style,
    borderBottomWidth: bottomBorder.width,
    borderRightColor: visual?.borderColor ?? rightBorder.color,
    borderRightStyle: rightBorder.style,
    borderRightWidth: rightBorder.width,
    color: visual?.color ?? fontColor ?? (hyperlinkFormula ? "#0563c1" : fallbackStyle.color) ?? sheetCellStyle.color,
    cursor: hyperlinkFormula ? "pointer" : void 0,
    direction: textDirection,
    display: "flex",
    fontFamily: spreadsheetFontFamily(asString(font?.typeface)),
    fontSize: shrinkToFit && typeof fontSize === "number" ? Math.max(8, fontSize * 0.88) : fontSize,
    fontStyle: font?.italic === true ? "italic" : fallbackStyle.fontStyle,
    fontWeight: visual?.fontWeight ?? (font?.bold === true ? 700 : fallbackStyle.fontWeight),
    justifyContent,
    paddingLeft: indent > 0 ? 9 + indent * 12 : sheetCellStyle.paddingLeft,
    textAlign: horizontalAlignment ? spreadsheetHorizontalTextAlign(horizontalAlignment, fallbackTextAlign) : fallbackTextAlign,
    textDecorationLine: hyperlinkFormula ? "underline" : void 0,
    textOverflow: wrapText ? void 0 : "ellipsis",
    verticalAlign: spreadsheetVerticalAlign(verticalAlignment) ?? fallbackStyle.verticalAlign ?? sheetCellStyle.verticalAlign,
    whiteSpace: wrapText ? sheetCellStyle.whiteSpace : "nowrap"
  };
}
function spreadsheetBorderCss(border, side, gridLineColor) {
  const line = spreadsheetBorderLine(border, side);
  const rawStyle = asString(line?.style ?? border?.[`${side}Style`] ?? border?.[`${side}_style`]).toLowerCase();
  if (rawStyle === "none") return { color: "transparent", style: "solid", width: 1 };
  const explicitColor = spreadsheetBorderColor(line?.color) ?? spreadsheetBorderColor(border?.[`${side}Color`]) ?? spreadsheetBorderColor(border?.[`${side}_color`]) ?? spreadsheetBorderColor(border?.[`${side}BorderColor`]) ?? spreadsheetBorderColor(border?.[`${side}_border_color`]);
  return {
    color: explicitColor ?? gridLineColor,
    style: spreadsheetBorderStyle(rawStyle),
    width: spreadsheetBorderWidth(rawStyle)
  };
}
function spreadsheetBorderColor(value) {
  const structured = colorToCss(asRecord(value));
  if (structured) return structured;
  const text = asString(value);
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`;
  if (/^[0-9a-f]{8}$/i.test(text)) return `#${text.slice(2)}`;
  return null;
}
function spreadsheetBorderLine(border, side) {
  return asRecord(border?.[side]) ?? asRecord(border?.[`${side}Border`]) ?? asRecord(border?.[`${side}_border`]);
}
function spreadsheetBorderStyle(value) {
  if (value.includes("dash")) return "dashed";
  if (value.includes("dot")) return "dotted";
  if (value === "double") return "double";
  return "solid";
}
function spreadsheetBorderWidth(value) {
  if (value.includes("thick")) return 3;
  if (value.includes("medium") || value === "double") return 2;
  return 1;
}
function spreadsheetShowGridLines(sheet) {
  if (sheet?.showGridLines === false) return false;
  const value = asString(sheet?.showGridLines).toLowerCase();
  return value !== "false" && value !== "0";
}
function spreadsheetBool(value, fallback) {
  if (value === true || value === false) return value;
  const normalized = asString(value).toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}
function spreadsheetHorizontalTextAlign(value, fallback) {
  const normalized = value.toLowerCase();
  if (normalized === "center" || normalized === "centercontinuous" || normalized === "distributed") return "center";
  if (normalized === "right") return "right";
  if (normalized === "justify") return "justify";
  if (normalized === "left" || normalized === "fill") return "left";
  return fallback;
}
function spreadsheetHorizontalJustifyContent(value) {
  const normalized = value.toLowerCase();
  if (normalized === "center" || normalized === "centercontinuous" || normalized === "distributed") return "center";
  if (normalized === "right") return "flex-end";
  return "flex-start";
}
function spreadsheetJustifyContentForTextAlign(value) {
  return value === "center" ? "center" : value === "right" ? "flex-end" : "flex-start";
}
function spreadsheetDefaultTextAlign(cell) {
  const value = Number(cellText(cell).trim());
  return Number.isFinite(value) ? "right" : void 0;
}
function spreadsheetVerticalAlign(value) {
  const normalized = value.toLowerCase();
  if (normalized === "center") return "middle";
  if (normalized === "bottom") return "bottom";
  if (normalized === "top") return "top";
  return void 0;
}
function spreadsheetVerticalAlignItems(value) {
  const normalized = value.toLowerCase();
  if (normalized === "center") return "center";
  if (normalized === "bottom") return "flex-end";
  return "flex-start";
}
function spreadsheetEffectiveStyleIndex(cell, row, layout, columnIndex) {
  return spreadsheetStyleIndex2(cell?.styleIndex) ?? spreadsheetStyleIndex2(row?.styleIndex) ?? layout.columnStyleIndexes[columnIndex] ?? null;
}
function spreadsheetStyleIndex2(value) {
  if (value == null) return null;
  const index = asNumber(value, -1);
  return index >= 0 ? index : null;
}
function knownSpreadsheetCellStyle(cell, sheetName) {
  const address = asString(cell?.address);
  if (!cell || !address) return {};
  const rowIndex = rowIndexFromAddress(address);
  const columnIndex = columnIndexFromAddress(address);
  const text = cellText(cell);
  if (rowIndex === 1) {
    return {
      background: "#ecfdf5",
      color: "#14532d",
      fontSize: 18,
      fontWeight: 700,
      verticalAlign: "middle"
    };
  }
  if (rowIndex === 2) {
    return {
      color: "#64748b",
      fontStyle: "italic"
    };
  }
  if (sheetName === "01_Dashboard") {
    if (rowIndex === 4) return { background: "#e6f7ee", color: "#14633a", fontWeight: 700 };
    if (rowIndex === 17) return { background: "#dcfce7", color: "#166534", fontWeight: 700, textAlign: "center" };
    if ([6, 11].includes(rowIndex)) return { background: "#f8fafc", color: "#64748b", fontWeight: 700 };
    if (rowIndex === 11 && columnIndex >= 6) return { background: "#fff7ed", color: "#9a3412" };
  }
  if (sheetName === "03_TimeSeries") {
    if (rowIndex === 4) return { background: "#dff1fb", color: "#036796", fontWeight: 700, textAlign: "center" };
    if (rowIndex >= 5 && rowIndex <= 22) {
      if (columnIndex === 10 && text === "Warn") return { background: "#fff4c2", color: "#a3470d" };
      if (columnIndex === 10 && text === "Pass") return { color: "#0f172a" };
      return rowIndex % 2 === 1 ? { background: "#c7eaf7" } : {};
    }
  }
  if (sheetName === "04_Heatmap") {
    if (rowIndex === 4 || rowIndex === 5) {
      return { background: "#e9e4ff", color: "#5b21b6", fontWeight: 700, textAlign: "center" };
    }
  }
  return {};
}

// src/spreadsheet/spreadsheet-render-snapshot.ts
function buildSpreadsheetRenderSnapshot({
  layout,
  scroll,
  viewportSize
}) {
  const visibleRange = spreadsheetVisibleCellRange(layout, viewportSize, scroll);
  const visibleMergeStarts = visibleMergedCellStarts(layout, visibleRange);
  return {
    visibleColumnIndexes: sortedVisibleIndexes(
      visibleRange.startColumnIndex,
      visibleRange.endColumnIndex,
      visibleMergeStarts,
      "column"
    ),
    visibleMergeStarts,
    visibleRange,
    visibleRowOffsets: sortedVisibleIndexes(
      visibleRange.startRowOffset,
      visibleRange.endRowOffset,
      visibleMergeStarts,
      "row"
    )
  };
}
function visibleMergedCellStarts(layout, visibleRange) {
  const keys = /* @__PURE__ */ new Set();
  for (const [key, merge] of layout.mergeByStart) {
    const rowStart = merge.startRow - 1;
    const rowEnd = rowStart + merge.rowSpan - 1;
    const columnStart = merge.startColumn;
    const columnEnd = columnStart + merge.columnSpan - 1;
    if (rowStart <= visibleRange.endRowOffset && rowEnd >= visibleRange.startRowOffset && columnStart <= visibleRange.endColumnIndex && columnEnd >= visibleRange.startColumnIndex) {
      keys.add(key);
    }
  }
  return keys;
}
function sortedVisibleIndexes(start, end, visibleMergeStarts, axis) {
  const indexes = rangeIndexes(start, end);
  for (const key of visibleMergeStarts) {
    const [rowIndex, columnIndex] = key.split(":").map(Number);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) continue;
    indexes.add(axis === "row" ? rowIndex - 1 : columnIndex);
  }
  return [...indexes].sort((left, right) => left - right);
}
function visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange) {
  const merge = layout.mergeByStart.get(spreadsheetCellKey(rowOffset + 1, columnIndex));
  const rowStart = rowOffset;
  const rowEnd = rowOffset + (merge?.rowSpan ?? 1) - 1;
  const columnStart = columnIndex;
  const columnEnd = columnIndex + (merge?.columnSpan ?? 1) - 1;
  return rowStart <= visibleRange.endRowOffset && rowEnd >= visibleRange.startRowOffset && columnStart <= visibleRange.endColumnIndex && columnEnd >= visibleRange.startColumnIndex;
}
function rangeIndexes(start, end) {
  const indexes = /* @__PURE__ */ new Set();
  for (let index = Math.max(0, start); index <= end; index += 1) {
    indexes.add(index);
  }
  return indexes;
}

// src/spreadsheet/spreadsheet-canvas-paints.ts
function buildSpreadsheetCanvasCellPaints({
  cellEdits,
  layout,
  project,
  visibleRange
}) {
  const paints = /* @__PURE__ */ new Map();
  for (const row of layout.rows) {
    const rowIndex = asNumber(row.index, 1);
    const rowOffset = rowIndex - 1;
    if (rowOffset < visibleRange.startRowOffset || rowOffset > visibleRange.endRowOffset) continue;
    const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
    for (const cellRecord of asArray(row.cells)) {
      const cell = asRecord(cellRecord);
      const address = asString(cell?.address);
      const columnIndex = columnIndexFromAddress(address);
      if (!cell || columnIndex < 0) continue;
      if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) continue;
      const key = spreadsheetCellKey(rowIndex, columnIndex);
      const cellStyle = project.cellStyle(cell, rowRecord, columnIndex, key);
      paints.set(key, spreadsheetCanvasPaintFromStyle(
        cellStyle,
        cellEdits[key] ?? project.cellText(cell, rowRecord, columnIndex, key)
      ));
    }
  }
  for (const [key, text] of Object.entries(cellEdits)) {
    if (text == null || paints.has(key)) continue;
    const [rowIndex, columnIndex] = key.split(":").map(Number);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) continue;
    const rowOffset = rowIndex - 1;
    if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) continue;
    paints.set(key, { text });
  }
  return paints;
}
function spreadsheetCanvasPaintFromStyle(style, text) {
  return {
    borderBottom: spreadsheetCanvasBorder(style.borderBottomColor, style.borderBottomWidth),
    borderRight: spreadsheetCanvasBorder(style.borderRightColor, style.borderRightWidth),
    color: spreadsheetCanvasString(style.color),
    fill: spreadsheetCanvasString(style.background),
    fontFamily: spreadsheetCanvasString(style.fontFamily),
    fontSize: spreadsheetCanvasNumber(style.fontSize),
    fontStyle: spreadsheetCanvasFontStyle(style.fontStyle),
    fontWeight: spreadsheetCanvasFontWeight(style.fontWeight),
    paddingLeft: spreadsheetCanvasNumber(style.paddingLeft),
    text,
    textAlign: spreadsheetCanvasTextAlign(style.textAlign),
    verticalAlign: spreadsheetCanvasVerticalAlign(style.verticalAlign)
  };
}
function spreadsheetCanvasString(value) {
  const text = asString(value);
  return text ? text : void 0;
}
function spreadsheetCanvasNumber(value) {
  const numberValue = typeof value === "number" ? value : Number(asString(value));
  return Number.isFinite(numberValue) ? numberValue : void 0;
}
function spreadsheetCanvasBorder(color, width) {
  const borderColor = spreadsheetCanvasString(color);
  const borderWidth = spreadsheetCanvasCssNumber(width);
  if (!borderColor && borderWidth == null) return void 0;
  return { color: borderColor, width: borderWidth };
}
function spreadsheetCanvasCssNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = asString(value).match(/-?\d+(?:\.\d+)?/);
  if (!match) return void 0;
  const numberValue = Number(match[0]);
  return Number.isFinite(numberValue) ? numberValue : void 0;
}
function spreadsheetCanvasFontStyle(value) {
  const normalized = asString(value).toLowerCase();
  return normalized === "italic" ? "italic" : void 0;
}
function spreadsheetCanvasFontWeight(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asString(value);
  return text ? text : void 0;
}
function spreadsheetCanvasTextAlign(value) {
  const normalized = asString(value).toLowerCase();
  if (normalized === "center" || normalized === "right") return normalized;
  return normalized === "left" ? "left" : void 0;
}
function spreadsheetCanvasVerticalAlign(value) {
  const normalized = asString(value).toLowerCase();
  if (normalized === "bottom") return "bottom";
  if (normalized === "middle") return "middle";
  return normalized === "top" ? "top" : void 0;
}

// src/spreadsheet/spreadsheet-canvas-layer.tsx
import { useEffect as useEffect2, useMemo as useMemo2, useRef as useRef2 } from "react";

// src/spreadsheet/spreadsheet-canvas-commands.ts
function buildSpreadsheetCanvasCommands({
  layout,
  scroll,
  viewportSize,
  cellPaints
}) {
  const snapshot = buildSpreadsheetRenderSnapshot({ layout, scroll, viewportSize });
  const cells = [];
  for (const rowOffset of snapshot.visibleRowOffsets) {
    const rowIndex = rowOffset + 1;
    const top = spreadsheetRowTop(layout, rowOffset);
    for (const columnIndex of snapshot.visibleColumnIndexes) {
      const addressKey = spreadsheetCellKey(rowIndex, columnIndex);
      if (layout.coveredCells.has(addressKey)) continue;
      if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, snapshot.visibleRange)) continue;
      const merge = layout.mergeByStart.get(addressKey);
      const left = spreadsheetColumnLeft(layout, columnIndex);
      const paint = cellPaints?.get(addressKey);
      cells.push({
        addressKey,
        borderBottom: paint?.borderBottom,
        borderRight: paint?.borderRight,
        color: paint?.color,
        fill: paint?.fill,
        fontFamily: paint?.fontFamily,
        fontSize: paint?.fontSize,
        fontStyle: paint?.fontStyle,
        fontWeight: paint?.fontWeight,
        height: spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top,
        left,
        paddingLeft: paint?.paddingLeft,
        text: paint?.text,
        textAlign: paint?.textAlign,
        top,
        verticalAlign: paint?.verticalAlign,
        width: spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left
      });
    }
  }
  return {
    cells,
    headers: [
      ...snapshot.visibleColumnIndexes.map((columnIndex) => ({
        height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
        label: columnLabel(columnIndex),
        left: spreadsheetColumnLeft(layout, columnIndex),
        top: 0,
        type: "column",
        width: layout.columnWidths[columnIndex] ?? 0
      })),
      ...snapshot.visibleRowOffsets.map((rowOffset) => ({
        height: layout.rowHeights[rowOffset] ?? 0,
        label: String(rowOffset + 1),
        left: 0,
        top: spreadsheetRowTop(layout, rowOffset),
        type: "row",
        width: SPREADSHEET_ROW_HEADER_WIDTH
      }))
    ],
    snapshot
  };
}

// src/spreadsheet/spreadsheet-canvas-frame-scheduler.ts
function createSpreadsheetCanvasFrameScheduler({
  cancelFrame = defaultCancelFrame,
  draw,
  requestFrame = defaultRequestFrame
}) {
  let frame = null;
  let lastSignature = "";
  let pending = null;
  const flush = () => {
    frame = null;
    const plan = pending;
    pending = null;
    if (!plan) return;
    const signature = spreadsheetCanvasRenderPlanSignature(plan);
    if (signature === lastSignature) return;
    lastSignature = signature;
    draw(plan);
  };
  return {
    destroy: () => {
      pending = null;
      if (frame != null) cancelFrame(frame);
      frame = null;
    },
    flush,
    schedule: (plan) => {
      pending = plan;
      if (frame != null) return;
      let flushedSynchronously = false;
      frame = -1;
      const handle = requestFrame(() => {
        flushedSynchronously = true;
        flush();
      });
      if (!flushedSynchronously) frame = handle;
    }
  };
}
function spreadsheetCanvasRenderPlanSignature(plan) {
  const firstCell = plan.cells[0];
  const lastCell = plan.cells[plan.cells.length - 1];
  const firstColumnHeader = plan.columnHeaders[0];
  const lastColumnHeader = plan.columnHeaders[plan.columnHeaders.length - 1];
  const firstRowHeader = plan.rowHeaders[0];
  const lastRowHeader = plan.rowHeaders[plan.rowHeaders.length - 1];
  return [
    plan.bitmap.cssWidth,
    plan.bitmap.cssHeight,
    plan.bitmap.pixelWidth,
    plan.bitmap.pixelHeight,
    plan.cells.length,
    rectSignature(firstCell),
    rectSignature(lastCell),
    plan.columnHeaders.length,
    rectSignature(firstColumnHeader),
    rectSignature(lastColumnHeader),
    plan.rowHeaders.length,
    rectSignature(firstRowHeader),
    rectSignature(lastRowHeader)
  ].join("|");
}
function rectSignature(rect) {
  if (!rect) return "";
  return `${rect.left},${rect.top},${rect.width},${rect.height}`;
}
function defaultRequestFrame(callback) {
  if (typeof window === "undefined") {
    callback();
    return 0;
  }
  return window.requestAnimationFrame(callback);
}
function defaultCancelFrame(handle) {
  if (typeof window === "undefined") return;
  window.cancelAnimationFrame(handle);
}

// src/spreadsheet/spreadsheet-canvas-renderer.ts
function spreadsheetCanvasBitmapSize(viewportSize, pixelRatio) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const cssWidth = Math.max(0, Math.round(viewportSize.width));
  const cssHeight = Math.max(0, Math.round(viewportSize.height));
  return {
    cssHeight,
    cssWidth,
    pixelHeight: Math.max(1, Math.round(cssHeight * ratio)),
    pixelRatio: ratio,
    pixelWidth: Math.max(1, Math.round(cssWidth * ratio))
  };
}
function buildSpreadsheetCanvasRenderPlan({
  commands,
  pixelRatio,
  scroll,
  viewportSize
}) {
  return {
    bitmap: spreadsheetCanvasBitmapSize(viewportSize, pixelRatio),
    cells: commands.cells.map((cell) => spreadsheetCanvasCellRect(cell, scroll)),
    columnHeaders: commands.headers.filter((header) => header.type === "column").map((header) => spreadsheetCanvasHeaderRect(header, scroll)),
    corner: {
      fill: "#f1f3f4",
      height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
      left: 0,
      stroke: "#dadce0",
      text: "",
      top: 0,
      width: SPREADSHEET_ROW_HEADER_WIDTH
    },
    rowHeaders: commands.headers.filter((header) => header.type === "row").map((header) => spreadsheetCanvasHeaderRect(header, scroll))
  };
}
function drawSpreadsheetCanvasRenderPlan(context, plan) {
  const { bitmap } = plan;
  context.setTransform(bitmap.pixelRatio, 0, 0, bitmap.pixelRatio, 0, 0);
  context.clearRect(0, 0, bitmap.cssWidth, bitmap.cssHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, bitmap.cssWidth, bitmap.cssHeight);
  for (const cell of plan.cells) {
    drawSpreadsheetCanvasRect(context, cell);
  }
  for (const header of plan.columnHeaders) {
    drawSpreadsheetCanvasRect(context, header);
  }
  for (const header of plan.rowHeaders) {
    drawSpreadsheetCanvasRect(context, header);
  }
  drawSpreadsheetCanvasRect(context, plan.corner);
}
function spreadsheetCanvasCellRect(cell, scroll) {
  return {
    borderBottom: cell.borderBottom,
    borderRight: cell.borderRight,
    fill: cell.fill ?? "#ffffff",
    color: cell.color,
    fontFamily: cell.fontFamily,
    fontSize: cell.fontSize,
    fontStyle: cell.fontStyle,
    fontWeight: cell.fontWeight,
    height: cell.height,
    left: cell.left - scroll.left,
    paddingLeft: cell.paddingLeft,
    stroke: "#e2e8f0",
    text: void 0,
    textAlign: cell.textAlign,
    top: cell.top - scroll.top,
    verticalAlign: cell.verticalAlign,
    width: cell.width
  };
}
function spreadsheetCanvasHeaderRect(header, scroll) {
  return {
    fill: "#f1f3f4",
    height: header.height,
    left: header.type === "column" ? header.left - scroll.left : 0,
    stroke: "#dadce0",
    text: void 0,
    top: header.type === "row" ? header.top - scroll.top : 0,
    width: header.width
  };
}
function drawSpreadsheetCanvasRect(context, rect) {
  if (rect.width <= 0 || rect.height <= 0) return;
  context.fillStyle = rect.fill ?? "#ffffff";
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  drawSpreadsheetCanvasBorders(context, rect);
  if (!rect.text) return;
  context.fillStyle = rect.color ?? "#3c4043";
  context.font = spreadsheetCanvasFont(rect);
  const textAlign = rect.textAlign ?? "left";
  context.textAlign = textAlign;
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(rect.left + 3, rect.top + 1, Math.max(0, rect.width - 6), Math.max(0, rect.height - 2));
  context.clip();
  context.fillText(rect.text, spreadsheetCanvasTextX(rect, textAlign), spreadsheetCanvasTextY(rect));
  context.restore();
}
function drawSpreadsheetCanvasBorders(context, rect) {
  if (!rect.borderBottom && !rect.borderRight) {
    context.strokeStyle = rect.stroke ?? "#e2e8f0";
    context.lineWidth = 1;
    context.strokeRect(rect.left + 0.5, rect.top + 0.5, Math.max(0, rect.width - 1), Math.max(0, rect.height - 1));
    return;
  }
  drawSpreadsheetCanvasLine(context, {
    border: rect.borderRight,
    fallbackColor: rect.stroke,
    x1: rect.left + rect.width - 0.5,
    x2: rect.left + rect.width - 0.5,
    y1: rect.top,
    y2: rect.top + rect.height
  });
  drawSpreadsheetCanvasLine(context, {
    border: rect.borderBottom,
    fallbackColor: rect.stroke,
    x1: rect.left,
    x2: rect.left + rect.width,
    y1: rect.top + rect.height - 0.5,
    y2: rect.top + rect.height - 0.5
  });
}
function drawSpreadsheetCanvasLine(context, {
  border,
  fallbackColor,
  x1,
  x2,
  y1,
  y2
}) {
  const color = border?.color ?? fallbackColor ?? "#e2e8f0";
  if (color === "transparent") return;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, border?.width ?? 1);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}
function spreadsheetCanvasFont(rect) {
  const weight = rect.fontWeight ?? 500;
  const style = rect.fontStyle === "italic" ? "italic " : "";
  const size = Math.max(8, Math.min(32, rect.fontSize ?? 13));
  return `${style}${weight} ${size}px ${rect.fontFamily || "Aptos, Calibri, Arial, Helvetica, sans-serif"}`;
}
function spreadsheetCanvasTextX(rect, textAlign) {
  if (textAlign === "right") return rect.left + Math.max(0, rect.width - 8);
  if (textAlign === "center") return rect.left + rect.width / 2;
  return rect.left + (rect.paddingLeft ?? 8);
}
function spreadsheetCanvasTextY(rect) {
  if (rect.verticalAlign === "top") return rect.top + 8;
  if (rect.verticalAlign === "bottom") return rect.top + Math.max(8, rect.height - 8);
  return rect.top + rect.height / 2;
}

// src/spreadsheet/spreadsheet-canvas-worker-protocol.ts
function spreadsheetCanvasWorkerCapabilities(env = globalThis) {
  const canUseWorker = typeof env.Worker === "function";
  const canUseOffscreenCanvas = typeof env.OffscreenCanvas === "function" && typeof env.HTMLCanvasElement?.prototype?.transferControlToOffscreen === "function";
  return {
    canUseOffscreenCanvas,
    canUseWorker,
    preferredRenderer: canUseWorker && canUseOffscreenCanvas ? "worker-offscreen-canvas" : "main-thread-canvas"
  };
}
function spreadsheetCanvasRenderMessage(plan) {
  return {
    kind: "render",
    plan
  };
}

// src/spreadsheet/spreadsheet-canvas-worker-client.ts
function createSpreadsheetCanvasWorkerRenderer(canvas, createWorker = defaultSpreadsheetCanvasWorkerFactory) {
  if (spreadsheetCanvasWorkerCapabilities().preferredRenderer !== "worker-offscreen-canvas") return null;
  if (typeof canvas.transferControlToOffscreen !== "function") return null;
  try {
    const worker = createWorker();
    const offscreenCanvas = canvas.transferControlToOffscreen();
    const initMessage = {
      canvas: offscreenCanvas,
      kind: "init"
    };
    worker.postMessage(initMessage, [offscreenCanvas]);
    return {
      destroy: () => {
        worker.postMessage({ kind: "dispose" });
        worker.terminate();
      },
      render: (plan) => worker.postMessage(spreadsheetCanvasRenderMessage(plan))
    };
  } catch {
    return null;
  }
}
function defaultSpreadsheetCanvasWorkerFactory() {
  return new Worker(new URL("./spreadsheet-canvas.worker.js", import.meta.url), { type: "module" });
}

// src/spreadsheet/spreadsheet-canvas-layer.tsx
import { jsx as jsx9 } from "react/jsx-runtime";
function drawSpreadsheetCanvasPlanToCanvas(canvas, nextPlan) {
  if (!canvas) return;
  if (canvas.width !== nextPlan.bitmap.pixelWidth) canvas.width = nextPlan.bitmap.pixelWidth;
  if (canvas.height !== nextPlan.bitmap.pixelHeight) canvas.height = nextPlan.bitmap.pixelHeight;
  canvas.style.width = `${nextPlan.bitmap.cssWidth}px`;
  canvas.style.height = `${nextPlan.bitmap.cssHeight}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  drawSpreadsheetCanvasRenderPlan(context, nextPlan);
}
function SpreadsheetCanvasLayer({
  layout,
  scroll,
  viewportSize,
  cellPaints
}) {
  const canvasRef = useRef2(null);
  const schedulerRef = useRef2(null);
  const workerRendererRef = useRef2(null);
  const renderer = useMemo2(() => spreadsheetCanvasWorkerCapabilities().preferredRenderer, []);
  const plan = useMemo2(() => buildSpreadsheetCanvasRenderPlan({
    commands: buildSpreadsheetCanvasCommands({ cellPaints, layout, scroll, viewportSize }),
    pixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    scroll,
    viewportSize
  }), [cellPaints, layout, scroll, viewportSize]);
  useEffect2(() => {
    if (!schedulerRef.current) {
      schedulerRef.current = createSpreadsheetCanvasFrameScheduler({
        draw: (nextPlan) => {
          const canvas = canvasRef.current;
          if (!canvas) return;
          if (!workerRendererRef.current) {
            workerRendererRef.current = createSpreadsheetCanvasWorkerRenderer(canvas);
          }
          if (workerRendererRef.current) {
            workerRendererRef.current.render(nextPlan);
            return;
          }
          drawSpreadsheetCanvasPlanToCanvas(canvas, nextPlan);
        }
      });
    }
    schedulerRef.current.schedule(plan);
  }, [plan]);
  useEffect2(() => () => {
    schedulerRef.current?.destroy();
    workerRendererRef.current?.destroy();
  }, []);
  if (viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  return /* @__PURE__ */ jsx9(
    "canvas",
    {
      "aria-hidden": "true",
      "data-renderer": renderer,
      ref: canvasRef,
      style: {
        height: viewportSize.height,
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
        width: viewportSize.width,
        zIndex: 0
      }
    }
  );
}

// src/spreadsheet/spreadsheet-charts.tsx
import { useEffect as useEffect3, useRef as useRef3 } from "react";

// src/spreadsheet/spreadsheet-chart-frame.ts
function spreadsheetChartFrame(chart, plot) {
  return {
    chartArea: {
      height: Math.max(0, chart.height - 1),
      left: 0.5,
      top: 0.5,
      width: Math.max(0, chart.width - 1)
    },
    plotArea: {
      height: Math.max(0, plot.bottom - plot.top),
      left: plot.left + 0.5,
      top: plot.top + 0.5,
      width: Math.max(0, plot.right - plot.left)
    }
  };
}
function drawSpreadsheetChartFrame(context, chart, plot) {
  const frame = spreadsheetChartFrame(chart, plot);
  context.save();
  context.strokeStyle = "#d9d9d9";
  context.lineWidth = 1;
  context.setLineDash([]);
  context.strokeRect(frame.chartArea.left, frame.chartArea.top, frame.chartArea.width, frame.chartArea.height);
  context.strokeStyle = "#bfbfbf";
  context.strokeRect(frame.plotArea.left, frame.plotArea.top, frame.plotArea.width, frame.plotArea.height);
  context.restore();
}

// src/spreadsheet/spreadsheet-chart-options.ts
function spreadsheetChartRendererOptions(chart) {
  const barOptions = chartOptionsRecord(chart, "bar");
  const pieOptions = chartOptionsRecord(chart, "pie");
  const doughnutOptions = chartOptionsRecord(chart, "doughnut");
  return {
    barGrouping: chartBarGrouping(barOptions),
    barGapWidth: chartOptionNumber(barOptions, ["gapWidth"], 150),
    barOverlap: chartOptionNumber(barOptions, ["overlap"], 0),
    firstSliceAngle: chartOptionNumber(doughnutOptions ?? pieOptions ?? chart, ["firstSliceAngle", "firstSliceAng"], 0),
    holeSize: chartOptionNumber(doughnutOptions ?? chart, ["holeSize"], 55),
    varyColors: chartOptionBoolean(barOptions ?? doughnutOptions ?? pieOptions ?? chart, "varyColors")
  };
}
function chartBarGrouping(record) {
  const value = record?.grouping;
  if (asString(value) === "3" || asString(value).toLowerCase() === "percentstacked") return "percentStacked";
  if (asString(value) === "2" || asString(value).toLowerCase() === "stacked") return "stacked";
  return "clustered";
}
function chartOptionsRecord(chart, family) {
  return asRecord(chart[`${family}Options`]) ?? asRecord(chart[`${family}ChartOptions`]) ?? asRecord(chart[`${family}Chart`]);
}
function chartOptionNumber(record, keys, fallback) {
  for (const key of keys) {
    const value = asNumber(record?.[key], Number.NaN);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}
function chartOptionBoolean(record, key) {
  const value = record?.[key];
  return value === true || asString(value).toLowerCase() === "true" || asString(value) === "1";
}

// src/spreadsheet/spreadsheet-chart-scale.ts
function spreadsheetChartTickValues(chart, values) {
  const tickCount = isLineAxisChartType(chart.type) || chart.type === "radar" ? 6 : 5;
  const finiteValues = values.filter(Number.isFinite);
  const observedMin = finiteValues.length > 0 ? Math.min(...finiteValues) : 0;
  const observedMax = finiteValues.length > 0 ? Math.max(...finiteValues) : 1;
  const majorUnit = chart.yAxis?.majorUnit;
  const minValue = chart.yAxis?.minimum ?? chartScaleMinimum(observedMin, majorUnit);
  let maxValue = chart.yAxis?.maximum ?? chartScaleMaximum(observedMax, majorUnit, tickCount);
  if (!Number.isFinite(maxValue) || maxValue <= minValue) {
    maxValue = minValue + Math.max(1, Math.abs(minValue || 1));
  }
  if (majorUnit && majorUnit > 0) {
    const ticks = [];
    for (let value = minValue; value <= maxValue + majorUnit / 1e3; value += majorUnit) {
      ticks.push(roundChartNumber(value));
    }
    return ticks.length >= 2 ? ticks : [minValue, maxValue];
  }
  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / Math.max(1, tickCount - 1);
    return roundChartNumber(minValue + ratio * (maxValue - minValue));
  });
}
function chartY(value, plot, minValue, maxValue) {
  if (maxValue <= minValue) return plot.bottom;
  const ratio = (value - minValue) / (maxValue - minValue);
  return plot.bottom - ratio * (plot.bottom - plot.top);
}
function spreadsheetChartZeroBaselineY(plot, minValue, maxValue) {
  const zero = Math.max(minValue, Math.min(maxValue, 0));
  return chartY(zero, plot, minValue, maxValue);
}
function chartScaleMinimum(observedMin, majorUnit) {
  if (!Number.isFinite(observedMin) || observedMin >= 0) return 0;
  if (majorUnit && majorUnit > 0) return Math.floor(observedMin / majorUnit) * majorUnit;
  return -niceChartMax(Math.abs(observedMin), 5);
}
function chartScaleMaximum(observedMax, majorUnit, tickCount) {
  const nonNegativeMax = Math.max(0, observedMax);
  if (majorUnit && majorUnit > 0) return Math.ceil(nonNegativeMax / majorUnit) * majorUnit;
  return niceChartMax(nonNegativeMax, tickCount);
}
function niceChartMax(observedMax, tickCount) {
  if (!Number.isFinite(observedMax) || observedMax <= 0) return 1;
  const intervalCount = Math.max(1, tickCount - 1);
  const roughStep = observedMax / intervalCount;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const step = normalized <= 1 ? magnitude : normalized <= 2 ? 2 * magnitude : normalized <= 5 ? 5 * magnitude : 10 * magnitude;
  return Math.max(step, Math.ceil(observedMax / step) * step);
}
function roundChartNumber(value) {
  return Math.round(value * 1e6) / 1e6;
}
function isLineAxisChartType(type) {
  return type === "area" || type === "bubble" || type === "line" || type === "scatter" || type === "surface";
}

// src/spreadsheet/spreadsheet-chart-typography.ts
var SPREADSHEET_CHART_FONT_FAMILY = "Aptos, Calibri, Arial, sans-serif";
var SPREADSHEET_CHART_TEXT = {
  axisLabel: { size: 13, weight: 400 },
  axisTitle: { size: 13, weight: 400 },
  dataLabel: { size: 12, weight: 400 },
  legend: { size: 13, weight: 400 },
  title: { size: 24, weight: 400 }
};
function spreadsheetChartCanvasFont(role) {
  const style = SPREADSHEET_CHART_TEXT[role];
  return `${style.weight} ${style.size}px ${SPREADSHEET_CHART_FONT_FAMILY}`;
}
function spreadsheetChartTextWidth(text, role) {
  const style = SPREADSHEET_CHART_TEXT[role];
  return Math.ceil(text.length * style.size * 0.55);
}

// src/spreadsheet/spreadsheet-charts.tsx
import { jsx as jsx10 } from "react/jsx-runtime";
var SPREADSHEET_CHART_LINE_WIDTH = 2;
var SPREADSHEET_CHART_MARKER_RADIUS = 4;
var CHART_PALETTE = ["#1f6f8b", "#f9732a", "#5b7f2a", "#9467bd", "#8c564b", "#2ca02c", "#d62728"];
function buildSpreadsheetCharts({
  activeSheet,
  charts: workbookCharts,
  layout,
  sheets
}) {
  const protocolCharts = [
    ...buildSheetDrawingCharts(activeSheet, layout),
    ...buildRootSpreadsheetCharts(activeSheet, workbookCharts, layout)
  ];
  if (protocolCharts.length > 0) return protocolCharts;
  if (asString(activeSheet?.name) !== "01_Dashboard") return [];
  if (cellText(cellAt3(activeSheet, 1, 0)) !== "AI Coding Delivery Dashboard") return [];
  const statusCategories = [];
  const statusValues = [];
  for (let rowIndex = 18; rowIndex <= 23; rowIndex += 1) {
    const category = cellText(cellAt3(activeSheet, rowIndex, 0));
    const value = cellNumberAt2(activeSheet, rowIndex, 1);
    if (category && value != null) {
      statusCategories.push(category);
      statusValues.push(value);
    }
  }
  const fallbackCharts = [];
  if (statusCategories.length > 0) {
    fallbackCharts.push({
      categories: statusCategories,
      height: 280,
      left: spreadsheetColumnLeft(layout, 5),
      legendOverlay: false,
      legendPosition: "none",
      series: [spreadsheetChartSeries("Count", statusValues, 0)],
      showDataLabels: false,
      title: "Tasks by Status",
      top: spreadsheetRowTop(layout, 16),
      type: "bar",
      width: 450,
      zIndex: 0
    });
  }
  const timeSeriesSheet = sheets.find((sheet) => asString(sheet.name) === "03_TimeSeries");
  const monthLabels = [];
  const fitnessValues = [];
  const coverageValues = [];
  for (let rowIndex = 5; rowIndex <= 22; rowIndex += 1) {
    const serial = cellNumberAt2(timeSeriesSheet, rowIndex, 0);
    const fitness = cellNumberAt2(timeSeriesSheet, rowIndex, 5);
    const coverage = cellNumberAt2(timeSeriesSheet, rowIndex, 3);
    if (serial != null && fitness != null && coverage != null) {
      monthLabels.push(excelSerialMonthLabel(serial));
      fitnessValues.push(fitness);
      coverageValues.push(coverage * 100);
    }
  }
  if (monthLabels.length > 0) {
    fallbackCharts.push({
      categories: monthLabels,
      height: 280,
      left: spreadsheetColumnLeft(layout, 0),
      legendOverlay: false,
      legendPosition: "bottom",
      series: [
        spreadsheetChartSeries("Fitness Score", fitnessValues, 0),
        spreadsheetChartSeries("Coverage %", coverageValues, 1)
      ],
      showDataLabels: false,
      title: "Fitness Score vs Coverage",
      top: spreadsheetRowTop(layout, 30),
      type: "line",
      width: 640,
      zIndex: fallbackCharts.length
    });
  }
  return fallbackCharts;
}
function buildSheetDrawingCharts(activeSheet, layout) {
  return asArray(activeSheet?.drawings).map(asRecord).filter((drawing) => drawing != null).map((drawing, index) => chartFromSheetDrawing(drawing, layout, index)).filter((chart) => chart != null);
}
function chartFromSheetDrawing(drawing, layout, zIndex) {
  const chart = asRecord(drawing.chart);
  if (!chart) return null;
  const bounds = spreadsheetDrawingBounds(layout, drawing);
  return chartFromRecord(chart, {
    height: chartDimension(bounds.height > 24 ? bounds.height : 0, 0, 120),
    left: bounds.left,
    top: bounds.top,
    width: chartDimension(bounds.width > 24 ? bounds.width : 0, 0, 180),
    zIndex
  });
}
function buildRootSpreadsheetCharts(activeSheet, charts, layout) {
  const sheetName = asString(activeSheet?.name);
  return charts.filter((chart) => asString(chart.sheetName) === sheetName).map((chart, index) => {
    const anchor = asRecord(chart.anchor);
    const fromCol = protocolNumber2(anchor?.fromCol, 0);
    const fromRow = protocolNumber2(anchor?.fromRow, 0);
    const toCol = Math.max(fromCol + 5, protocolNumber2(anchor?.toCol, fromCol + 5));
    const toRow = Math.max(fromRow + 10, protocolNumber2(anchor?.toRow, fromRow + 10));
    const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(anchor?.fromColOffsetEmu);
    const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(anchor?.fromRowOffsetEmu);
    const right = spreadsheetColumnLeft(layout, toCol) + spreadsheetEmuToPx(anchor?.toColOffsetEmu);
    const bottom = spreadsheetRowTop(layout, toRow) + spreadsheetEmuToPx(anchor?.toRowOffsetEmu);
    return chartFromRecord(chart, {
      height: chartDimension(bottom - top, 0, 220),
      left,
      top,
      width: chartDimension(right - left, 0, 360),
      zIndex: 1e4 + index
    });
  }).filter((chart) => chart != null);
}
function chartFromRecord(chart, bounds) {
  const seriesRecords = asArray(chart.series).map(asRecord).filter((item) => item != null);
  const series = seriesRecords.map((item, index) => spreadsheetChartSeries(
    asString(item.label) || asString(item.name) || `Series ${index + 1}`,
    asArray(item.values).map((value) => protocolNumber2(value, Number.NaN)).filter(Number.isFinite),
    index,
    protocolColorToCss(item.color),
    chartSeriesHasMarker(item),
    item
  )).filter((item) => item.values.length > 0);
  if (series.length === 0) return null;
  const categories = asArray(seriesRecords[0]?.categories).map(asString).filter(Boolean);
  const dataLabels = spreadsheetChartDataLabels(chart);
  return {
    categories: categories.length > 0 ? categories : series[0].values.map((_, index) => String(index + 1)),
    height: bounds.height,
    left: bounds.left,
    legendOverlay: spreadsheetLegendOverlay(chart.legend),
    legendPosition: spreadsheetLegendPosition(chart.legend),
    dataLabels,
    options: spreadsheetChartRendererOptions(chart),
    series,
    showDataLabels: dataLabels != null,
    title: asString(chart.title),
    top: bounds.top,
    type: spreadsheetChartType(chart),
    width: bounds.width,
    xAxis: spreadsheetChartAxis(chart.xAxis),
    secondaryYAxis: spreadsheetChartAxis(chart.secondaryYAxis ?? chart.y2Axis ?? chart.rightAxis),
    yAxis: spreadsheetChartAxis(chart.yAxis),
    zIndex: bounds.zIndex
  };
}
function spreadsheetChartSeries(label, values, index, color, markerVisible = true, source) {
  const seriesColor = color ?? chartPalette(index);
  const errorBars = source ? chartSeriesErrorBars(source, seriesColor) : void 0;
  return {
    axis: chartSeriesAxis(source),
    color: seriesColor,
    ...errorBars ? { errorBars } : {},
    label,
    marker: markerVisible ? index % 2 === 0 ? "diamond" : "square" : null,
    trendlines: source ? chartSeriesTrendlines(source, seriesColor) : [],
    ...source ? chartSeriesType(source) : {},
    values
  };
}
function chartSeriesAxis(series) {
  if (!series) return "primary";
  if (series.useSecondaryAxis === true || series.secondaryAxis === true) return "secondary";
  const axis = asString(series.axis ?? series.axisId ?? series.yAxisId).toLowerCase();
  return axis === "2" || axis === "secondary" || axis === "right" ? "secondary" : "primary";
}
function chartSeriesType(series) {
  if (series.chartType == null && series.type == null) return {};
  return { type: spreadsheetChartType(series) };
}
function chartSeriesHasMarker(series) {
  return series.marker === true || asRecord(series.marker) != null;
}
function chartSeriesErrorBars(series, color) {
  const record = asRecord(series.errorBars) ?? asRecord(series.yErrorBars);
  if (!record) return void 0;
  const amount = protocolNumber2(record.amount ?? record.value ?? record.fixedValue ?? record.val, Number.NaN);
  if (!Number.isFinite(amount) || amount <= 0) return void 0;
  const direction = asString(record.direction || record.type).toLowerCase();
  return {
    amount,
    color: protocolColorToCss(record.color) ?? color,
    direction: direction.includes("plus") ? "plus" : direction.includes("minus") ? "minus" : "both"
  };
}
function chartSeriesTrendlines(series, color) {
  return recordList(series.trendlines ?? series.trendline).map((record) => ({
    color: protocolColorToCss(record.color) ?? color,
    type: asString(record.type || record.name) || "linear"
  }));
}
function recordList(value) {
  const records = asArray(value).map(asRecord).filter((record) => record != null);
  const single = asRecord(value);
  return records.length > 0 ? records : single ? [single] : [];
}
function spreadsheetLegendPosition(value) {
  const legend = asRecord(value);
  if (!legend) return "none";
  switch (asString(legend.position).toLowerCase()) {
    case "1":
    case "l":
    case "left":
      return "left";
    case "2":
    case "t":
    case "top":
      return "top";
    case "3":
    case "r":
    case "right":
      return "right";
    case "4":
    case "b":
    case "bottom":
      return "bottom";
    default:
      return "none";
  }
}
function spreadsheetLegendOverlay(value) {
  const legend = asRecord(value);
  return legend?.overlay === true || asString(legend?.overlay).toLowerCase() === "true" || asString(legend?.overlay) === "1";
}
function spreadsheetChartDataLabels(chart) {
  if (chart.hasDataLabels === true || chart.dataLabels === true) {
    return {
      position: "bestFit",
      showCategoryName: false,
      showPercent: false,
      showSeriesName: false,
      showValue: true
    };
  }
  const dataLabels = asRecord(chart.dataLabels);
  if (!dataLabels) return void 0;
  const spec = {
    position: spreadsheetChartDataLabelPosition(dataLabels.position ?? dataLabels.labelPosition ?? dataLabels.dLblPos),
    showCategoryName: chartBooleanFlag(dataLabels.showCategoryName ?? dataLabels.showCatName),
    showPercent: chartBooleanFlag(dataLabels.showPercent),
    showSeriesName: chartBooleanFlag(dataLabels.showSeriesName ?? dataLabels.showSerName),
    showValue: chartBooleanFlag(dataLabels.showValue ?? dataLabels.showVal ?? dataLabels.showBubbleSize)
  };
  return spec.showCategoryName || spec.showPercent || spec.showSeriesName || spec.showValue ? spec : void 0;
}
function spreadsheetChartDataLabelPosition(value) {
  switch (asString(value).trim().toLowerCase()) {
    case "above":
      return "above";
    case "below":
      return "below";
    case "center":
    case "ctr":
      return "center";
    case "inend":
    case "insideend":
    case "insideEnd":
      return "insideEnd";
    case "outend":
    case "outsideend":
    case "outsideEnd":
      return "outsideEnd";
    case "bestfit":
    case "bestFit":
    default:
      return "bestFit";
  }
}
function spreadsheetChartType(chart) {
  const chartType = asString(chart.chartType ?? chart.type).toLowerCase();
  const chartTypeId = protocolNumber2(chart.type, 0);
  if (chartType === "area" || chartTypeId === 2) return "area";
  if (chartType === "bubble" || chartTypeId === 5) return "bubble";
  if (chartType === "doughnut" || chartTypeId === 8) return "doughnut";
  if (chartType === "line" || chartTypeId === 13) return "line";
  if (chartType === "pie" || chartTypeId === 16) return "pie";
  if (chartType === "radar" || chartTypeId === 17) return "radar";
  if (chartType === "scatter" || chartTypeId === 18) return "scatter";
  if (chartType === "surface" || chartTypeId === 22) return "surface";
  return "bar";
}
function spreadsheetChartAxis(value) {
  const axis = asRecord(value);
  if (!axis) return void 0;
  const scaling = asRecord(axis.scaling) ?? {};
  return {
    majorGridLines: axis.majorGridLines === true || asRecord(axis.majorGridLines) != null,
    majorUnit: optionalProtocolNumber(axis.majorUnit ?? scaling.majorUnit),
    maximum: optionalProtocolNumber(axis.maximum ?? axis.max ?? scaling.maximum ?? scaling.max),
    minimum: optionalProtocolNumber(axis.minimum ?? axis.min ?? scaling.minimum ?? scaling.min),
    numberFormat: asString(axis.numberFormat),
    position: asString(axis.position ?? axis.axisPosition),
    ...asString(axis.title) ? { title: asString(axis.title) } : {}
  };
}
function chartDimension(exactValue, fallbackValue, minimum) {
  if (Number.isFinite(exactValue) && exactValue > 0) return Math.max(24, exactValue);
  if (Number.isFinite(fallbackValue) && fallbackValue > 0) return Math.max(24, fallbackValue);
  return minimum;
}
function optionalProtocolNumber(value) {
  const number = protocolNumber2(value, Number.NaN);
  return Number.isFinite(number) ? number : void 0;
}
function protocolNumber2(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}
function rowsByIndexForSheet4(sheet) {
  const rowMap = /* @__PURE__ */ new Map();
  const rows = asArray(sheet?.rows).map(asRecord).filter((row) => row != null);
  for (const row of rows) {
    const rowIndex = asNumber(row.index, 1);
    const cells = /* @__PURE__ */ new Map();
    for (const cell of asArray(row.cells)) {
      const cellRecord = asRecord(cell);
      if (!cellRecord) continue;
      const address = asString(cellRecord.address);
      cells.set(columnIndexFromAddress(address), cellRecord);
    }
    rowMap.set(rowIndex, cells);
  }
  return rowMap;
}
function cellAt3(sheet, rowIndex, columnIndex) {
  return rowsByIndexForSheet4(sheet).get(rowIndex)?.get(columnIndex) ?? null;
}
function cellNumberAt2(sheet, rowIndex, columnIndex) {
  const text = cellText(cellAt3(sheet, rowIndex, columnIndex)).trim();
  if (text.length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
function chartBooleanFlag(value) {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  const normalized = asString(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
function excelSerialMonthLabel(value) {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 864e5);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "2-digit" }).format(date);
}
function SpreadsheetChartLayer({ charts }) {
  if (charts.length === 0) return null;
  return /* @__PURE__ */ jsx10("div", { "aria-hidden": "true", style: { inset: 0, pointerEvents: "none", position: "absolute" }, children: charts.map((chart, index) => /* @__PURE__ */ jsx10(SpreadsheetCanvasChart, { chart }, `${chart.type}-${chart.title}-${index}`)) });
}
function SpreadsheetCanvasChart({ chart }) {
  const canvasRef = useRef3(null);
  useEffect3(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(chart.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(chart.height * pixelRatio));
    canvas.style.width = `${chart.width}px`;
    canvas.style.height = `${chart.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, chart.width, chart.height);
    drawSpreadsheetChart(context, chart);
  }, [chart]);
  return /* @__PURE__ */ jsx10(
    "canvas",
    {
      ref: canvasRef,
      style: {
        background: "#ffffff",
        borderColor: "#e5e7eb",
        borderStyle: "solid",
        borderWidth: 1,
        height: chart.height,
        left: chart.left,
        position: "absolute",
        top: chart.top,
        width: chart.width,
        zIndex: chart.zIndex
      },
      title: chart.title
    }
  );
}
function drawSpreadsheetChart(context, chart) {
  const width = chart.width;
  const height = chart.height;
  const plot = spreadsheetChartPlotArea(chart);
  const values = chart.series.flatMap((series) => series.values);
  const primaryValues = chart.series.filter((series) => series.axis !== "secondary").flatMap((series) => series.values);
  const secondaryValues = chart.series.filter((series) => series.axis === "secondary").flatMap((series) => series.values);
  const ticks = spreadsheetChartTickValues(chart, primaryValues.length > 0 ? primaryValues : values);
  const secondaryTicks = secondaryValues.length > 0 ? spreadsheetChartTickValues({ ...chart, yAxis: chart.secondaryYAxis ?? chart.yAxis }, secondaryValues) : [];
  const primaryScale = chartScaleFromTicks(ticks);
  const secondaryScale = secondaryTicks.length > 0 ? chartScaleFromTicks(secondaryTicks) : void 0;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  drawSpreadsheetChartFrame(context, chart, plot);
  context.fillStyle = "#111827";
  context.font = spreadsheetChartCanvasFont("title");
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText(chart.title, width / 2, 34);
  if (isCartesianChart(chart.type)) {
    drawChartGrid2(context, chart, plot, ticks, secondaryTicks);
  }
  if (isComboChart(chart)) {
    drawComboChart(context, chart, plot, primaryScale, secondaryScale);
  } else {
    switch (chart.type) {
      case "area":
      case "surface":
        drawAreaChart(context, chart, plot, primaryScale.minValue, primaryScale.maxValue);
        break;
      case "bubble":
        drawScatterChart(context, chart, plot, primaryScale.minValue, primaryScale.maxValue, true);
        break;
      case "doughnut":
        drawPieChart2(context, chart, plot, true);
        break;
      case "line":
        drawLineChart2(context, chart, plot, primaryScale, secondaryScale);
        break;
      case "pie":
        drawPieChart2(context, chart, plot, false);
        break;
      case "radar":
        drawRadarChart(context, chart, plot, ticks);
        break;
      case "scatter":
        drawScatterChart(context, chart, plot, primaryScale.minValue, primaryScale.maxValue, false);
        break;
      case "bar":
      default:
        drawBarChart2(context, chart, plot, primaryScale.minValue, primaryScale.maxValue);
        break;
    }
  }
  if (chart.showDataLabels) {
    drawChartDataLabels(context, chart, plot, primaryScale.minValue, primaryScale.maxValue);
  }
  drawChartLegend2(context, chart, plot);
}
function isComboChart(chart) {
  return chart.series.some((series) => series.type != null && series.type !== chart.type);
}
function drawComboChart(context, chart, plot, primaryScale, secondaryScale) {
  const barSeries = chart.series.filter((series) => effectiveSeriesType(series, chart) === "bar");
  const lineSeries = chart.series.filter((series) => effectiveSeriesType(series, chart) === "line");
  if (barSeries.length > 0) {
    drawBarChart2(
      context,
      { ...chart, categories: lineSeries.length > 0 ? [] : chart.categories, series: barSeries, type: "bar" },
      plot,
      primaryScale.minValue,
      primaryScale.maxValue
    );
  }
  if (lineSeries.length > 0) {
    drawLineChart2(context, { ...chart, series: lineSeries, type: "line" }, plot, primaryScale, secondaryScale);
  }
}
function effectiveSeriesType(series, chart) {
  return series.type ?? chart.type;
}
function chartScaleFromTicks(ticks) {
  return {
    maxValue: ticks[ticks.length - 1] ?? 1,
    minValue: ticks[0] ?? 0
  };
}
function spreadsheetChartPlotArea(chart) {
  const reservesLegendSpace = chart.legendPosition !== "none" && !chart.legendOverlay;
  const hasBottomLegend = reservesLegendSpace && chart.legendPosition === "bottom";
  const hasTopLegend = reservesLegendSpace && chart.legendPosition === "top";
  const hasLeftLegend = reservesLegendSpace && chart.legendPosition === "left";
  const hasRightLegend = reservesLegendSpace && chart.legendPosition === "right";
  const hasSecondaryAxis = chart.series.some((series) => series.axis === "secondary");
  const categoryLabelHeight = isLineAxisChart(chart.type) ? 46 : isCircularChart(chart.type) || chart.type === "radar" ? 8 : 30;
  const legendHeight = hasBottomLegend ? 42 : 0;
  const top = (chart.title ? 58 : 24) + (hasTopLegend ? 28 : 0);
  const bottom = Math.max(top + 48, chart.height - categoryLabelHeight - legendHeight);
  const leftBase = isLineAxisChart(chart.type) ? 64 : isCircularChart(chart.type) || chart.type === "radar" ? 28 : 52;
  const rightBase = hasRightLegend ? 126 : 22;
  const primaryValues = chart.series.filter((series) => series.axis !== "secondary").flatMap((series) => series.values);
  const secondaryValues = chart.series.filter((series) => series.axis === "secondary").flatMap((series) => series.values);
  const leftAxisGutter = isCircularChart(chart.type) || chart.type === "radar" ? leftBase : Math.max(leftBase, spreadsheetChartAxisGutter(chart, chart.yAxis, primaryValues));
  const rightAxisGutter = hasSecondaryAxis ? Math.max(42, spreadsheetChartAxisGutter(chart, chart.secondaryYAxis ?? chart.yAxis, secondaryValues, 10)) : 0;
  return {
    bottom,
    left: leftAxisGutter + (hasLeftLegend ? 108 : 0),
    right: chart.width - rightBase - rightAxisGutter,
    top
  };
}
function spreadsheetChartAxisGutter(chart, axis, values, padding = 18) {
  const ticks = spreadsheetChartTickValues({ ...chart, yAxis: axis }, values);
  const maxLabelLength = Math.max(
    1,
    ...ticks.map((value) => formatChartTick2(value, axis?.numberFormat).length)
  );
  return Math.ceil(maxLabelLength * spreadsheetChartTextWidth("0", "axisLabel") + padding);
}
function drawChartGrid2(context, chart, plot, ticks, secondaryTicks = []) {
  context.save();
  context.strokeStyle = "#c7c7c7";
  context.setLineDash([5, 5]);
  context.lineWidth = 1;
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "right";
  context.textBaseline = "middle";
  const minValue = ticks[0] ?? 0;
  const maxValue = ticks[ticks.length - 1] ?? 1;
  const showHorizontalGrid = chart.yAxis?.majorGridLines !== false;
  for (const value of ticks) {
    const y = chartY(value, plot, minValue, maxValue);
    if (showHorizontalGrid) {
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
    }
    context.fillText(formatChartTick2(value, chart.yAxis?.numberFormat), plot.left - 8, y);
  }
  if (isLineAxisChart(chart.type) && chart.categories.length > 0) {
    const pointCount = Math.max(1, chart.categories.length - 1);
    for (let index = 0; index < chart.categories.length; index += 1) {
      const x = plot.left + index / pointCount * (plot.right - plot.left);
      context.beginPath();
      context.moveTo(x, plot.top);
      context.lineTo(x, plot.bottom);
      context.stroke();
    }
  }
  context.setLineDash([]);
  context.strokeStyle = "#111827";
  context.beginPath();
  context.moveTo(plot.left, plot.top);
  context.lineTo(plot.left, plot.bottom);
  const axisY = spreadsheetChartZeroBaselineY(plot, minValue, maxValue);
  context.moveTo(plot.left, axisY);
  context.lineTo(plot.right, axisY);
  context.stroke();
  drawSecondaryChartAxis(context, chart, plot, secondaryTicks);
  drawChartAxisTitles2(context, chart, plot);
  context.restore();
}
function drawSecondaryChartAxis(context, chart, plot, ticks) {
  if (ticks.length === 0) return;
  const minValue = ticks[0] ?? 0;
  const maxValue = ticks[ticks.length - 1] ?? 1;
  context.save();
  context.strokeStyle = "#111827";
  context.beginPath();
  context.moveTo(plot.right, plot.top);
  context.lineTo(plot.right, plot.bottom);
  context.stroke();
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (const value of ticks) {
    context.fillText(
      formatChartTick2(value, chart.secondaryYAxis?.numberFormat),
      plot.right + 8,
      chartY(value, plot, minValue, maxValue)
    );
  }
  context.restore();
}
function drawChartAxisTitles2(context, chart, plot) {
  context.save();
  context.fillStyle = "#4b5563";
  context.font = spreadsheetChartCanvasFont("axisTitle");
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (chart.yAxis?.title) {
    context.save();
    context.translate(14, (plot.top + plot.bottom) / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(chart.yAxis.title, 0, 0);
    context.restore();
  }
  if (chart.xAxis?.title) {
    const offset = isLineAxisChart(chart.type) ? 48 : 38;
    context.fillText(chart.xAxis.title, (plot.left + plot.right) / 2, plot.bottom + offset);
  }
  context.restore();
}
function drawBarChart2(context, chart, plot, minValue, maxValue) {
  context.save();
  const baselineY = spreadsheetChartZeroBaselineY(plot, minValue, maxValue);
  spreadsheetBarChartGeometry(chart, plot).forEach(({ barWidth, categoryIndex, centerX, series, value }) => {
    const y = chartY(value, plot, minValue, maxValue);
    const top = Math.min(y, baselineY);
    const height = Math.max(1, Math.abs(baselineY - y));
    context.fillStyle = chart.options?.varyColors && chart.series.length === 1 ? chartPalette(categoryIndex) : series.color;
    context.beginPath();
    context.roundRect(centerX - barWidth / 2, top, barWidth, height, 3);
    context.fill();
  });
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const slotWidth = (plot.right - plot.left) / barChartCategoryCount(chart);
  chart.categories.forEach((category, index) => {
    const centerX = plot.left + slotWidth * index + slotWidth / 2;
    context.fillText(category, centerX, plot.bottom + 20);
  });
  context.restore();
}
function spreadsheetBarChartGeometry(chart, plot) {
  const categoryCount = barChartCategoryCount(chart);
  const visibleSeries = chart.series.filter((series) => series.values.length > 0);
  const seriesCount = Math.max(1, visibleSeries.length);
  const slotWidth = (plot.right - plot.left) / categoryCount;
  const gapWidth = Math.max(0, Math.min(500, chart.options?.barGapWidth ?? 150));
  const overlap = Math.max(-100, Math.min(100, chart.options?.barOverlap ?? 0)) / 100;
  const groupWidth = Math.min(slotWidth * 0.92, slotWidth / (1 + gapWidth / 100));
  const rawBarWidth = groupWidth / (seriesCount - overlap * Math.max(0, seriesCount - 1));
  const barStep = rawBarWidth * (1 - overlap);
  const barWidth = Math.max(3, Math.min(48, rawBarWidth));
  const bars = [];
  for (let categoryIndex = 0; categoryIndex < categoryCount; categoryIndex += 1) {
    const categoryCenter = plot.left + slotWidth * categoryIndex + slotWidth / 2;
    visibleSeries.forEach((series, seriesIndex) => {
      const value = series.values[categoryIndex];
      if (!Number.isFinite(value)) return;
      const centerX = categoryCenter + (seriesIndex - (seriesCount - 1) / 2) * barStep;
      bars.push({ barWidth, categoryIndex, centerX, series, value });
    });
  }
  return bars;
}
function barChartCategoryCount(chart) {
  return Math.max(1, chart.categories.length, ...chart.series.map((series) => series.values.length));
}
function drawLineChart2(context, chart, plot, primaryScale, secondaryScale) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index) => plot.left + index / pointCount * (plot.right - plot.left);
  const scaleForSeries = (series) => series.axis === "secondary" && secondaryScale ? secondaryScale : primaryScale;
  context.save();
  chart.series.forEach((series) => {
    const scale = scaleForSeries(series);
    context.strokeStyle = series.color;
    context.lineWidth = SPREADSHEET_CHART_LINE_WIDTH;
    context.setLineDash([]);
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, scale.minValue, scale.maxValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    drawLineSeriesErrorBars(context, series, xForIndex, plot, scale);
    drawLineSeriesTrendlines(context, series, xForIndex, plot, scale);
  });
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });
  chart.series.forEach((series) => {
    if (!series.marker) return;
    const scale = scaleForSeries(series);
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, scale.minValue, scale.maxValue);
      context.beginPath();
      if (series.marker === "diamond") {
        context.moveTo(x, y - SPREADSHEET_CHART_MARKER_RADIUS);
        context.lineTo(x + SPREADSHEET_CHART_MARKER_RADIUS, y);
        context.lineTo(x, y + SPREADSHEET_CHART_MARKER_RADIUS);
        context.lineTo(x - SPREADSHEET_CHART_MARKER_RADIUS, y);
      } else {
        context.rect(x - SPREADSHEET_CHART_MARKER_RADIUS, y - SPREADSHEET_CHART_MARKER_RADIUS, SPREADSHEET_CHART_MARKER_RADIUS * 2, SPREADSHEET_CHART_MARKER_RADIUS * 2);
      }
      context.closePath();
      context.fill();
    });
  });
  context.restore();
}
function drawLineSeriesErrorBars(context, series, xForIndex, plot, scale) {
  const errorBars = series.errorBars;
  if (!errorBars) return;
  context.save();
  context.strokeStyle = errorBars.color;
  context.lineWidth = 1;
  series.values.forEach((value, index) => {
    const x = xForIndex(index);
    const y = chartY(value, plot, scale.minValue, scale.maxValue);
    const top = errorBars.direction === "minus" ? y : chartY(value + errorBars.amount, plot, scale.minValue, scale.maxValue);
    const bottom = errorBars.direction === "plus" ? y : chartY(value - errorBars.amount, plot, scale.minValue, scale.maxValue);
    context.beginPath();
    context.moveTo(x, top);
    context.lineTo(x, bottom);
    context.moveTo(x - 4, top);
    context.lineTo(x + 4, top);
    context.moveTo(x - 4, bottom);
    context.lineTo(x + 4, bottom);
    context.stroke();
  });
  context.restore();
}
function drawLineSeriesTrendlines(context, series, xForIndex, plot, scale) {
  if (series.trendlines.length === 0 || series.values.length < 2) return;
  const regression = linearRegression(series.values);
  if (!regression) return;
  const firstIndex = 0;
  const lastIndex = series.values.length - 1;
  context.save();
  context.lineWidth = 1.5;
  context.setLineDash([6, 4]);
  for (const trendline of series.trendlines) {
    context.strokeStyle = trendline.color;
    context.beginPath();
    context.moveTo(xForIndex(firstIndex), chartY(regression.intercept, plot, scale.minValue, scale.maxValue));
    context.lineTo(
      xForIndex(lastIndex),
      chartY(regression.slope * lastIndex + regression.intercept, plot, scale.minValue, scale.maxValue)
    );
    context.stroke();
  }
  context.restore();
}
function linearRegression(values) {
  const points = values.map((value, index) => ({ value, x: index })).filter((point) => Number.isFinite(point.value));
  if (points.length < 2) return null;
  const count = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.value, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.value, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = count * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  return {
    intercept: (sumY - slope * sumX) / count,
    slope
  };
}
function drawAreaChart(context, chart, plot, minValue, maxValue) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index) => plot.left + index / pointCount * (plot.right - plot.left);
  context.save();
  const baselineY = spreadsheetChartZeroBaselineY(plot, minValue, maxValue);
  chart.series.forEach((series) => {
    context.beginPath();
    series.values.forEach((value, index) => {
      const x = xForIndex(index);
      const y = chartY(value, plot, minValue, maxValue);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.lineTo(xForIndex(Math.max(0, series.values.length - 1)), baselineY);
    context.lineTo(xForIndex(0), baselineY);
    context.closePath();
    context.globalAlpha = 0.22;
    context.fillStyle = series.color;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = series.color;
    context.lineWidth = 2;
    context.stroke();
  });
  drawLineCategoryLabels(context, chart, plot);
  context.restore();
}
function drawPieChart2(context, chart, plot, isDoughnut) {
  const values = chart.series[0]?.values.map((value) => Math.max(0, value)) ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;
  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2;
  const radius = Math.max(12, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.42);
  let startAngle = ((chart.options?.firstSliceAngle ?? 0) - 90) * Math.PI / 180;
  context.save();
  values.forEach((value, index) => {
    const angle = value / total * Math.PI * 2;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, radius, startAngle, startAngle + angle);
    context.closePath();
    context.fillStyle = chartPalette(index);
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.stroke();
    startAngle += angle;
  });
  if (isDoughnut) {
    const holeSize = Math.max(10, Math.min(90, chart.options?.holeSize ?? 55));
    context.beginPath();
    context.arc(centerX, centerY, radius * (holeSize / 100), 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
  }
  context.restore();
}
function drawScatterChart(context, chart, plot, minValue, maxValue, isBubble) {
  const xValues = chart.categories.map((category, index) => {
    const numeric = Number(category);
    return Number.isFinite(numeric) ? numeric : index + 1;
  });
  const minX = Math.min(...xValues, 0);
  const maxX = Math.max(...xValues, 1);
  const xForValue = (value) => {
    if (maxX <= minX) return plot.left;
    return plot.left + (value - minX) / (maxX - minX) * (plot.right - plot.left);
  };
  context.save();
  chart.series.forEach((series) => {
    context.fillStyle = series.color;
    series.values.forEach((value, index) => {
      const x = xForValue(xValues[index] ?? index + 1);
      const y = chartY(value, plot, minValue, maxValue);
      const radius = isBubble ? 7 : 5;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1;
      context.stroke();
    });
  });
  drawLineCategoryLabels(context, chart, plot);
  context.restore();
}
function drawRadarChart(context, chart, plot, ticks) {
  const axisCount = Math.max(3, chart.categories.length, ...chart.series.map((series) => series.values.length));
  const maxValue = ticks[ticks.length - 1] ?? Math.max(...chart.series.flatMap((series) => series.values), 1);
  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2;
  const radius = Math.max(12, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.42);
  const pointFor = (index, value) => {
    const angle = -Math.PI / 2 + index / axisCount * Math.PI * 2;
    const ratio = maxValue > 0 ? Math.max(0, value) / maxValue : 0;
    return {
      x: centerX + Math.cos(angle) * radius * ratio,
      y: centerY + Math.sin(angle) * radius * ratio
    };
  };
  const axisPoint = (index) => pointFor(index, maxValue);
  context.save();
  context.strokeStyle = "#d1d5db";
  context.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring += 1) {
    context.beginPath();
    for (let index = 0; index < axisCount; index += 1) {
      const point = pointFor(index, maxValue * ring / 4);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.stroke();
  }
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < axisCount; index += 1) {
    const point = axisPoint(index);
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(point.x, point.y);
    context.stroke();
    const label = chart.categories[index];
    if (label) {
      context.fillText(label, point.x, point.y);
    }
  }
  chart.series.forEach((series) => {
    context.beginPath();
    series.values.forEach((value, index) => {
      const point = pointFor(index, value);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.globalAlpha = 0.16;
    context.fillStyle = series.color;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = series.color;
    context.lineWidth = 2;
    context.stroke();
  });
  context.restore();
}
function drawLineCategoryLabels(context, chart, plot) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index) => plot.left + index / pointCount * (plot.right - plot.left);
  context.fillStyle = "#737373";
  context.font = spreadsheetChartCanvasFont("axisLabel");
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  chart.categories.forEach((category, index) => {
    const x = xForIndex(index);
    const [first, ...rest] = category.split(/\s+/);
    context.fillText(first, x, plot.bottom + 20);
    if (rest.length > 0) {
      context.fillText(rest.join(" "), x, plot.bottom + 36);
    }
  });
}
function drawChartDataLabels(context, chart, plot, minValue, maxValue) {
  context.save();
  context.fillStyle = "#374151";
  context.font = spreadsheetChartCanvasFont("dataLabel");
  context.textAlign = "center";
  context.textBaseline = "middle";
  if (isCircularChart(chart.type)) {
    drawCircularDataLabels(context, chart, plot);
  } else if (chart.type === "bar") {
    drawBarDataLabels(context, chart, plot, minValue, maxValue);
  } else if (isLineAxisChart(chart.type)) {
    drawLineDataLabels(context, chart, plot, minValue, maxValue);
  }
  context.restore();
}
function drawLineDataLabels(context, chart, plot, minValue, maxValue) {
  const pointCount = Math.max(1, chart.categories.length - 1);
  const xForIndex = (index) => plot.left + index / pointCount * (plot.right - plot.left);
  chart.series.forEach((series) => {
    series.values.forEach((value, index) => {
      const pointY = chartY(value, plot, minValue, maxValue);
      const offset = chartDataLabelPointOffset(chart.dataLabels?.position ?? "above");
      const label = chartDataLabelText(chart, series, value, index);
      if (label) context.fillText(label, xForIndex(index), pointY + offset);
    });
  });
}
function drawBarDataLabels(context, chart, plot, minValue, maxValue) {
  spreadsheetBarChartGeometry(chart, plot).forEach(({ categoryIndex, centerX, series, value }) => {
    const y = chartY(value, plot, minValue, maxValue);
    const baselineY = spreadsheetChartZeroBaselineY(plot, minValue, maxValue);
    const label = chartDataLabelText(chart, series, value, categoryIndex);
    if (!label) return;
    const position = chart.dataLabels?.position ?? "outsideEnd";
    const top = Math.min(y, baselineY);
    const bottom = Math.max(y, baselineY);
    const labelY = position === "center" ? top + (bottom - top) / 2 : position === "insideEnd" ? value >= 0 ? top + 12 : bottom - 12 : value >= 0 ? Math.max(plot.top + 10, top - 12) : Math.min(plot.bottom - 10, bottom + 12);
    context.fillText(label, centerX, labelY);
  });
}
function drawCircularDataLabels(context, chart, plot) {
  const values = chart.series[0]?.values.map((value) => Math.max(0, value)) ?? [];
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;
  const centerX = (plot.left + plot.right) / 2;
  const centerY = (plot.top + plot.bottom) / 2;
  const radius = Math.max(12, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.32);
  let startAngle = -Math.PI / 2;
  values.forEach((value, index) => {
    const angle = value / total * Math.PI * 2;
    const midAngle = startAngle + angle / 2;
    const label = chartDataLabelText(chart, chart.series[0], value, index, total) || chart.categories[index] || formatChartTick2(value, chart.yAxis?.numberFormat);
    context.fillText(label, centerX + Math.cos(midAngle) * radius, centerY + Math.sin(midAngle) * radius);
    startAngle += angle;
  });
}
function chartDataLabelPointOffset(position) {
  if (position === "below") return 14;
  if (position === "center") return 0;
  return -14;
}
function chartDataLabelText(chart, series, value, index, total) {
  const labels = chart.dataLabels;
  if (!labels) return "";
  const parts = [];
  if (labels.showSeriesName && series?.label) parts.push(series.label);
  if (labels.showCategoryName && chart.categories[index]) parts.push(chart.categories[index] ?? "");
  if (labels.showValue) parts.push(formatChartTick2(value, chart.yAxis?.numberFormat));
  if (labels.showPercent && total != null && total > 0) parts.push(`${Math.round(value / total * 100)}%`);
  return parts.join(" ");
}
function drawChartLegend2(context, chart, plot) {
  if (chart.legendPosition === "none") return;
  const items = chartLegendItems(chart);
  context.save();
  if (chart.legendPosition === "right") {
    let legendY2 = plot.top + 18;
    const legendX = plot.right + 18;
    items.forEach((item) => {
      drawLegendEntry(context, item, legendX, legendY2);
      legendY2 += 20;
    });
    context.restore();
    return;
  }
  if (chart.legendPosition === "left") {
    let legendY2 = plot.top + 18;
    const legendX = 18;
    items.forEach((item) => {
      drawLegendEntry(context, item, legendX, legendY2);
      legendY2 += 20;
    });
    context.restore();
    return;
  }
  const legendY = chart.legendPosition === "top" ? 48 : chart.height - 18;
  spreadsheetChartHorizontalLegendLayout(chart.width, legendY, items).forEach((entry) => {
    drawLegendEntry(context, entry.item, entry.x, entry.y);
  });
  context.restore();
}
function spreadsheetChartHorizontalLegendLayout(chartWidth, y, items) {
  const widths = items.map(spreadsheetChartLegendItemWidth);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let x = Math.max(12, chartWidth / 2 - totalWidth / 2);
  return items.map((item, index) => {
    const entry = { item, x, y };
    x += widths[index] ?? 0;
    return entry;
  });
}
function spreadsheetChartLegendItemWidth(item) {
  return Math.max(64, 34 + spreadsheetChartTextWidth(item.label, "legend") + 18);
}
function chartLegendItems(chart) {
  if (isCircularChart(chart.type)) {
    return chart.categories.map((label, index) => ({
      color: chartPalette(index),
      label,
      marker: "square",
      showLine: false
    }));
  }
  return chart.series.map((series) => ({
    color: series.color,
    label: series.label,
    marker: series.marker,
    showLine: true
  }));
}
function drawLegendEntry(context, item, x, y) {
  context.strokeStyle = item.color;
  context.lineWidth = SPREADSHEET_CHART_LINE_WIDTH;
  context.fillStyle = item.color;
  if (item.showLine) {
    context.beginPath();
    context.moveTo(x, y - 4);
    context.lineTo(x + 18, y - 4);
    context.stroke();
    if (item.marker) drawChartMarker(context, item.marker, x + 9, y - 4, SPREADSHEET_CHART_MARKER_RADIUS);
  } else {
    context.fillRect(x, y - 10, 12, 12);
  }
  context.fillStyle = "#737373";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.font = spreadsheetChartCanvasFont("legend");
  context.fillText(item.label, x + 26, y);
}
function drawChartMarker(context, marker, x, y, radius) {
  context.beginPath();
  if (marker === "diamond") {
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
  } else {
    context.rect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.closePath();
  context.fill();
}
function isCartesianChart(type) {
  return type === "area" || type === "bar" || type === "bubble" || type === "line" || type === "scatter" || type === "surface";
}
function isLineAxisChart(type) {
  return type === "area" || type === "bubble" || type === "line" || type === "scatter" || type === "surface";
}
function isCircularChart(type) {
  return type === "doughnut" || type === "pie";
}
function chartPalette(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length] ?? "#1f6f8b";
}
function formatChartTick2(value, numberFormat = "") {
  const normalized = numberFormat.toLowerCase();
  if (normalized.includes("%")) {
    const decimals = chartFormatDecimalPlaces(numberFormat);
    return `${(value * 100).toFixed(decimals)}%`;
  }
  if (numberFormat.includes("$")) {
    const decimals = chartFormatDecimalPlaces(numberFormat);
    const formatted = Math.abs(value).toLocaleString("en-US", {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals
    });
    return `${value < 0 ? "-" : ""}$${formatted}`;
  }
  if (numberFormat.includes("#,##0.00")) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }
  if (numberFormat.includes("#,##0")) {
    return Math.round(value).toLocaleString("en-US");
  }
  if (/^0\.0+$/.test(numberFormat)) {
    return value.toFixed(chartFormatDecimalPlaces(numberFormat));
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
function chartFormatDecimalPlaces(numberFormat) {
  return numberFormat.match(/\.([0#]+)/)?.[1]?.length ?? 0;
}

// src/spreadsheet/spreadsheet-frozen-headers.tsx
import { jsx as jsx11, jsxs as jsxs7 } from "react/jsx-runtime";
function spreadsheetFrozenColumnHeaderRect(layout, columnIndex, scrollLeft) {
  const frozen = columnIndex < layout.freezePanes.columnCount;
  return {
    height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
    left: spreadsheetColumnLeft(layout, columnIndex) - SPREADSHEET_ROW_HEADER_WIDTH - (frozen ? 0 : scrollLeft),
    width: layout.columnWidths[columnIndex] ?? 0
  };
}
function spreadsheetFrozenRowHeaderRect(layout, rowOffset, scrollTop) {
  const frozen = rowOffset < layout.freezePanes.rowCount;
  return {
    height: layout.rowHeights[rowOffset] ?? 0,
    top: spreadsheetRowTop(layout, rowOffset) - SPREADSHEET_COLUMN_HEADER_HEIGHT - (frozen ? 0 : scrollTop),
    width: SPREADSHEET_ROW_HEADER_WIDTH
  };
}
function SpreadsheetFrozenHeaders({
  layout,
  scrollLeft,
  scrollTop,
  viewportSize
}) {
  const visibleRange = spreadsheetVisibleCellRange(layout, viewportSize, { left: scrollLeft, top: scrollTop });
  const visibleColumnIndexes = visibleHeaderIndexes(
    visibleRange.startColumnIndex,
    visibleRange.endColumnIndex,
    layout.freezePanes.columnCount
  );
  const visibleRowOffsets = visibleHeaderIndexes(
    visibleRange.startRowOffset,
    visibleRange.endRowOffset,
    layout.freezePanes.rowCount
  );
  return /* @__PURE__ */ jsxs7(
    "div",
    {
      "aria-hidden": "true",
      style: {
        inset: 0,
        pointerEvents: "none",
        position: "absolute",
        zIndex: 12
      },
      children: [
        /* @__PURE__ */ jsx11("div", { style: spreadsheetFrozenCornerStyle }),
        /* @__PURE__ */ jsx11(
          "div",
          {
            style: {
              height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
              left: SPREADSHEET_ROW_HEADER_WIDTH,
              overflow: "hidden",
              position: "absolute",
              right: 0,
              top: 0
            },
            children: /* @__PURE__ */ jsx11(
              "div",
              {
                style: {
                  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
                  position: "relative",
                  width: Math.max(0, layout.gridWidth - SPREADSHEET_ROW_HEADER_WIDTH)
                },
                children: visibleColumnIndexes.map((columnIndex) => {
                  const rect = spreadsheetFrozenColumnHeaderRect(layout, columnIndex, scrollLeft);
                  return /* @__PURE__ */ jsx11(
                    "div",
                    {
                      style: {
                        ...spreadsheetFrozenHeaderBaseStyle,
                        height: rect.height,
                        left: rect.left,
                        top: 0,
                        width: rect.width
                      },
                      children: columnLabel(columnIndex)
                    },
                    columnIndex
                  );
                })
              }
            )
          }
        ),
        /* @__PURE__ */ jsx11(
          "div",
          {
            style: {
              bottom: 0,
              left: 0,
              overflow: "hidden",
              position: "absolute",
              top: SPREADSHEET_COLUMN_HEADER_HEIGHT,
              width: SPREADSHEET_ROW_HEADER_WIDTH
            },
            children: /* @__PURE__ */ jsx11(
              "div",
              {
                style: {
                  height: Math.max(0, layout.gridHeight - SPREADSHEET_COLUMN_HEADER_HEIGHT),
                  position: "relative",
                  width: SPREADSHEET_ROW_HEADER_WIDTH
                },
                children: visibleRowOffsets.map((rowOffset) => {
                  const rect = spreadsheetFrozenRowHeaderRect(layout, rowOffset, scrollTop);
                  return /* @__PURE__ */ jsx11(
                    "div",
                    {
                      style: {
                        ...spreadsheetFrozenHeaderBaseStyle,
                        height: rect.height,
                        left: 0,
                        top: rect.top,
                        width: rect.width
                      },
                      children: rowOffset + 1
                    },
                    rowOffset
                  );
                })
              }
            )
          }
        )
      ]
    }
  );
}
function visibleHeaderIndexes(start, end, frozenCount) {
  const indexes = /* @__PURE__ */ new Set();
  for (let index = 0; index < frozenCount; index += 1) {
    indexes.add(index);
  }
  for (let index = Math.max(0, start); index <= end; index += 1) {
    indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}
var spreadsheetFrozenHeaderBaseStyle = {
  alignItems: "center",
  background: "#f1f3f4",
  borderBottomColor: "#dadce0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#dadce0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#3c4043",
  display: "flex",
  fontFamily: SPREADSHEET_FONT_FAMILY,
  fontSize: 13,
  fontWeight: 500,
  justifyContent: "center",
  overflow: "hidden",
  padding: "0 4px",
  position: "absolute"
};
var spreadsheetFrozenCornerStyle = {
  ...spreadsheetFrozenHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  left: 0,
  top: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 2
};

// src/spreadsheet/spreadsheet-formula-values.ts
var DAY_MS3 = 864e5;
var EXCEL_SERIAL_EPOCH_UTC3 = Date.UTC(1899, 11, 30);
function spreadsheetSheetWithVolatileFormulaValues(sheet, sheets, today = /* @__PURE__ */ new Date(), sourceName = "") {
  if (!sheet) return sheet;
  const workbookIndex = workbookCellsBySheet(sheets);
  const rowsBySheet = workbookRowsBySheet(sheets);
  const sheetName = asString(sheet.name);
  const rowsByIndex = rowsBySheet.get(sheetName) ?? /* @__PURE__ */ new Map();
  let changed = false;
  const rows = asArray(sheet.rows).map((rowValue) => {
    const row = asRecord(rowValue);
    if (!row) return rowValue;
    let rowChanged = false;
    const cells = asArray(row.cells).map((cellValue) => {
      const cell = asRecord(cellValue);
      if (!cell) return cellValue;
      const formula = asString(cell.formula);
      const sourceNameValue = formulaWorkbookFilenameValue(formula, sourceName, asString(cell.value));
      if (sourceNameValue != null) {
        rowChanged = true;
        changed = true;
        return { ...cell, value: sourceNameValue };
      }
      if (!formulaShouldRefreshDisplayValue(cell, formula)) return cellValue;
      const value = evaluateVolatileFormula(formula, sheetName, workbookIndex, today) ?? evaluatePreviewFormula(formula, sheetName, rowsByIndex, rowsBySheet, cell);
      if (value == null) return cellValue;
      rowChanged = true;
      changed = true;
      return { ...cell, value };
    });
    return rowChanged ? { ...row, cells } : rowValue;
  });
  return changed ? { ...sheet, rows } : sheet;
}
function evaluateVolatileFormula(formula, currentSheetName, workbookIndex, today = /* @__PURE__ */ new Date()) {
  const normalized = formula.trim().replace(/^=/, "");
  const todaySerial = excelTodaySerial(today);
  const daysLeft = normalized.match(/^\$?([A-Z]+)\$?(\d+)\s*-\s*TODAY\(\)$/i);
  if (daysLeft) {
    const address = `${daysLeft[1]?.toUpperCase()}${daysLeft[2]}`;
    const dueDate = workbookCellNumber(workbookIndex, currentSheetName, address);
    return dueDate == null ? null : formatFormulaNumber(dueDate - todaySerial);
  }
  if (/^COUNTIFS\(/i.test(normalized) && /TODAY\(\)/i.test(normalized)) {
    const args = splitFormulaArgs(functionArgs(normalized));
    if (args.length < 2 || args.length % 2 !== 0) return null;
    const ranges = [];
    for (let index = 0; index < args.length; index += 2) {
      const range = workbookRangeValues(workbookIndex, currentSheetName, args[index] ?? "");
      if (range.length === 0) return null;
      ranges.push({ criteria: args[index + 1] ?? "", range });
    }
    const rowCount = Math.min(...ranges.map((item) => item.range.length));
    let count = 0;
    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      if (ranges.every((item) => criteriaMatches(item.range[rowOffset], item.criteria, todaySerial))) {
        count += 1;
      }
    }
    return String(count);
  }
  return null;
}
function evaluatePreviewFormula(formula, sheetName, rowsByIndex, rowsBySheet, cell) {
  const address = asString(cell.address);
  const rowIndex = rowIndexFromAddress(address);
  const columnIndex = columnIndexFromAddress(address);
  const value = conditionalFormulaValue(formula, {
    columnIndex,
    formulas: [formula],
    range: { startColumn: columnIndex, startRow: rowIndex },
    rowsByIndex,
    rowsBySheet,
    rowIndex,
    sheetName
  });
  return formulaDisplayValue(value, formula);
}
function workbookCellsBySheet(sheets) {
  const workbook = /* @__PURE__ */ new Map();
  for (const sheet of sheets) {
    const cells = /* @__PURE__ */ new Map();
    for (const row of asArray(sheet.rows)) {
      const rowRecord = asRecord(row);
      for (const cell of asArray(rowRecord?.cells)) {
        const cellRecord = asRecord(cell);
        const address = asString(cellRecord?.address).toUpperCase();
        if (cellRecord && address) cells.set(address, cellRecord);
      }
    }
    workbook.set(asString(sheet.name), cells);
  }
  return workbook;
}
function workbookRowsBySheet(sheets) {
  const workbook = /* @__PURE__ */ new Map();
  for (const sheet of sheets) {
    const rowsByIndex = /* @__PURE__ */ new Map();
    for (const row of asArray(sheet.rows)) {
      const rowRecord = asRecord(row);
      if (!rowRecord) continue;
      const rowIndex = asNumber(rowRecord.index, 1);
      const cells = /* @__PURE__ */ new Map();
      for (const cell of asArray(rowRecord.cells)) {
        const cellRecord = asRecord(cell);
        if (!cellRecord) continue;
        cells.set(columnIndexFromAddress(asString(cellRecord.address)), cellRecord);
      }
      rowsByIndex.set(rowIndex, cells);
    }
    workbook.set(asString(sheet.name), rowsByIndex);
  }
  return workbook;
}
function formulaNeedsVolatileEvaluation(formula) {
  return /\bTODAY\(\)/i.test(formula);
}
function formulaShouldRefreshDisplayValue(cell, formula) {
  if (!formula) return false;
  return formulaNeedsVolatileEvaluation(formula) || asString(cell.value).trim().length === 0;
}
function formulaWorkbookFilenameValue(formula, sourceName, value) {
  if (!sourceName || !/\bCELL\s*\(\s*"filename"/i.test(formula)) return null;
  const currentValue = value.trim();
  if (currentValue.length > 0 && currentValue !== "#NAME?") return null;
  const fileName = sourceName.split(/[\\/]/).pop() ?? sourceName;
  const firstDotIndex = fileName.indexOf(".");
  return firstDotIndex >= 0 ? fileName.slice(0, firstDotIndex) : fileName;
}
function formulaDisplayValue(value, formula) {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? formatFormulaNumber(value) : null;
  const text = asString(value);
  if (text.length === 0 && !formulaNeedsVolatileEvaluation(formula)) return null;
  return text;
}
function workbookCellNumber(workbookIndex, sheetName, address) {
  const cell = workbookIndex.get(sheetName)?.get(address.toUpperCase());
  if (!cell) return null;
  const value = Number(asString(cell.value).trim());
  return Number.isFinite(value) ? value : null;
}
function workbookCellText(workbookIndex, sheetName, address) {
  const cell = workbookIndex.get(sheetName)?.get(address.toUpperCase());
  return asString(cell?.value);
}
function workbookRangeValues(workbookIndex, currentSheetName, reference) {
  const { rangeReference, sheetName } = splitSheetReference(reference, currentSheetName);
  const range = parseCellRange(rangeReference);
  if (!range) return [];
  const values = [];
  for (let row = range.startRow; row < range.startRow + range.rowSpan; row += 1) {
    for (let column = range.startColumn; column < range.startColumn + range.columnSpan; column += 1) {
      values.push(workbookCellText(workbookIndex, sheetName, `${columnLabel(column)}${row}`));
    }
  }
  return values;
}
function splitSheetReference(reference, currentSheetName) {
  const separator = reference.lastIndexOf("!");
  if (separator < 0) return { rangeReference: reference.trim(), sheetName: currentSheetName };
  return {
    rangeReference: reference.slice(separator + 1).trim(),
    sheetName: reference.slice(0, separator).replace(/^'|'$/g, "").trim()
  };
}
function criteriaMatches(value, criteria, todaySerial) {
  const normalized = criteria.trim();
  const todayMatch = normalized.match(/^"([<>=]{1,2})"\s*&\s*TODAY\(\)$/i);
  if (todayMatch) {
    return compareValues(Number(value), todaySerial, todayMatch[1] ?? "=");
  }
  const literal = spreadsheetStringLiteral(normalized) ?? normalized;
  const operatorMatch = literal.match(/^(<>|>=|<=|=|>|<)(.*)$/);
  if (!operatorMatch) return String(value ?? "") === literal;
  const operator = operatorMatch[1] ?? "=";
  const expected = operatorMatch[2] ?? "";
  const actualNumber = Number(value);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return compareValues(actualNumber, expectedNumber, operator);
  }
  return compareText(String(value ?? ""), expected, operator);
}
function compareValues(actual, expected, operator) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (operator === "<") return actual < expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "<>") return actual !== expected;
  return actual === expected;
}
function compareText(actual, expected, operator) {
  if (operator === "<>") return actual !== expected;
  if (operator === "=") return actual === expected;
  return false;
}
function functionArgs(formula) {
  const open = formula.indexOf("(");
  const close = formula.lastIndexOf(")");
  return open >= 0 && close > open ? formula.slice(open + 1, close) : "";
}
function splitFormulaArgs(source) {
  const args = [];
  let current = "";
  let depth = 0;
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      current += char;
      if (inString && source[index + 1] === '"') {
        current += source[index + 1];
        index += 1;
      } else {
        inString = !inString;
      }
      continue;
    }
    if (!inString && char === "(") depth += 1;
    if (!inString && char === ")") depth = Math.max(0, depth - 1);
    if (!inString && depth === 0 && char === ",") {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) args.push(current.trim());
  return args;
}
function spreadsheetStringLiteral(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
  return trimmed.slice(1, -1).replace(/""/g, '"');
}
function excelTodaySerial(today) {
  const utc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((utc - EXCEL_SERIAL_EPOCH_UTC3) / DAY_MS3);
}
function formatFormulaNumber(value) {
  if (Number.isInteger(value)) return String(value);
  return Number(value.toPrecision(15)).toString();
}

// src/spreadsheet/spreadsheet-number-format.ts
var EXCEL_BUILT_IN_NUMBER_FORMATS = /* @__PURE__ */ new Map([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [5, "$#,##0;($#,##0)"],
  [6, "$#,##0;[Red]($#,##0)"],
  [7, "$#,##0.00;($#,##0.00)"],
  [8, "$#,##0.00;[Red]($#,##0.00)"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "m/d/yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0;(#,##0)"],
  [38, "#,##0;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"]
]);
function excelSerialMonthYearLabel(value) {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 864e5);
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "numeric" }).format(date);
}
function excelSerialDateLabel(value, formatCode = "") {
  const date = new Date(Date.UTC(1899, 11, 30) + value * 864e5);
  if (isExcelIsoDateFormat(formatCode)) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", timeZone: "UTC", year: "numeric" }).format(date);
}
function shouldFormatAsMonthSerial(cell, sheetName) {
  if (sheetName !== "03_TimeSeries") return false;
  const address = asString(cell?.address);
  return columnIndexFromAddress(address) === 0 && rowIndexFromAddress(address) >= 5;
}
function spreadsheetCellText(cell, styles, sheetName, styleIndex) {
  const text = cellText(cell);
  const address = asString(cell?.address);
  const rowIndex = rowIndexFromAddress(address);
  if (cell != null && cell.hasValue === false && !asString(cell.formula)) return "";
  const numericText = text.trim();
  if (numericText.length === 0) return text;
  const numberValue = Number(numericText);
  if (sheetName && rowIndex === 3 && Number.isFinite(numberValue)) return "";
  if (cell == null || !Number.isFinite(numberValue)) return text;
  const columnIndex = columnIndexFromAddress(address);
  const cellFormat = styleAt(styles?.cellXfs, styleIndex ?? cell.styleIndex);
  const numberFormatId = asNumber(cellFormat?.numFmtId, -1);
  const formatCode = spreadsheetNumberFormatCode(styles, numberFormatId);
  if (isExcelMonthYearFormat(formatCode)) return excelSerialMonthYearLabel(numberValue);
  if (isExcelTimeFormat(formatCode)) return excelSerialTimeLabel(numberValue, formatCode);
  if (isExcelDateFormat(formatCode)) return excelSerialDateLabel(numberValue, formatCode);
  if (shouldFormatAsMonthSerial(cell, sheetName)) return excelSerialMonthYearLabel(numberValue);
  if (sheetName === "03_TimeSeries") {
    if (columnIndex === 3) return `${Math.round(numberValue * 100)}%`;
    if ([7, 8, 9].includes(columnIndex)) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
    if ([4, 5].includes(columnIndex)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
  if (sheetName === "01_Dashboard") {
    if (columnIndex === 2) return `${Math.round(numberValue * 100)}%`;
    if (columnIndex === 3) return `$${Math.round(numberValue).toLocaleString("en-US")}`;
  }
  if (formatCode.includes("%")) return `${(numberValue * 100).toFixed(spreadsheetDecimalPlaces(formatCode))}%`;
  if (/e\+?0+/i.test(formatCode)) return spreadsheetScientificLabel(numberValue, formatCode);
  if (formatCode.includes("?/?")) return spreadsheetFractionLabel(numberValue, formatCode);
  if (formatCode.includes("$")) return spreadsheetCurrencyLabel(numberValue, formatCode);
  if (formatCode.includes("#,##0.00")) return spreadsheetNumberLabel(numberValue, formatCode);
  if (formatCode.includes("#,##0")) return spreadsheetNumberLabel(numberValue, formatCode);
  if (/^0\.0+$/.test(formatCode)) return numberValue.toFixed(formatCode.split(".")[1]?.length ?? 0);
  if (/\d+\.\d{4,}/.test(text)) return numberValue.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return text;
}
function spreadsheetNumberFormatCode(styles, numberFormatId) {
  const numberFormat = asArray(styles?.numberFormats).map(asRecord).find((format) => asNumber(format?.id, -2) === numberFormatId);
  const customFormat = asString(numberFormat?.formatCode);
  return customFormat || EXCEL_BUILT_IN_NUMBER_FORMATS.get(numberFormatId) || "";
}
function isExcelMonthYearFormat(formatCode) {
  const normalized = formatCode.toLowerCase();
  return normalized.includes("mmm") && normalized.includes("yy") && !/(^|[^a-z])d{1,4}([^a-z]|$)/.test(normalized);
}
function isExcelIsoDateFormat(formatCode) {
  return /y{2,4}[-/]m{1,2}[-/]d{1,2}/i.test(formatCode);
}
function isExcelDateFormat(formatCode) {
  const normalized = formatCode.toLowerCase();
  if (!/[dmy]/.test(normalized)) return false;
  if (normalized.includes("%")) return false;
  return /(^|[^a-z])m{1,4}([^a-z]|$)/.test(normalized) || /(^|[^a-z])d{1,4}([^a-z]|$)/.test(normalized) || /(^|[^a-z])y{2,4}([^a-z]|$)/.test(normalized);
}
function isExcelTimeFormat(formatCode) {
  const normalized = formatCode.toLowerCase();
  return /\[?h\]?:mm/.test(normalized) || /^mm:ss/.test(normalized);
}
function excelSerialTimeLabel(value, formatCode) {
  const normalized = formatCode.toLowerCase();
  const totalSeconds = Math.max(0, Math.round(value * 86400));
  const hoursTotal = Math.floor(totalSeconds / 3600);
  const hours = normalized.includes("[h]") ? hoursTotal : hoursTotal % 24;
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (normalized.includes("am/pm")) {
    const suffix = hours >= 12 ? "PM" : "AM";
    const hour12 = hours % 12 || 12;
    const withSeconds = normalized.includes(":ss");
    return `${hour12}:${String(minutes).padStart(2, "0")}${withSeconds ? `:${String(seconds).padStart(2, "0")}` : ""} ${suffix}`;
  }
  if (/^mm:ss/.test(normalized)) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (normalized.includes(":ss")) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
function spreadsheetDecimalPlaces(formatCode) {
  return formatCode.match(/\.([0#]+)/)?.[1]?.length ?? 0;
}
function spreadsheetScientificLabel(value, formatCode) {
  const decimals = spreadsheetDecimalPlaces(formatCode);
  return value.toExponential(decimals).replace("e", "E").replace(/E\+?(-?\d+)$/, (_match, exponent) => {
    const numericExponent = Number(exponent);
    const sign = numericExponent < 0 ? "-" : "+";
    return `E${sign}${String(Math.abs(numericExponent)).padStart(2, "0")}`;
  });
}
function spreadsheetFractionLabel(value, formatCode) {
  const denominatorLimit = formatCode.includes("??/??") ? 99 : 9;
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  let bestNumerator = 0;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let denominator = 1; denominator <= denominatorLimit; denominator += 1) {
    const numerator = Math.round(fraction * denominator);
    const error = Math.abs(fraction - numerator / denominator);
    if (error < bestError) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }
  if (bestNumerator === 0) return `${sign}${whole}`;
  if (bestNumerator === bestDenominator) return `${sign}${whole + 1}`;
  return `${sign}${whole > 0 ? `${whole} ` : ""}${bestNumerator}/${bestDenominator}`;
}
function spreadsheetCurrencyLabel(value, formatCode) {
  const section = spreadsheetNumberFormatSection(value, formatCode);
  const decimals = spreadsheetDecimalPlaces(section);
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
  if (value < 0 && section.includes("(")) return `($${formatted})`;
  return `${value < 0 ? "-" : ""}$${formatted}`;
}
function spreadsheetNumberLabel(value, formatCode) {
  const section = spreadsheetNumberFormatSection(value, formatCode);
  const decimals = spreadsheetDecimalPlaces(section);
  const absolute = Math.abs(value);
  const formatted = absolute.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
  if (value < 0 && section.includes("(")) return `(${formatted})`;
  return `${value < 0 ? "-" : ""}${formatted}`;
}
function spreadsheetNumberFormatSection(value, formatCode) {
  const sections = formatCode.split(";").map((section) => section.replace(/\[[^\]]+\]/g, ""));
  if (value < 0 && sections[1]) return sections[1];
  if (value === 0 && sections[2]) return sections[2];
  return sections[0] ?? formatCode;
}

// src/spreadsheet/spreadsheet-selection.ts
function spreadsheetSelectionFromViewportPoint(layout, point, scroll) {
  const hit = spreadsheetHitCellAtViewportPoint(layout, point, scroll);
  if (!hit) return null;
  return spreadsheetNormalizeSelection(layout, hit);
}
function spreadsheetNormalizeSelection(layout, selection) {
  const clamped = spreadsheetClampSelection(layout, selection);
  const mergeStart = spreadsheetMergeStartForCell(layout, clamped.rowIndex, clamped.columnIndex);
  return mergeStart ?? clamped;
}
function spreadsheetMoveSelection(layout, selection, direction) {
  const current = spreadsheetNormalizeSelection(layout, selection ?? { columnIndex: 0, rowIndex: 1, rowOffset: 0 });
  const key = spreadsheetCellKey(current.rowIndex, current.columnIndex);
  const merge = layout.mergeByStart.get(key);
  const columnSpan = merge?.columnSpan ?? 1;
  const rowSpan = merge?.rowSpan ?? 1;
  if (direction === "left") {
    return spreadsheetNormalizeSelection(layout, {
      columnIndex: current.columnIndex - 1,
      rowIndex: current.rowIndex,
      rowOffset: current.rowOffset
    });
  }
  if (direction === "right") {
    return spreadsheetNormalizeSelection(layout, {
      columnIndex: current.columnIndex + columnSpan,
      rowIndex: current.rowIndex,
      rowOffset: current.rowOffset
    });
  }
  if (direction === "up") {
    return spreadsheetNormalizeSelection(layout, {
      columnIndex: current.columnIndex,
      rowIndex: current.rowIndex - 1,
      rowOffset: current.rowOffset - 1
    });
  }
  return spreadsheetNormalizeSelection(layout, {
    columnIndex: current.columnIndex,
    rowIndex: current.rowIndex + rowSpan,
    rowOffset: current.rowOffset + rowSpan
  });
}
function spreadsheetClampSelection(layout, selection) {
  const columnIndex = clampIndex(selection.columnIndex, Math.max(0, layout.columnCount - 1));
  const rowOffset = clampIndex(selection.rowOffset, Math.max(0, layout.rowCount - 1));
  const rowIndex = clampIndex(selection.rowIndex, layout.rowCount, 1);
  return {
    columnIndex,
    rowIndex,
    rowOffset
  };
}
function spreadsheetMergeStartForCell(layout, rowIndex, columnIndex) {
  const ownKey = spreadsheetCellKey(rowIndex, columnIndex);
  if (layout.mergeByStart.has(ownKey)) {
    return {
      columnIndex,
      rowIndex,
      rowOffset: rowIndex - 1
    };
  }
  if (!layout.coveredCells.has(ownKey)) return null;
  for (const merge of layout.mergeByStart.values()) {
    const rowEnd = merge.startRow + merge.rowSpan - 1;
    const columnEnd = merge.startColumn + merge.columnSpan - 1;
    if (rowIndex >= merge.startRow && rowIndex <= rowEnd && columnIndex >= merge.startColumn && columnIndex <= columnEnd) {
      return {
        columnIndex: merge.startColumn,
        rowIndex: merge.startRow,
        rowOffset: merge.startRow - 1
      };
    }
  }
  return null;
}
function spreadsheetSelectionWorldRect(layout, selection) {
  const key = spreadsheetCellKey(selection.rowIndex, selection.columnIndex);
  const merge = layout.mergeByStart.get(key);
  const left = spreadsheetColumnLeft(layout, selection.columnIndex);
  const top = spreadsheetRowTop(layout, selection.rowOffset);
  return {
    height: spreadsheetRowTop(layout, selection.rowOffset + (merge?.rowSpan ?? 1)) - top,
    left,
    top,
    width: spreadsheetColumnLeft(layout, selection.columnIndex + (merge?.columnSpan ?? 1)) - left
  };
}
function spreadsheetFrozenSelectionSegments(layout, selection, scroll) {
  return spreadsheetViewportRectSegments(layout, spreadsheetSelectionWorldRect(layout, selection), scroll);
}
function clampIndex(value, max, min = 0) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

// src/spreadsheet/spreadsheet-interaction.ts
function viewportPointFromPointer(event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top
  };
}
function spreadsheetSelectionKey(selection) {
  return `${selection.rowIndex}:${selection.columnIndex}`;
}
function spreadsheetEditorForSelection(activeSheet, styles, cellEdits, selection) {
  const sheetName = asString(activeSheet?.name);
  const cell = cellAt2(activeSheet, selection.rowIndex, selection.columnIndex);
  const key = spreadsheetSelectionKey(selection);
  return {
    selection,
    value: cellEdits[key] ?? spreadsheetCellText(cell, styles, sheetName)
  };
}
function commitSpreadsheetEditor(editor, setCellEdits, setEditor) {
  const key = spreadsheetSelectionKey(editor.selection);
  setCellEdits((current) => ({
    ...current,
    [key]: editor.value
  }));
  setEditor(null);
}
function spreadsheetSelectionDirectionFromKey(key, shiftKey = false) {
  if (key === "ArrowDown" || key === "Enter") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight" || key === "Tab") return shiftKey ? "left" : "right";
  if (key === "ArrowUp") return "up";
  return null;
}
function scrollSpreadsheetSelectionIntoView(viewport2, layout, selection) {
  const rect = spreadsheetSelectionWorldRect(layout, selection);
  const margin = 16;
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  if (rect.left < viewport2.scrollLeft + SPREADSHEET_ROW_HEADER_WIDTH) {
    viewport2.scrollLeft = Math.max(0, rect.left - SPREADSHEET_ROW_HEADER_WIDTH - margin);
  } else if (right > viewport2.scrollLeft + viewport2.clientWidth) {
    viewport2.scrollLeft = Math.max(0, right - viewport2.clientWidth + margin);
  }
  if (rect.top < viewport2.scrollTop + SPREADSHEET_COLUMN_HEADER_HEIGHT) {
    viewport2.scrollTop = Math.max(0, rect.top - SPREADSHEET_COLUMN_HEADER_HEIGHT - margin);
  } else if (bottom > viewport2.scrollTop + viewport2.clientHeight) {
    viewport2.scrollTop = Math.max(0, bottom - viewport2.clientHeight + margin);
  }
}
function spreadsheetResizeCursor(axis) {
  return axis === "column" ? "col-resize" : "row-resize";
}
function applySpreadsheetInteractiveSizeOverride(current, axis, index, size) {
  const bucket = axis === "column" ? "columnWidths" : "rowHeights";
  if (current[bucket]?.[index] === size) return current;
  return {
    ...current,
    [bucket]: {
      ...current[bucket],
      [index]: size
    }
  };
}
function visibleFloatingSpecs(specs, viewportSize, viewportScroll) {
  if (viewportSize.width <= 0 || viewportSize.height <= 0) return specs;
  const overscan = 240;
  const viewportLeft = viewportScroll.left - overscan;
  const viewportTop = viewportScroll.top - overscan;
  const viewportRight = viewportScroll.left + viewportSize.width + overscan;
  const viewportBottom = viewportScroll.top + viewportSize.height + overscan;
  return specs.filter((spec) => {
    const rectRight = spec.left + spec.width;
    const rectBottom = spec.top + spec.height;
    return rectRight >= viewportLeft && spec.left <= viewportRight && rectBottom >= viewportTop && spec.top <= viewportBottom;
  });
}

// src/spreadsheet/spreadsheet-resize.ts
var RESIZE_HIT_SLOP_PX = 5;
var MIN_COLUMN_WIDTH_PX = 24;
var MAX_COLUMN_WIDTH_PX = 560;
var MIN_ROW_HEIGHT_PX = 12;
var MAX_ROW_HEIGHT_PX = 240;
function spreadsheetResizeHitAtViewportPoint(layout, point, scroll, slopPx = RESIZE_HIT_SLOP_PX) {
  const world = spreadsheetViewportPointToWorld(layout, point, scroll);
  if (point.y >= 0 && point.y <= SPREADSHEET_COLUMN_HEADER_HEIGHT && world.x >= SPREADSHEET_ROW_HEADER_WIDTH) {
    const boundaryIndex = nearestResizeBoundary(layout.columnOffsets, world.x, slopPx);
    if (boundaryIndex > 0 && boundaryIndex <= layout.columnCount) {
      const index = boundaryIndex - 1;
      return {
        axis: "column",
        boundary: layout.columnOffsets[boundaryIndex] ?? world.x,
        index,
        originalSize: layout.columnWidths[index] ?? SPREADSHEET_DEFAULT_COLUMN_WIDTH
      };
    }
  }
  if (point.x >= 0 && point.x <= SPREADSHEET_ROW_HEADER_WIDTH && world.y >= SPREADSHEET_COLUMN_HEADER_HEIGHT) {
    const boundaryIndex = nearestResizeBoundary(layout.rowOffsets, world.y, slopPx);
    if (boundaryIndex > 0 && boundaryIndex <= layout.rowCount) {
      const index = boundaryIndex - 1;
      return {
        axis: "row",
        boundary: layout.rowOffsets[boundaryIndex] ?? world.y,
        index,
        originalSize: layout.rowHeights[index] ?? SPREADSHEET_DEFAULT_ROW_HEIGHT
      };
    }
  }
  return null;
}
function spreadsheetResizeDragFromHit(layout, hit, point, scroll) {
  const world = spreadsheetViewportPointToWorld(layout, point, scroll);
  return {
    ...hit,
    startWorldPosition: hit.axis === "column" ? world.x : world.y
  };
}
function spreadsheetResizeSizeFromPoint(layout, drag, point, scroll) {
  const world = spreadsheetViewportPointToWorld(layout, point, scroll);
  const currentPosition = drag.axis === "column" ? world.x : world.y;
  return clampSpreadsheetResizeSize(drag.axis, drag.originalSize + currentPosition - drag.startWorldPosition);
}
function clampSpreadsheetResizeSize(axis, size) {
  if (!Number.isFinite(size)) return axis === "column" ? SPREADSHEET_DEFAULT_COLUMN_WIDTH : SPREADSHEET_DEFAULT_ROW_HEIGHT;
  if (axis === "column") return Math.max(MIN_COLUMN_WIDTH_PX, Math.min(MAX_COLUMN_WIDTH_PX, Math.round(size)));
  return Math.max(MIN_ROW_HEIGHT_PX, Math.min(MAX_ROW_HEIGHT_PX, Math.round(size)));
}
function nearestResizeBoundary(offsets, worldPosition, slopPx) {
  if (offsets.length <= 1) return -1;
  const insertion = lowerBound(offsets, worldPosition);
  const candidates = [insertion, insertion - 1, insertion + 1];
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    if (index <= 0 || index >= offsets.length) continue;
    const distance = Math.abs((offsets[index] ?? worldPosition) - worldPosition);
    if (distance <= slopPx && distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}
function lowerBound(values, value) {
  let left = 0;
  let right = values.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if ((values[middle] ?? 0) < value) left = middle + 1;
    else right = middle;
  }
  return left;
}

// src/spreadsheet/spreadsheet-shapes.tsx
import { jsx as jsx12, jsxs as jsxs8 } from "react/jsx-runtime";
function buildSpreadsheetShapes({
  activeSheet,
  layout,
  shapes,
  slicerCaches = []
}) {
  return [
    ...buildSheetDrawingShapes(activeSheet, layout),
    ...buildSheetSlicerShapes(activeSheet, layout, slicerCaches),
    ...buildRootSpreadsheetShapes(activeSheet, layout, shapes)
  ];
}
function buildSpreadsheetImages({
  activeSheet,
  imageSources,
  layout
}) {
  return asArray(activeSheet?.drawings).map(asRecord).filter((drawing) => drawing != null).map((drawing, index) => imageFromSheetDrawing(drawing, imageSources, layout, index)).filter((image) => image != null);
}
function buildSheetDrawingShapes(activeSheet, layout) {
  return asArray(activeSheet?.drawings).map(asRecord).filter((drawing) => drawing != null).map((drawing, index) => shapeFromSheetDrawing(drawing, layout, index)).filter((shape) => shape != null);
}
function buildSheetSlicerShapes(activeSheet, layout, slicerCaches) {
  const existingKeys = new Set(
    asArray(activeSheet?.drawings).map(asRecord).map((drawing) => asRecord(drawing?.shape)).filter((shape) => shape != null).flatMap((shape) => [asString(shape.id), asString(shape.name), asString(shape.text)]).filter(Boolean)
  );
  return asArray(activeSheet?.slicers).map(asRecord).filter((slicer) => slicer != null).filter((slicer) => {
    const name = asString(slicer.name);
    const caption = asString(slicer.caption);
    return !existingKeys.has(name) && !existingKeys.has(caption);
  }).map((slicer, index) => slicerShapeFromRecord(slicer, layout, index, slicerCaches));
}
function slicerShapeFromRecord(slicer, layout, index, slicerCaches) {
  const bounds = spreadsheetDrawingBounds(layout, slicer);
  const caption = asString(slicer.caption) || asString(slicer.name) || "Slicer";
  const cache = slicerCacheForRecord(slicer, slicerCaches);
  const items = cache ? slicerCacheItemLabels(cache).slice(0, 8) : [];
  const text = items.length > 0 ? [caption, ...items].join("\n") : caption;
  return {
    fill: "#ffffff",
    geometry: "roundRect",
    height: bounds.height,
    id: asString(slicer.name) || `slicer-${index}`,
    left: bounds.left,
    line: "#94a3b8",
    lineWidth: 1,
    text,
    top: bounds.top,
    width: bounds.width,
    zIndex: 5e3 + index
  };
}
function slicerCacheForRecord(slicer, slicerCaches) {
  const cacheKey = asString(slicer.cache) || asString(slicer.cacheName) || asString(slicer.name);
  const cacheId = asNumber(slicer.cacheId, Number.NaN);
  return slicerCaches.find((cache) => {
    const names = [
      asString(cache.name),
      asString(cache.caption),
      asString(cache.sourceName),
      asString(cache.cache),
      asString(cache.cacheName)
    ];
    if (cacheKey && names.includes(cacheKey)) return true;
    return Number.isFinite(cacheId) && asNumber(cache.id, Number.NaN) === cacheId;
  }) ?? null;
}
function slicerCacheItemLabels(cache) {
  return asArray(cache.items).map(asRecord).filter((item) => item != null).map((item) => {
    const label = asString(item.value) || asString(item.caption) || asString(item.name) || asString(item.x);
    if (!label) return "";
    const inactive = item.selected === false || item.disabled === true || item.noData === true;
    return `${inactive ? "- " : "* "}${label}`;
  }).filter(Boolean);
}
function shapeFromSheetDrawing(drawing, layout, index) {
  const shapeElement = asRecord(drawing.shape);
  if (!shapeElement) return null;
  const shape = asRecord(shapeElement.shape) ?? shapeElement;
  const line = asRecord(shape.line);
  const bounds = spreadsheetDrawingBounds(layout, drawing);
  const boxShadow = spreadsheetShapeBoxShadow(shapeElement);
  return {
    ...boxShadow ? { boxShadow } : {},
    fill: nestedProtocolColor(shape.fill) ?? "#ffffff",
    geometry: asNumber(shape.geometry, 0),
    height: bounds.height,
    id: asString(shapeElement.id) || asString(shapeElement.name) || `sheet-shape-${index}`,
    left: bounds.left,
    line: nestedProtocolColor(line?.fill) ?? "#cbd5e1",
    lineWidth: Math.max(1, Math.min(4, spreadsheetEmuToPx(line?.widthEmu))),
    text: asString(shapeElement.text),
    top: bounds.top,
    width: bounds.width,
    zIndex: index
  };
}
function imageFromSheetDrawing(drawing, imageSources, layout, zIndex) {
  const imageId = imageReferenceId(drawing.imageReference);
  const src = imageId ? imageSources.get(imageId) : void 0;
  if (!imageId || !src) return null;
  const bounds = spreadsheetDrawingBounds(layout, drawing);
  return {
    height: bounds.height,
    id: imageId,
    left: bounds.left,
    src,
    top: bounds.top,
    width: bounds.width,
    zIndex
  };
}
function buildRootSpreadsheetShapes(activeSheet, layout, shapes) {
  const sheetName = asString(activeSheet?.name);
  return shapes.filter((shape) => asString(shape.sheetName) === sheetName).map((shape, index) => {
    const fromCol = asNumber(shape.fromCol, 0);
    const fromRow = asNumber(shape.fromRow, 0);
    const left = spreadsheetColumnLeft(layout, fromCol) + spreadsheetEmuToPx(shape.fromColOffsetEmu);
    const top = spreadsheetRowTop(layout, fromRow) + spreadsheetEmuToPx(shape.fromRowOffsetEmu);
    const width = Math.max(24, spreadsheetEmuToPx(shape.widthEmu));
    const height = Math.max(24, spreadsheetEmuToPx(shape.heightEmu));
    return {
      fill: protocolColorToCss(shape.fillColor) ?? "#ffffff",
      geometry: asString(shape.geometry),
      height,
      id: asString(shape.id) || `shape-${index}`,
      left,
      line: protocolColorToCss(shape.lineColor) ?? "#cbd5e1",
      lineWidth: 1,
      text: asString(shape.text),
      top,
      width,
      zIndex: 1e4 + index
    };
  });
}
function nestedProtocolColor(value) {
  const record = asRecord(value);
  return protocolColorToCss(record?.color ?? value);
}
function shapeBorderRadius(geometry) {
  if (geometry === 26 || geometry === "roundRect") return 18;
  if (geometry === 35 || geometry === "ellipse") return "999px";
  return 0;
}
function isRightTriangleGeometry(geometry) {
  return geometry === 4 || geometry === "rtTriangle";
}
function SpreadsheetShapeLayer({ shapes }) {
  if (shapes.length === 0) return null;
  return /* @__PURE__ */ jsx12("div", { "aria-hidden": "true", style: { inset: 0, pointerEvents: "none", position: "absolute" }, children: shapes.map((shape) => /* @__PURE__ */ jsx12(SpreadsheetShapeView, { shape }, shape.id)) });
}
function SpreadsheetShapeView({ shape }) {
  if (isRightTriangleGeometry(shape.geometry)) {
    return /* @__PURE__ */ jsx12(SpreadsheetRightTriangleShape, { shape });
  }
  return /* @__PURE__ */ jsx12(
    "div",
    {
      "data-office-shape": shape.id,
      style: {
        alignItems: "center",
        background: shape.fill,
        borderColor: shape.line,
        borderRadius: shapeBorderRadius(shape.geometry),
        borderStyle: "solid",
        borderWidth: shape.lineWidth,
        boxShadow: shape.boxShadow,
        color: "#0f172a",
        display: "flex",
        fontFamily: SPREADSHEET_FONT_FAMILY,
        fontSize: 13,
        height: shape.height,
        justifyContent: "center",
        left: shape.left,
        lineHeight: 1.35,
        overflow: "hidden",
        padding: 12,
        position: "absolute",
        textAlign: "center",
        top: shape.top,
        whiteSpace: "pre-wrap",
        width: shape.width,
        zIndex: shape.zIndex
      },
      children: shape.text
    }
  );
}
function SpreadsheetRightTriangleShape({ shape }) {
  const halfStroke = Math.max(0.5, shape.lineWidth / 2);
  const points = [
    `${halfStroke},${halfStroke}`,
    `${halfStroke},${Math.max(halfStroke, shape.height - halfStroke)}`,
    `${Math.max(halfStroke, shape.width - halfStroke)},${Math.max(halfStroke, shape.height - halfStroke)}`
  ].join(" ");
  return /* @__PURE__ */ jsxs8(
    "svg",
    {
      "data-office-shape": shape.id,
      height: shape.height,
      style: {
        boxShadow: shape.boxShadow,
        height: shape.height,
        left: shape.left,
        overflow: "visible",
        position: "absolute",
        top: shape.top,
        width: shape.width,
        zIndex: shape.zIndex
      },
      viewBox: `0 0 ${shape.width} ${shape.height}`,
      width: shape.width,
      children: [
        /* @__PURE__ */ jsx12(
          "polygon",
          {
            fill: shape.fill,
            points,
            stroke: shape.line,
            strokeLinejoin: "round",
            strokeWidth: shape.lineWidth,
            vectorEffect: "non-scaling-stroke"
          }
        ),
        shape.text ? /* @__PURE__ */ jsx12("foreignObject", { height: shape.height, width: shape.width, x: 0, y: 0, children: /* @__PURE__ */ jsx12(
          "div",
          {
            style: {
              alignItems: "center",
              color: "#0f172a",
              display: "flex",
              fontFamily: SPREADSHEET_FONT_FAMILY,
              fontSize: 13,
              height: "100%",
              justifyContent: "center",
              lineHeight: 1.35,
              padding: 12,
              textAlign: "center",
              whiteSpace: "pre-wrap",
              width: "100%"
            },
            children: shape.text
          }
        ) }) : null
      ]
    }
  );
}
function spreadsheetShapeBoxShadow(element) {
  for (const effect of asArray(element.effects)) {
    const shadow = asRecord(asRecord(effect)?.shadow);
    const color = protocolColorToCss(shadow?.color);
    if (!shadow || !color || cssColorAlpha(color) <= 0) {
      continue;
    }
    const distance = spreadsheetEmuToPx(shadow.distance);
    const direction = asNumber(shadow.direction) / 6e4 / 180 * Math.PI;
    const offsetX = Math.cos(direction) * distance;
    const offsetY = Math.sin(direction) * distance;
    const blur = Math.max(0, spreadsheetEmuToPx(shadow.blurRadius));
    return `${formatCssPx2(offsetX)} ${formatCssPx2(offsetY)} ${formatCssPx2(blur)} ${color}`;
  }
  return void 0;
}
function formatCssPx2(value) {
  const rounded = Math.abs(value) < 0.01 ? 0 : Math.round(value * 100) / 100;
  return `${rounded}px`;
}
function cssColorAlpha(value) {
  const channels = parseCssColorChannels(value);
  if (!channels || channels[3] == null) return 1;
  const alpha = Number(channels[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}
function parseCssColorChannels(value) {
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open < 0 || close <= open) return null;
  const functionName = value.slice(0, open).trim().toLowerCase();
  if (functionName !== "rgb" && functionName !== "rgba") return null;
  const channels = value.slice(open + 1, close).split(",").map((channel) => channel.trim());
  return channels.length >= 3 ? channels : null;
}
function SpreadsheetImageLayer({ images }) {
  if (images.length === 0) return null;
  return /* @__PURE__ */ jsx12("div", { "aria-hidden": "true", style: { inset: 0, pointerEvents: "none", position: "absolute" }, children: images.map((image) => /* @__PURE__ */ jsx12(
    "div",
    {
      "data-office-image": image.id,
      style: {
        backgroundImage: `url("${image.src}")`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "100% 100%",
        display: "block",
        height: image.height,
        left: image.left,
        position: "absolute",
        top: image.top,
        width: image.width,
        zIndex: image.zIndex
      }
    },
    image.id
  )) });
}

// src/spreadsheet/spreadsheet-table-filters.ts
function buildSpreadsheetTableFilterTargets(sheet) {
  const targets = [];
  const tables = asArray(sheet?.tables).map(asRecord).filter((table) => table != null);
  for (const table of tables) {
    if (!spreadsheetTableHasFilter(table)) continue;
    const reference = asString(table.reference) || asString(table.ref) || asString(asRecord(table.autoFilter)?.reference);
    const range = parseCellRange(reference);
    if (!range) continue;
    const headerRowCount = Math.max(1, asNumber(table.headerRowCount, 1));
    const totalsRowCount = Math.max(0, asNumber(table.totalsRowCount, table.totalsRowShown === true ? 1 : 0));
    const headerRowIndex = range.startRow + headerRowCount - 1;
    const bodyStartRow = headerRowIndex + 1;
    const bodyEndRow = Math.max(bodyStartRow, range.startRow + range.rowSpan - totalsRowCount);
    const tableName = asString(table.displayName) || asString(table.name) || reference;
    const columns = asArray(table.columns).map(asRecord);
    for (let offset = 0; offset < range.columnSpan; offset += 1) {
      const columnIndex = range.startColumn + offset;
      const column = columns[offset];
      targets.push({
        bodyEndRow,
        bodyStartRow,
        columnIndex,
        columnName: asString(column?.name) || spreadsheetHeaderCellText(sheet, headerRowIndex, columnIndex) || columnLabel(columnIndex),
        headerRowIndex,
        id: `${tableName}:${columnIndex}`,
        tableName
      });
    }
  }
  return targets;
}
function spreadsheetTableFilterTargetAt(targets, rowIndex, columnIndex) {
  return targets.find((target) => target.headerRowIndex === rowIndex && target.columnIndex === columnIndex) ?? null;
}
function spreadsheetTableFilterValues(sheet, target, textProvider = defaultSpreadsheetTableFilterText) {
  const rows = spreadsheetRowsByIndex(sheet);
  const values = /* @__PURE__ */ new Map();
  for (let rowIndex = target.bodyStartRow; rowIndex < target.bodyEndRow; rowIndex += 1) {
    const value = normalizeSpreadsheetFilterValue(textProvider(rows.get(rowIndex)?.get(target.columnIndex) ?? null, rowIndex, target.columnIndex));
    const current = values.get(value);
    if (current) {
      current.count += 1;
    } else {
      values.set(value, {
        count: 1,
        label: value || "(Blanks)",
        value
      });
    }
  }
  return Array.from(values.values());
}
function spreadsheetTableFilterRowHeightOverrides(sheet, filters, textProvider = defaultSpreadsheetTableFilterText) {
  const activeTargets = buildSpreadsheetTableFilterTargets(sheet).filter((target) => {
    const selected = filters[target.id];
    return selected != null;
  });
  if (activeTargets.length === 0) return {};
  const rows = spreadsheetRowsByIndex(sheet);
  const overrides = {};
  for (const target of activeTargets) {
    const selected = new Set(filters[target.id] ?? []);
    for (let rowIndex = target.bodyStartRow; rowIndex < target.bodyEndRow; rowIndex += 1) {
      const rowOffset = rowIndex - 1;
      if (overrides[rowOffset] === 0) continue;
      const value = normalizeSpreadsheetFilterValue(textProvider(rows.get(rowIndex)?.get(target.columnIndex) ?? null, rowIndex, target.columnIndex));
      if (!selected.has(value)) overrides[rowOffset] = 0;
    }
  }
  return overrides;
}
function spreadsheetTableFilterActiveKeys(targets, filters) {
  const keys = /* @__PURE__ */ new Set();
  for (const target of targets) {
    if (filters[target.id] == null) continue;
    keys.add(`${target.headerRowIndex}:${target.columnIndex}`);
  }
  return keys;
}
function spreadsheetTableFilterSelectionForToggle(currentSelection, allValues, toggledValue) {
  const selected = new Set(currentSelection ?? allValues);
  if (selected.has(toggledValue)) selected.delete(toggledValue);
  else selected.add(toggledValue);
  const next = allValues.filter((value) => selected.has(value));
  return next.length === allValues.length ? void 0 : next;
}
function mergeSpreadsheetLayoutOverrides(base, next) {
  return {
    columnWidths: {
      ...base.columnWidths,
      ...next.columnWidths
    },
    rowHeights: {
      ...base.rowHeights,
      ...next.rowHeights
    }
  };
}
function spreadsheetTableHasFilter(table) {
  return table.showFilterButton === true || asRecord(table.autoFilter) != null;
}
function spreadsheetHeaderCellText(sheet, rowIndex, columnIndex) {
  return cellText(spreadsheetRowsByIndex(sheet).get(rowIndex)?.get(columnIndex) ?? null).trim();
}
function spreadsheetRowsByIndex(sheet) {
  const rows = /* @__PURE__ */ new Map();
  for (const row of asArray(sheet?.rows).map(asRecord).filter((row2) => row2 != null)) {
    const rowIndex = asNumber(row.index, 1);
    const cells = /* @__PURE__ */ new Map();
    for (const cell of asArray(row.cells).map(asRecord).filter((cell2) => cell2 != null)) {
      const address = asString(cell.address);
      const match = /^([A-Z]+)(\d+)$/i.exec(address);
      if (!match) continue;
      cells.set(columnIndexFromLetters(match[1] ?? ""), cell);
    }
    rows.set(rowIndex, cells);
  }
  return rows;
}
function defaultSpreadsheetTableFilterText(cell) {
  return cellText(cell);
}
function normalizeSpreadsheetFilterValue(value) {
  return value.trim();
}
function columnIndexFromLetters(letters) {
  let value = 0;
  for (const letter of letters.toUpperCase()) {
    const code = letter.charCodeAt(0);
    if (code < 65 || code > 90) continue;
    value = value * 26 + code - 64;
  }
  return Math.max(0, value - 1);
}

// src/spreadsheet/spreadsheet-table-filter-menu.tsx
import { useEffect as useEffect4, useRef as useRef4 } from "react";
import { jsx as jsx13, jsxs as jsxs9 } from "react/jsx-runtime";
function SpreadsheetTableFilterMenu({
  anchor,
  onClear,
  onClose,
  onToggle,
  selectedValues,
  target,
  values
}) {
  const menuRef = useRef4(null);
  useEffect4(() => {
    const handlePointerDown = (event) => {
      const node = event.target;
      if (node instanceof Node && menuRef.current?.contains(node)) return;
      onClose();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);
  const selected = new Set(selectedValues ?? values.map((item) => item.value));
  return /* @__PURE__ */ jsxs9(
    "div",
    {
      "data-testid": "spreadsheet-filter-menu",
      onPointerDown: (event) => event.stopPropagation(),
      ref: menuRef,
      style: {
        background: "#ffffff",
        borderColor: "#d7dde5",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxShadow: "0 18px 38px rgba(15, 23, 42, 0.18)",
        color: "#0f172a",
        fontFamily: SPREADSHEET_FONT_FAMILY,
        fontSize: 12,
        left: Math.max(8, anchor.left - 206),
        minWidth: 220,
        overflow: "hidden",
        position: "absolute",
        top: anchor.top + anchor.height + 4,
        zIndex: 5e4
      },
      children: [
        /* @__PURE__ */ jsx13("div", { style: { borderBottom: "1px solid #e2e8f0", fontWeight: 700, padding: "8px 10px" }, children: target.columnName }),
        /* @__PURE__ */ jsx13(
          "button",
          {
            onClick: onClear,
            style: {
              background: "transparent",
              border: 0,
              borderBottom: "1px solid #e2e8f0",
              color: "#2563eb",
              cursor: "pointer",
              display: "block",
              font: "inherit",
              padding: "7px 10px",
              textAlign: "left",
              width: "100%"
            },
            type: "button",
            children: "Clear filter"
          }
        ),
        /* @__PURE__ */ jsx13("div", { style: { maxHeight: 260, overflow: "auto", padding: "6px 0" }, children: values.map((item) => /* @__PURE__ */ jsxs9(
          "label",
          {
            style: {
              alignItems: "center",
              cursor: "pointer",
              display: "flex",
              gap: 8,
              padding: "5px 10px"
            },
            children: [
              /* @__PURE__ */ jsx13(
                "input",
                {
                  checked: selected.has(item.value),
                  onChange: () => onToggle(item.value, values),
                  type: "checkbox"
                }
              ),
              /* @__PURE__ */ jsx13("span", { style: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: item.label }),
              /* @__PURE__ */ jsx13("span", { style: { color: "#64748b", fontVariantNumeric: "tabular-nums" }, children: item.count })
            ]
          },
          item.value
        )) })
      ]
    }
  );
}

// src/spreadsheet/spreadsheet-viewport-store.ts
import { useMemo as useMemo3, useSyncExternalStore } from "react";
var EMPTY_VIEWPORT_STATE = {
  scroll: { left: 0, top: 0 },
  size: { height: 0, width: 0 }
};
function createSpreadsheetViewportStore() {
  let snapshot = EMPTY_VIEWPORT_STATE;
  let pending = null;
  let frame = null;
  const listeners = /* @__PURE__ */ new Set();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const apply = (next) => {
    if (spreadsheetViewportStateEquals(snapshot, next)) return;
    snapshot = next;
    emit();
  };
  const flush = () => {
    frame = null;
    const next = pending;
    pending = null;
    if (next) apply(next);
  };
  const cancelPending = () => {
    pending = null;
    if (frame != null && typeof window !== "undefined") {
      window.cancelAnimationFrame(frame);
    }
    frame = null;
  };
  return {
    cancelPending,
    destroy: () => {
      cancelPending();
      listeners.clear();
    },
    getSnapshot: () => snapshot,
    reset: () => {
      cancelPending();
      apply(EMPTY_VIEWPORT_STATE);
    },
    schedule: (next) => {
      pending = next;
      if (typeof window === "undefined") {
        flush();
        return;
      }
      if (frame == null) {
        frame = window.requestAnimationFrame(flush);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
function useSpreadsheetViewportStore() {
  const store = useMemo3(() => createSpreadsheetViewportStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { state, store };
}
function spreadsheetViewportStateEquals(left, right) {
  return left.scroll.left === right.scroll.left && left.scroll.top === right.scroll.top && left.size.height === right.size.height && left.size.width === right.size.width;
}

// src/spreadsheet/spreadsheet-workbook-chrome.tsx
import { jsx as jsx14, jsxs as jsxs10 } from "react/jsx-runtime";
function SpreadsheetWorkbookBar({ title }) {
  return /* @__PURE__ */ jsxs10(
    "div",
    {
      style: {
        alignItems: "center",
        background: "#ffffff",
        borderBottomColor: "#dadce0",
        borderBottomStyle: "solid",
        borderBottomWidth: 1,
        display: "flex",
        gap: 12,
        minHeight: 54,
        padding: "0 18px"
      },
      children: [
        /* @__PURE__ */ jsx14(
          "div",
          {
            "aria-hidden": "true",
            style: {
              alignItems: "center",
              background: "#12b76a",
              borderRadius: 8,
              color: "#ffffff",
              display: "grid",
              flex: "0 0 auto",
              height: 32,
              justifyContent: "center",
              width: 32
            },
            children: /* @__PURE__ */ jsx14(
              "span",
              {
                style: {
                  backgroundImage: "linear-gradient(#ffffff 0 0), linear-gradient(#ffffff 0 0)",
                  backgroundPosition: "center, center",
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "1px 18px, 18px 1px",
                  borderColor: "#ffffff",
                  borderRadius: 3,
                  borderStyle: "solid",
                  borderWidth: 1.5,
                  height: 18,
                  width: 18
                }
              }
            )
          }
        ),
        /* @__PURE__ */ jsx14(
          "div",
          {
            style: {
              color: "#202124",
              fontSize: 17,
              fontWeight: 600,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: title
          }
        )
      ]
    }
  );
}
function SpreadsheetFormulaBar({
  address,
  value
}) {
  return /* @__PURE__ */ jsxs10(
    "div",
    {
      style: {
        alignItems: "center",
        background: "#f8f9fa",
        borderBottomColor: "#dadce0",
        borderBottomStyle: "solid",
        borderBottomWidth: 1,
        display: "grid",
        gap: 8,
        gridTemplateColumns: "72px minmax(160px, 1fr)",
        minHeight: 42,
        padding: "6px 12px"
      },
      children: [
        /* @__PURE__ */ jsx14(
          "div",
          {
            style: {
              color: "#5f6368",
              fontSize: 13,
              paddingLeft: 2
            },
            children: address
          }
        ),
        /* @__PURE__ */ jsx14(
          "div",
          {
            style: {
              background: "#ffffff",
              borderColor: "#dadce0",
              borderRadius: 4,
              borderStyle: "solid",
              borderWidth: 1,
              color: "#5f6368",
              fontSize: 13,
              minHeight: 28,
              overflow: "hidden",
              padding: "5px 9px",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: value
          }
        )
      ]
    }
  );
}

// src/spreadsheet/spreadsheet-preview.tsx
import { jsx as jsx15, jsxs as jsxs11 } from "react/jsx-runtime";
function SpreadsheetPreview({ labels, proto }) {
  const root = useMemo4(() => asRecord(proto), [proto]);
  const sheets = useMemo4(
    () => asArray(root?.sheets).map(asRecord).filter((sheet) => sheet != null),
    [root]
  );
  const styles = useMemo4(() => asRecord(root?.styles), [root]);
  const charts = useMemo4(
    () => asArray(root?.charts).map(asRecord).filter((chart) => chart != null),
    [root]
  );
  const shapes = useMemo4(
    () => asArray(root?.shapes).map(asRecord).filter((shape) => shape != null),
    [root]
  );
  const slicerCaches = useMemo4(
    () => asArray(root?.slicerCaches).map(asRecord).filter((cache) => cache != null),
    [root]
  );
  const definedNames = useMemo4(() => root?.definedNames, [root]);
  const theme = useMemo4(() => asRecord(root?.theme), [root]);
  const imageSources = useOfficeImageSources(root);
  const [activeSheetIndex, setActiveSheetIndex] = useState(() => defaultSpreadsheetSheetIndex(sheets));
  const [sizeOverrides, setSizeOverrides] = useState({});
  const [resizeCursor, setResizeCursor] = useState();
  const [resizeDrag, setResizeDrag] = useState(null);
  const [cellEdits, setCellEdits] = useState({});
  const [editor, setEditor] = useState(null);
  const [filterMenu, setFilterMenu] = useState(null);
  const [tableFilterState, setTableFilterState] = useState({});
  const [selection, setSelection] = useState(null);
  const viewportShellRef = useRef5(null);
  const viewportRef = useRef5(null);
  const { state: viewportState, store: viewportStore } = useSpreadsheetViewportStore();
  const viewportScroll = viewportState.scroll;
  const viewportSize = viewportState.size;
  const activeSheetSource = sheets[Math.min(activeSheetIndex, Math.max(0, sheets.length - 1))];
  const sourceName = asString(root?.sourceName);
  const activeSheet = useMemo4(() => spreadsheetSheetWithVolatileFormulaValues(activeSheetSource, sheets, /* @__PURE__ */ new Date(), sourceName), [activeSheetSource, sheets, sourceName]);
  const tableFilterTargets = useMemo4(() => buildSpreadsheetTableFilterTargets(activeSheet), [activeSheet]);
  const filterRowHeightOverrides = useMemo4(
    () => spreadsheetTableFilterRowHeightOverrides(activeSheet, tableFilterState),
    [activeSheet, tableFilterState]
  );
  const effectiveSizeOverrides = useMemo4(
    () => mergeSpreadsheetLayoutOverrides(sizeOverrides, { rowHeights: filterRowHeightOverrides }),
    [filterRowHeightOverrides, sizeOverrides]
  );
  const activeFilterKeys = useMemo4(
    () => spreadsheetTableFilterActiveKeys(tableFilterTargets, tableFilterState),
    [tableFilterState, tableFilterTargets]
  );
  const layout = useMemo4(() => buildSpreadsheetLayout(activeSheet, effectiveSizeOverrides), [activeSheet, effectiveSizeOverrides]);
  const chartSpecs = useMemo4(() => buildSpreadsheetCharts({
    activeSheet,
    charts,
    layout,
    sheets
  }), [activeSheet, charts, layout, sheets]);
  const shapeSpecs = useMemo4(() => buildSpreadsheetShapes({
    activeSheet,
    layout,
    shapes,
    slicerCaches
  }), [activeSheet, layout, shapes, slicerCaches]);
  const imageSpecs = useMemo4(() => buildSpreadsheetImages({
    activeSheet,
    imageSources,
    layout
  }), [activeSheet, imageSources, layout]);
  const visibleChartSpecs = useMemo4(
    () => visibleFloatingSpecs(chartSpecs, viewportSize, viewportScroll),
    [chartSpecs, viewportScroll, viewportSize]
  );
  const visibleShapeSpecs = useMemo4(
    () => visibleFloatingSpecs(shapeSpecs, viewportSize, viewportScroll),
    [shapeSpecs, viewportScroll, viewportSize]
  );
  const visibleImageSpecs = useMemo4(
    () => visibleFloatingSpecs(imageSpecs, viewportSize, viewportScroll),
    [imageSpecs, viewportScroll, viewportSize]
  );
  const cellVisuals = useMemo4(
    () => buildSpreadsheetConditionalVisuals(activeSheet, theme, definedNames),
    [activeSheet, definedNames, theme]
  );
  const sparklineVisuals = useMemo4(() => buildSpreadsheetSparklineVisuals(activeSheet), [activeSheet]);
  const commentVisuals = useMemo4(() => buildSpreadsheetCommentVisuals(root, activeSheet), [activeSheet, root]);
  const validationVisuals = useMemo4(() => buildSpreadsheetValidationVisuals(activeSheet), [activeSheet]);
  const canvasCellPaints = useMemo4(
    () => buildSpreadsheetCanvasCellPaints({
      cellEdits,
      layout,
      project: {
        cellStyle: (cell, rowRecord, columnIndex, key) => {
          const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
          return spreadsheetCellStyle(cell, styles, cellVisuals.get(key), asString(activeSheet?.name), styleIndex);
        },
        cellText: (cell, rowRecord, columnIndex) => {
          const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
          return spreadsheetCellText(cell, styles, asString(activeSheet?.name), styleIndex);
        }
      },
      visibleRange: buildSpreadsheetRenderSnapshot({
        layout,
        scroll: viewportScroll,
        viewportSize
      }).visibleRange
    }),
    [activeSheet, cellEdits, cellVisuals, layout, styles, viewportScroll, viewportSize]
  );
  useEffect5(() => () => viewportStore.destroy(), [viewportStore]);
  useEffect5(() => {
    const viewport2 = viewportRef.current;
    if (!viewport2) return;
    viewport2.scrollLeft = 0;
    viewport2.scrollTop = 0;
    viewportStore.reset();
  }, [activeSheetIndex, viewportStore]);
  useEffect5(() => {
    const viewport2 = viewportRef.current;
    if (!viewport2) return;
    const updateViewportSize = () => {
      const width = viewport2.clientWidth;
      const height = viewport2.clientHeight;
      viewportStore.schedule({
        scroll: { left: viewport2.scrollLeft, top: viewport2.scrollTop },
        size: { height, width }
      });
    };
    updateViewportSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportSize);
      return () => window.removeEventListener("resize", updateViewportSize);
    }
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport2);
    return () => observer.disconnect();
  }, [activeSheetIndex, viewportStore]);
  const handleSheetSelect = (index) => {
    viewportStore.reset();
    setSizeOverrides({});
    setResizeDrag(null);
    setResizeCursor(void 0);
    setCellEdits({});
    setEditor(null);
    setFilterMenu(null);
    setTableFilterState({});
    setSelection(null);
    setActiveSheetIndex(index);
  };
  const handleViewportPointerDown = (event) => {
    const viewport2 = event.currentTarget;
    viewport2.focus();
    const point = viewportPointFromPointer(event);
    const scroll = { left: viewport2.scrollLeft, top: viewport2.scrollTop };
    const resizeHit = spreadsheetResizeHitAtViewportPoint(layout, point, scroll);
    if (resizeHit) {
      event.preventDefault();
      setEditor(null);
      setFilterMenu(null);
      viewport2.setPointerCapture(event.pointerId);
      setResizeDrag(spreadsheetResizeDragFromHit(layout, resizeHit, point, scroll));
      return;
    }
    if (editor) commitSpreadsheetEditor(editor, setCellEdits, setEditor);
    setFilterMenu(null);
    setSelection(spreadsheetSelectionFromViewportPoint(layout, point, scroll));
  };
  const handleViewportDoubleClick = (event) => {
    const viewport2 = event.currentTarget;
    const selectionFromPoint = spreadsheetSelectionFromViewportPoint(
      layout,
      viewportPointFromPointer(event),
      { left: viewport2.scrollLeft, top: viewport2.scrollTop }
    );
    if (!selectionFromPoint) return;
    event.preventDefault();
    setSelection(selectionFromPoint);
    setEditor(spreadsheetEditorForSelection(activeSheet, styles, cellEdits, selectionFromPoint));
  };
  const handleViewportPointerMove = (event) => {
    const viewport2 = event.currentTarget;
    const point = viewportPointFromPointer(event);
    const scroll = { left: viewport2.scrollLeft, top: viewport2.scrollTop };
    if (resizeDrag) {
      event.preventDefault();
      const size = spreadsheetResizeSizeFromPoint(layout, resizeDrag, point, scroll);
      setSizeOverrides((current) => applySpreadsheetInteractiveSizeOverride(
        current,
        resizeDrag.axis,
        resizeDrag.index,
        size
      ));
      return;
    }
    const resizeHit = spreadsheetResizeHitAtViewportPoint(layout, point, scroll);
    const nextCursor = resizeHit ? spreadsheetResizeCursor(resizeHit.axis) : void 0;
    setResizeCursor((current) => current === nextCursor ? current : nextCursor);
  };
  const handleViewportPointerUp = (event) => {
    if (!resizeDrag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizeDrag(null);
  };
  const handleViewportScroll = (event) => {
    const { clientHeight, clientWidth, scrollLeft, scrollTop } = event.currentTarget;
    viewportStore.schedule({
      scroll: { left: scrollLeft, top: scrollTop },
      size: { height: clientHeight, width: clientWidth }
    });
    setFilterMenu(null);
  };
  const handleViewportKeyDown = (event) => {
    if (event.key === "F2") {
      event.preventDefault();
      const targetSelection = selection ?? { columnIndex: 0, rowIndex: 1, rowOffset: 0 };
      setSelection(targetSelection);
      setEditor(spreadsheetEditorForSelection(activeSheet, styles, cellEdits, targetSelection));
      return;
    }
    const direction = spreadsheetSelectionDirectionFromKey(event.key, event.shiftKey);
    if (!direction) return;
    event.preventDefault();
    const nextSelection = spreadsheetMoveSelection(layout, selection, direction);
    setSelection(nextSelection);
    const viewport2 = viewportRef.current;
    if (viewport2) scrollSpreadsheetSelectionIntoView(viewport2, layout, nextSelection);
  };
  const handleFilterClick = (target, event) => {
    const hostBounds = viewportShellRef.current?.getBoundingClientRect();
    const buttonBounds = event.currentTarget.getBoundingClientRect();
    if (!hostBounds) return;
    setEditor(null);
    setFilterMenu({
      anchor: {
        height: buttonBounds.height,
        left: buttonBounds.left - hostBounds.left,
        top: buttonBounds.top - hostBounds.top,
        width: buttonBounds.width
      },
      target
    });
  };
  const handleFilterToggle = (target, value, values) => {
    const allValues = values.map((item) => item.value);
    setTableFilterState((current) => {
      const nextSelection = spreadsheetTableFilterSelectionForToggle(current[target.id], allValues, value);
      const next = { ...current };
      if (nextSelection == null) delete next[target.id];
      else next[target.id] = nextSelection;
      return next;
    });
  };
  const handleFilterClear = (target) => {
    setTableFilterState((current) => {
      if (current[target.id] == null) return current;
      const next = { ...current };
      delete next[target.id];
      return next;
    });
  };
  if (sheets.length === 0) {
    return /* @__PURE__ */ jsx15("p", { style: { color: "#64748b" }, children: labels.noSheets });
  }
  const formulaRow = selection?.rowIndex ?? 1;
  const formulaColumn = selection?.columnIndex ?? 0;
  const formulaCell = cellAt2(activeSheet, formulaRow, formulaColumn);
  const formulaSheetName = asString(activeSheet?.name);
  const formulaValue = selection ? cellEdits[spreadsheetSelectionKey(selection)] ?? spreadsheetCellText(formulaCell, styles, formulaSheetName) : spreadsheetCellText(formulaCell, styles, formulaSheetName);
  const formulaAddress = asString(formulaCell?.address) || `${columnLabel(formulaColumn)}${formulaRow}`;
  return /* @__PURE__ */ jsxs11(
    "div",
    {
      "data-testid": "spreadsheet-preview",
      style: {
        background: "#ffffff",
        borderColor: "#d7dde5",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
        display: "grid",
        fontFamily: SPREADSHEET_FONT_FAMILY,
        gridTemplateRows: "auto auto minmax(0, 1fr) auto",
        maxHeight: "calc(100vh - 150px)",
        minHeight: 620,
        overflow: "hidden"
      },
      children: [
        /* @__PURE__ */ jsx15(SpreadsheetWorkbookBar, { title: asString(root?.sourceName) || asString(root?.title) || asString(activeSheet?.name) }),
        /* @__PURE__ */ jsx15(SpreadsheetFormulaBar, { address: formulaAddress, value: formulaValue }),
        /* @__PURE__ */ jsxs11("div", { ref: viewportShellRef, style: { minHeight: 0, overflow: "hidden", position: "relative" }, children: [
          /* @__PURE__ */ jsx15(
            SpreadsheetCanvasLayer,
            {
              cellPaints: canvasCellPaints,
              layout,
              scroll: viewportScroll,
              viewportSize
            }
          ),
          /* @__PURE__ */ jsx15(
            "div",
            {
              onDoubleClick: handleViewportDoubleClick,
              onKeyDown: handleViewportKeyDown,
              onPointerDown: handleViewportPointerDown,
              onPointerMove: handleViewportPointerMove,
              onPointerCancel: handleViewportPointerUp,
              onPointerUp: handleViewportPointerUp,
              onScroll: handleViewportScroll,
              ref: viewportRef,
              style: { cursor: resizeDrag ? spreadsheetResizeCursor(resizeDrag.axis) : resizeCursor, height: "100%", overflow: "auto", position: "relative", zIndex: 1 },
              tabIndex: 0,
              children: /* @__PURE__ */ jsxs11("div", { style: { height: layout.gridHeight, minWidth: layout.gridWidth, position: "relative", width: layout.gridWidth }, children: [
                /* @__PURE__ */ jsx15(
                  SpreadsheetGrid,
                  {
                    activeSheet,
                    cellEdits,
                    cellVisuals,
                    commentVisuals,
                    layout,
                    activeFilterKeys,
                    onFilterClick: handleFilterClick,
                    scroll: viewportScroll,
                    selection,
                    sparklineVisuals,
                    styles,
                    tableFilterTargets,
                    validationVisuals,
                    viewportSize
                  }
                ),
                /* @__PURE__ */ jsx15(SpreadsheetImageLayer, { images: visibleImageSpecs }),
                /* @__PURE__ */ jsx15(SpreadsheetShapeLayer, { shapes: visibleShapeSpecs }),
                /* @__PURE__ */ jsx15(SpreadsheetChartLayer, { charts: visibleChartSpecs }),
                /* @__PURE__ */ jsx15(SpreadsheetSelectionLayer, { layout, selection }),
                /* @__PURE__ */ jsx15(
                  SpreadsheetCellEditorLayer,
                  {
                    editor,
                    layout,
                    onCancel: () => setEditor(null),
                    onCommit: (nextEditor) => commitSpreadsheetEditor(nextEditor, setCellEdits, setEditor),
                    onValueChange: (value) => setEditor((current) => current ? { ...current, value } : current)
                  }
                )
              ] })
            }
          ),
          /* @__PURE__ */ jsx15(
            SpreadsheetFrozenBodyLayer,
            {
              activeSheet,
              cellEdits,
              cellVisuals,
              commentVisuals,
              layout,
              scroll: viewportScroll,
              selection,
              sparklineVisuals,
              styles,
              validationVisuals,
              viewportSize
            }
          ),
          /* @__PURE__ */ jsx15(
            SpreadsheetFrozenHeaders,
            {
              layout,
              scrollLeft: viewportScroll.left,
              scrollTop: viewportScroll.top,
              viewportSize
            }
          ),
          /* @__PURE__ */ jsx15(SpreadsheetFrozenSelectionLayer, { layout, scroll: viewportScroll, selection }),
          filterMenu ? /* @__PURE__ */ jsx15(
            SpreadsheetTableFilterMenu,
            {
              anchor: filterMenu.anchor,
              onClear: () => handleFilterClear(filterMenu.target),
              onClose: () => setFilterMenu(null),
              onToggle: (value, values) => handleFilterToggle(filterMenu.target, value, values),
              selectedValues: tableFilterState[filterMenu.target.id],
              target: filterMenu.target,
              values: spreadsheetTableFilterValues(activeSheet, filterMenu.target)
            }
          ) : null
        ] }),
        /* @__PURE__ */ jsx15(
          "div",
          {
            style: {
              background: "#f6f7f9",
              borderTopColor: "#d7dde5",
              borderTopStyle: "solid",
              borderTopWidth: 1,
              display: "flex",
              gap: 4,
              overflowX: "auto",
              padding: "0 10px"
            },
            children: sheets.map((sheet, index) => {
              const tabColor = spreadsheetSheetTabColor(sheet);
              const active = index === activeSheetIndex;
              return /* @__PURE__ */ jsx15(
                "button",
                {
                  onClick: () => handleSheetSelect(index),
                  style: {
                    background: active ? "#ffffff" : "transparent",
                    borderBottomColor: active ? tabColor ?? "#111827" : "transparent",
                    borderBottomStyle: "solid",
                    borderBottomWidth: 3,
                    borderLeftWidth: 0,
                    borderRightWidth: 0,
                    borderTopColor: !active && tabColor ? tabColor : "transparent",
                    borderTopStyle: "solid",
                    borderTopWidth: 3,
                    color: active ? "#111827" : "#5f6368",
                    cursor: "pointer",
                    flex: "0 0 auto",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    minHeight: 44,
                    padding: "0 16px"
                  },
                  type: "button",
                  children: asString(sheet.name) || `${labels.sheet} ${index + 1}`
                },
                `${asString(sheet.sheetId)}-${index}`
              );
            })
          }
        )
      ]
    }
  );
}
function SpreadsheetSelectionLayer({
  layout,
  selection
}) {
  if (!selection) return null;
  const rect = spreadsheetSelectionWorldRect(layout, selection);
  if (rect.width <= 0 || rect.height <= 0) return null;
  return /* @__PURE__ */ jsx15(
    "div",
    {
      "aria-hidden": "true",
      style: {
        ...spreadsheetSelectionStyle,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width
      }
    }
  );
}
function SpreadsheetFrozenSelectionLayer({
  layout,
  scroll,
  selection
}) {
  if (!selection) return null;
  const segments = spreadsheetFrozenSelectionSegments(layout, selection, scroll);
  if (segments.length === 0) return null;
  return /* @__PURE__ */ jsx15("div", { "aria-hidden": "true", style: { inset: 0, overflow: "hidden", pointerEvents: "none", position: "absolute", zIndex: 13 }, children: segments.map((segment, index) => /* @__PURE__ */ jsx15(
    "div",
    {
      style: {
        ...spreadsheetSelectionStyle,
        height: segment.height,
        left: segment.left,
        top: segment.top,
        width: segment.width
      }
    },
    `${selection.rowIndex}:${selection.columnIndex}:${index}`
  )) });
}
function SpreadsheetCellEditorLayer({
  editor,
  layout,
  onCancel,
  onCommit,
  onValueChange
}) {
  const inputRef = useRef5(null);
  useEffect5(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editor]);
  if (!editor) return null;
  const rect = spreadsheetSelectionWorldRect(layout, editor.selection);
  if (rect.width <= 0 || rect.height <= 0) return null;
  return /* @__PURE__ */ jsx15(
    "input",
    {
      "aria-label": "Cell editor",
      onChange: (event) => onValueChange(event.currentTarget.value),
      onDoubleClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onCommit(editor);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      },
      onPointerDown: (event) => event.stopPropagation(),
      ref: inputRef,
      style: {
        background: "#ffffff",
        borderColor: "#0f9d58",
        borderStyle: "solid",
        borderWidth: 2,
        boxShadow: "0 8px 18px rgba(15, 23, 42, 0.18)",
        boxSizing: "border-box",
        color: "#0f172a",
        fontFamily: SPREADSHEET_FONT_FAMILY,
        fontSize: 13,
        height: Math.max(24, rect.height),
        left: rect.left,
        outline: "none",
        padding: "3px 7px",
        position: "absolute",
        top: rect.top,
        width: Math.max(80, rect.width),
        zIndex: 4e4
      },
      value: editor.value
    }
  );
}
function SpreadsheetFrozenBodyLayer({
  activeSheet,
  cellEdits,
  cellVisuals,
  commentVisuals,
  layout,
  scroll,
  selection,
  sparklineVisuals,
  styles,
  validationVisuals,
  viewportSize
}) {
  if (layout.freezePanes.columnCount === 0 && layout.freezePanes.rowCount === 0) {
    return null;
  }
  const sheetName = asString(activeSheet?.name);
  const selectedCellKey = selection ? spreadsheetSelectionKey(selection) : "";
  const frozenWidth = spreadsheetFrozenBodyWidth(layout);
  const frozenHeight = spreadsheetFrozenBodyHeight(layout);
  if (frozenWidth <= 0 && frozenHeight <= 0) return null;
  const showGridLines = spreadsheetShowGridLines(activeSheet);
  const { visibleColumnIndexes, visibleRange, visibleRowOffsets } = buildSpreadsheetRenderSnapshot({
    layout,
    scroll,
    viewportSize
  });
  return /* @__PURE__ */ jsx15("div", { "aria-hidden": "true", style: { inset: 0, overflow: "hidden", pointerEvents: "none", position: "absolute", zIndex: 11 }, children: visibleRowOffsets.map((rowOffset) => {
    const rowIndex = rowOffset + 1;
    const row = layout.rowsByIndex.get(rowIndex);
    const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
    const top = spreadsheetRowTop(layout, rowOffset);
    return visibleColumnIndexes.map((columnIndex) => {
      const cellKey = spreadsheetCellKey(rowIndex, columnIndex);
      if (layout.coveredCells.has(cellKey)) return null;
      if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) return null;
      const cell = row?.get(columnIndex) ?? null;
      const merge = layout.mergeByStart.get(cellKey);
      const left = spreadsheetColumnLeft(layout, columnIndex);
      const width = spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left;
      const cellHeight = spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top;
      const rects = spreadsheetViewportRectSegments(layout, { height: cellHeight, left, top, width }, scroll);
      if (rects.length === 0) return null;
      const visual = cellVisuals.get(cellKey);
      const hasComment = commentVisuals.has(cellKey);
      const sparkline = sparklineVisuals.get(cellKey);
      const validation = cellKey === selectedCellKey ? validationVisuals.get(cellKey) : void 0;
      const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
      const text = cellEdits[cellKey] ?? spreadsheetCellText(cell, styles, sheetName, styleIndex);
      return rects.map((rect, segmentIndex) => /* @__PURE__ */ jsx15(
        "div",
        {
          "data-frozen-cell-address": asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`,
          style: {
            ...spreadsheetCellStyle(cell, styles, visual, sheetName, styleIndex, showGridLines),
            height: rect.height,
            left: rect.left,
            overflow: "hidden",
            position: "absolute",
            top: rect.top,
            width: rect.width
          },
          children: /* @__PURE__ */ jsx15(
            SpreadsheetCellContent,
            {
              hasComment,
              sparkline,
              text,
              validation,
              visual
            }
          )
        },
        `${rowIndex}:${columnIndex}:${segmentIndex}`
      ));
    });
  }) });
}
function SpreadsheetGrid({
  activeFilterKeys,
  activeSheet,
  cellEdits,
  cellVisuals,
  commentVisuals,
  layout,
  onFilterClick,
  scroll,
  selection,
  sparklineVisuals,
  styles,
  tableFilterTargets,
  validationVisuals,
  viewportSize
}) {
  const sheetName = asString(activeSheet?.name);
  const selectedCellKey = selection ? spreadsheetSelectionKey(selection) : "";
  const showGridLines = spreadsheetShowGridLines(activeSheet);
  const renderSnapshot = useMemo4(
    () => buildSpreadsheetRenderSnapshot({ layout, scroll, viewportSize }),
    [layout, scroll, viewportSize]
  );
  const { visibleColumnIndexes, visibleRange, visibleRowOffsets } = renderSnapshot;
  return /* @__PURE__ */ jsxs11(
    "div",
    {
      role: "grid",
      style: {
        fontFamily: SPREADSHEET_FONT_FAMILY,
        fontSize: 13,
        height: layout.gridHeight,
        position: "absolute",
        width: layout.gridWidth
      },
      children: [
        /* @__PURE__ */ jsx15("div", { style: spreadsheetCornerStyle }),
        visibleColumnIndexes.map((columnIndex) => /* @__PURE__ */ jsx15(
          "div",
          {
            role: "columnheader",
            style: {
              ...spreadsheetColumnHeaderStyle,
              left: spreadsheetColumnLeft(layout, columnIndex),
              width: layout.columnWidths[columnIndex]
            },
            children: columnLabel(columnIndex)
          },
          columnIndex
        )),
        visibleRowOffsets.map((rowOffset) => {
          const rowIndex = rowOffset + 1;
          const row = layout.rowsByIndex.get(rowIndex);
          const rowRecord = layout.rowRecordsByIndex.get(rowIndex);
          const top = spreadsheetRowTop(layout, rowOffset);
          const height = layout.rowHeights[rowOffset];
          return /* @__PURE__ */ jsxs11("div", { role: "row", children: [
            /* @__PURE__ */ jsx15(
              "div",
              {
                role: "rowheader",
                style: {
                  ...spreadsheetRowHeaderStyle,
                  height,
                  top
                },
                children: rowIndex
              }
            ),
            visibleColumnIndexes.map((columnIndex) => {
              const cellKey = spreadsheetCellKey(rowIndex, columnIndex);
              if (layout.coveredCells.has(cellKey)) return null;
              if (!visibleCellIntersectsRange(layout, rowOffset, columnIndex, visibleRange)) return null;
              const cell = row?.get(columnIndex) ?? null;
              const merge = layout.mergeByStart.get(cellKey);
              const left = spreadsheetColumnLeft(layout, columnIndex);
              const width = spreadsheetColumnLeft(layout, columnIndex + (merge?.columnSpan ?? 1)) - left;
              const cellHeight = spreadsheetRowTop(layout, rowOffset + (merge?.rowSpan ?? 1)) - top;
              const visual = cellVisuals.get(cellKey);
              const hasComment = commentVisuals.has(cellKey);
              const sparkline = sparklineVisuals.get(cellKey);
              const validation = cellKey === selectedCellKey ? validationVisuals.get(cellKey) : void 0;
              const styleIndex = spreadsheetEffectiveStyleIndex(cell, rowRecord, layout, columnIndex);
              const text = cellEdits[cellKey] ?? spreadsheetCellText(cell, styles, sheetName, styleIndex);
              const filterTarget = visual?.filter ? spreadsheetTableFilterTargetAt(tableFilterTargets, rowIndex, columnIndex) : null;
              return /* @__PURE__ */ jsx15(
                "div",
                {
                  "data-cell-address": asString(cell?.address) || `${columnLabel(columnIndex)}${rowIndex}`,
                  role: "gridcell",
                  style: {
                    ...spreadsheetCellStyle(cell, styles, visual, sheetName, styleIndex, showGridLines),
                    height: cellHeight,
                    left,
                    position: "absolute",
                    top,
                    width
                  },
                  children: /* @__PURE__ */ jsx15(
                    SpreadsheetCellContent,
                    {
                      filterActive: activeFilterKeys.has(cellKey),
                      hasComment,
                      onFilterClick: filterTarget ? (event) => onFilterClick(filterTarget, event) : void 0,
                      sparkline,
                      text,
                      validation,
                      visual
                    }
                  )
                },
                columnIndex
              );
            })
          ] }, rowIndex);
        })
      ]
    }
  );
}
var spreadsheetHeaderBaseStyle = {
  alignItems: "center",
  background: "#f1f3f4",
  borderBottomColor: "#dadce0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  borderRightColor: "#dadce0",
  borderRightStyle: "solid",
  borderRightWidth: 1,
  boxSizing: "border-box",
  color: "#3c4043",
  display: "flex",
  fontFamily: SPREADSHEET_FONT_FAMILY,
  fontSize: 13,
  fontWeight: 500,
  justifyContent: "center",
  overflow: "hidden",
  padding: "0 4px",
  position: "absolute",
  zIndex: 2
};
var spreadsheetSelectionStyle = {
  borderColor: "#0f9d58",
  borderStyle: "solid",
  borderWidth: 2,
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.8)",
  boxSizing: "border-box",
  pointerEvents: "none",
  position: "absolute",
  zIndex: 3e4
};
var spreadsheetCornerStyle = {
  ...spreadsheetHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  left: 0,
  top: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 4
};
var spreadsheetColumnHeaderStyle = {
  ...spreadsheetHeaderBaseStyle,
  height: SPREADSHEET_COLUMN_HEADER_HEIGHT,
  top: 0
};
var spreadsheetRowHeaderStyle = {
  ...spreadsheetHeaderBaseStyle,
  left: 0,
  width: SPREADSHEET_ROW_HEADER_WIDTH,
  zIndex: 3
};

// src/presentation/presentation-preview.tsx
import { ChevronLeft, ChevronRight, Play, StickyNote, X } from "lucide-react";
import { useCallback, useEffect as useEffect6, useMemo as useMemo5, useRef as useRef6, useState as useState2 } from "react";
import { createPortal } from "react-dom";

// #style-inject:#style-inject
function styleInject(css, { insertAt } = {}) {
  if (!css || typeof document === "undefined") return;
  const head = document.head || document.getElementsByTagName("head")[0];
  const style = document.createElement("style");
  style.type = "text/css";
  if (insertAt === "top") {
    if (head.firstChild) {
      head.insertBefore(style, head.firstChild);
    } else {
      head.appendChild(style);
    }
  } else {
    head.appendChild(style);
  }
  if (style.styleSheet) {
    style.styleSheet.cssText = css;
  } else {
    style.appendChild(document.createTextNode(css));
  }
}

// src/presentation/presentation-preview.module.css
styleInject('.shell {\n  background: #ffffff;\n  color: #0f172a;\n  container: presentation-editor / inline-size;\n  display: grid;\n  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);\n  grid-template-columns: clamp(156px, 13vw, 252px) minmax(0, 1fr);\n  height: 100%;\n  min-height: 0;\n  overflow: hidden;\n  position: relative;\n}\n.rail {\n  background: color-mix(in srgb, #ffffff 86%, transparent);\n  backdrop-filter: blur(40px);\n  border-right: 1px solid #cbd5e1;\n  display: flex;\n  min-height: 0;\n  overflow: hidden;\n  position: relative;\n  z-index: 20;\n}\n.stackButton {\n  display: none;\n}\n.thumbnailPanel {\n  display: flex;\n  flex: 1;\n  flex-direction: column;\n  gap: 12px;\n  min-height: 0;\n  overflow: hidden auto;\n  padding: 12px 14px 48px 8px;\n  scrollbar-color: #cbd5e1 transparent;\n}\n.thumbnailButton {\n  align-items: flex-start;\n  -webkit-appearance: none;\n  -moz-appearance: none;\n  appearance: none;\n  background: transparent;\n  border: 0;\n  border-radius: 7px;\n  color: inherit;\n  cursor: pointer;\n  display: flex;\n  gap: 8px;\n  padding: 6px 8px 6px 0;\n  text-align: left;\n  touch-action: manipulation;\n}\n.thumbnailButton:hover {\n  background: #f8fafc;\n}\n.thumbnailButton:focus-visible {\n  outline: none;\n}\n.thumbnailButton:focus-visible .thumbnailCanvas {\n  box-shadow:\n    0 8px 22px rgba(15, 23, 42, 0.12),\n    0 0 0 2px #60a5fa,\n    0 0 0 5px rgba(96, 165, 250, 0.16);\n}\n.thumbnailButton[data-active=true]:hover {\n  background: transparent;\n}\n.thumbnailButton[data-active=true]:focus-visible {\n  outline: none;\n}\n.thumbnailLabel {\n  color: #334155;\n  flex: 0 0 22px;\n  font-size: 13px;\n  font-variant-numeric: tabular-nums;\n  font-weight: 500;\n  line-height: 1;\n  padding-top: 4px;\n  text-align: right;\n}\n.thumbnailCanvas,\n.slideCanvas {\n  background: #ffffff;\n  display: block;\n  -o-object-fit: fill;\n  object-fit: fill;\n  -webkit-user-select: none;\n  -moz-user-select: none;\n  user-select: none;\n}\n.thumbnailCanvas {\n  border: 0;\n  border-radius: 4px;\n  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);\n  flex: 0 0 auto;\n  height: auto;\n  outline: 0 solid transparent;\n  outline-offset: 0;\n  overflow: hidden;\n}\n.thumbnailButton[data-active=true] {\n  background: transparent;\n  box-shadow: none;\n}\n.thumbnailButton[data-active=true] .thumbnailCanvas {\n  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12), 0 0 0 2px #60a5fa;\n  outline: 1px solid rgba(255, 255, 255, 0.92);\n}\n.mainPanel {\n  display: grid;\n  grid-template-rows: minmax(0, 1fr);\n  min-height: 0;\n  min-width: 0;\n  overflow: hidden;\n}\n.meta {\n  align-items: center;\n  color: #475569;\n  display: none;\n  flex-wrap: wrap;\n  gap: 12px;\n  min-width: 0;\n  padding: 18px 20px 0;\n}\n.metaStrong {\n  color: #334155;\n  font-size: 14px;\n  font-weight: 700;\n}\n.metaText {\n  font-size: 14px;\n}\n.stage {\n  background: #f8fafc;\n  display: block;\n  min-height: 0;\n  min-width: 0;\n  overflow: auto;\n  padding: 16px 24px 20px;\n  position: relative;\n  scrollbar-color: #cbd5e1 transparent;\n}\n.viewport {\n  align-items: center;\n  display: flex;\n  height: 100%;\n  justify-content: center;\n  min-height: 0;\n  min-width: 0;\n  overflow: auto;\n  position: relative;\n  width: 100%;\n}\n.playButton {\n  align-items: center;\n  background: #0f172a;\n  border: 1px solid #0f172a;\n  border-radius: 6px;\n  color: #ffffff;\n  cursor: pointer;\n  display: inline-flex;\n  flex: 0 0 auto;\n  font: 600 12px/1 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);\n  gap: 6px;\n  min-height: 30px;\n  padding: 0 10px;\n}\n.playButton:hover {\n  background: #1e293b;\n  border-color: #1e293b;\n}\n.slideSurface {\n  flex: 0 0 auto;\n  position: relative;\n}\n.slideCanvas {\n  border: 1px solid #cbd5e1;\n  border-radius: 7px;\n  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);\n}\n.interactionLayer {\n  background: transparent;\n  border: 0;\n  cursor: default;\n  inset: 0;\n  padding: 0;\n  position: absolute;\n}\n.interactionLayer:focus-visible {\n  outline: none;\n}\n.selectionBox {\n  border: 1.5px solid #0285ff;\n  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.72), 0 0 0 3px rgba(2, 133, 255, 0.2);\n  display: block;\n  left: 0;\n  pointer-events: none;\n  position: absolute;\n  top: 0;\n}\n.selectionHandle {\n  background: #ffffff;\n  border: 1.5px solid #0285ff;\n  border-radius: 50%;\n  box-sizing: border-box;\n  height: 8px;\n  position: absolute;\n  width: 8px;\n}\n.selectionHandle[data-position=top-left] {\n  left: -5px;\n  top: -5px;\n}\n.selectionHandle[data-position=top-right] {\n  right: -5px;\n  top: -5px;\n}\n.selectionHandle[data-position=bottom-left] {\n  bottom: -5px;\n  left: -5px;\n}\n.selectionHandle[data-position=bottom-right] {\n  bottom: -5px;\n  right: -5px;\n}\n.footnote {\n  background: #ffffff;\n  border: 1px solid #eef2f7;\n  border-radius: 8px;\n  box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);\n  box-sizing: border-box;\n  color: #64748b;\n  font: 12px/1.6 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);\n  left: 50%;\n  margin: 0;\n  max-height: 96px;\n  max-width: 100%;\n  overflow: auto;\n  padding: 12px 14px;\n  position: absolute;\n  transform: translateX(-50%);\n  white-space: pre-wrap;\n  z-index: 1;\n}\n.slideshowOverlay {\n  align-items: center;\n  background: #000000;\n  color: #f8fafc;\n  display: flex;\n  inset: 0;\n  justify-content: center;\n  min-height: 0;\n  padding: 0;\n  position: fixed;\n  z-index: 1000;\n}\n.slideshowChrome {\n  align-items: center;\n  background: rgba(15, 23, 42, 0.84);\n  border: 1px solid rgba(148, 163, 184, 0.22);\n  border-radius: 9999px;\n  display: flex;\n  gap: 10px;\n  opacity: 0;\n  padding: 4px 5px 4px 12px;\n  position: absolute;\n  right: 20px;\n  top: 18px;\n  transition: opacity 0.16s ease-out;\n  z-index: 2;\n}\n.slideshowOverlay:hover .slideshowChrome,\n.slideshowChrome:focus-within {\n  opacity: 1;\n}\n.slideshowCounter {\n  color: #cbd5e1;\n  font-size: 13px;\n  font-variant-numeric: tabular-nums;\n  font-weight: 600;\n}\n.slideshowIconButton {\n  align-items: center;\n  border-radius: 6px;\n  cursor: pointer;\n  display: inline-flex;\n  font: 600 13px/1 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);\n  justify-content: center;\n}\n.slideshowIconButton {\n  background: rgba(15, 23, 42, 0.86);\n  border: 1px solid rgba(148, 163, 184, 0.34);\n  color: #f8fafc;\n  height: 34px;\n  width: 34px;\n}\n.slideshowIconButton:hover {\n  background: rgba(30, 41, 59, 0.94);\n  border-color: rgba(203, 213, 225, 0.52);\n}\n.slideshowIconButton:disabled {\n  cursor: default;\n  opacity: 0.38;\n}\n.slideshowIconButton:disabled:hover {\n  background: rgba(15, 23, 42, 0.86);\n  border-color: rgba(148, 163, 184, 0.34);\n}\n.slideshowIconButton[aria-pressed=true] {\n  background: rgba(248, 250, 252, 0.16);\n  border-color: rgba(248, 250, 252, 0.7);\n}\n.slideshowPresenterLayout {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  height: 100%;\n  min-height: 0;\n  min-width: 0;\n  width: 100%;\n}\n.slideshowPresenterLayout[data-notes-open=true] {\n  grid-template-columns: minmax(0, 1fr) minmax(260px, 24vw);\n}\n.slideshowFrame {\n  align-items: center;\n  background: transparent;\n  border: 0;\n  cursor: pointer;\n  display: flex;\n  justify-content: center;\n  height: 100%;\n  min-height: 0;\n  min-width: 0;\n  overflow: hidden;\n  padding: 0;\n  width: 100%;\n}\n.slideshowCanvas {\n  background: #ffffff;\n  border-radius: 0;\n  box-shadow: none;\n  display: block;\n  -o-object-fit: fill;\n  object-fit: fill;\n  -webkit-user-select: none;\n  -moz-user-select: none;\n  user-select: none;\n}\n.slideshowNotesPanel {\n  align-self: stretch;\n  background: #0f172a;\n  border-left: 1px solid rgba(148, 163, 184, 0.28);\n  box-sizing: border-box;\n  color: #e2e8f0;\n  display: grid;\n  grid-template-rows: auto minmax(0, 1fr);\n  min-height: 0;\n  overflow: hidden;\n  padding: 22px 20px;\n}\n.slideshowNotesTitle {\n  color: #f8fafc;\n  font-size: 13px;\n  font-weight: 700;\n  line-height: 1.2;\n  margin-bottom: 14px;\n}\n.slideshowNotesText {\n  color: #cbd5e1;\n  font: 15px/1.55 var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);\n  margin: 0;\n  min-height: 0;\n  overflow: auto;\n  white-space: pre-wrap;\n}\n@container presentation-editor (width <= 748px) {\n  .rail {\n    background: transparent;\n    backdrop-filter: none;\n    border-right: 0;\n    bottom: 24px;\n    left: 16px;\n    min-height: 0;\n    pointer-events: none;\n    position: absolute;\n    top: 12px;\n    width: 136px;\n  }\n  .stackButton {\n    background: transparent;\n    border: 0;\n    cursor: pointer;\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    left: 0;\n    max-height: calc(100% - 36px);\n    overflow: hidden;\n    padding: 0;\n    pointer-events: auto;\n    position: absolute;\n    top: 50%;\n    transform: translateY(-50%);\n    transition: opacity 0.2s ease-out;\n    width: 20px;\n  }\n  .stackBar {\n    background: #94a3b8;\n    border-radius: 9999px;\n    display: block;\n    height: 2px;\n    width: 20px;\n  }\n  .thumbnailPanel {\n    background: color-mix(in srgb, #ffffff 82%, transparent);\n    backdrop-filter: blur(28px);\n    border-radius: 16px;\n    gap: 8px;\n    box-shadow: 0 5px 32px rgba(0, 0, 0, 0.07);\n    max-height: 100%;\n    opacity: 0;\n    padding: 8px;\n    pointer-events: none;\n    position: absolute;\n    top: 50%;\n    transform: translateY(-50%) translateX(-8px);\n    transition: opacity 0.2s ease-out, transform 0.2s ease-out;\n    visibility: hidden;\n    width: 136px;\n  }\n  .thumbnailButton {\n    display: grid;\n    gap: 5px;\n    padding: 0;\n  }\n  .thumbnailLabel {\n    flex: none;\n    font-size: 10px;\n    padding-top: 0;\n    text-align: left;\n  }\n  .thumbnailCanvas {\n    max-width: 120px;\n  }\n  .rail[data-open=true] .stackButton {\n    opacity: 0;\n  }\n  .rail[data-open=true] .thumbnailPanel {\n    opacity: 1;\n    pointer-events: auto;\n    transform: translateY(-50%) translateX(0);\n    visibility: visible;\n  }\n  .stage {\n    padding: 18px;\n  }\n  .playButton span {\n    display: none;\n  }\n}\n@media (width <= 748px) {\n  .shell {\n    grid-template-columns: minmax(0, 1fr);\n    min-height: 520px;\n  }\n  .slideshowOverlay {\n    padding: 10px;\n  }\n  .slideshowPresenterLayout[data-notes-open=true] {\n    grid-template-columns: minmax(0, 1fr);\n    grid-template-rows: minmax(0, 1fr) minmax(120px, 30vh);\n  }\n  .slideshowNotesPanel {\n    border-left: 0;\n    border-top: 1px solid rgba(148, 163, 184, 0.28);\n    padding: 14px 16px;\n  }\n}\n');

// src/presentation/presentation-notes.ts
function presentationSlideNotesText(slide) {
  const notesSlide = asRecord(slide.notesSlide);
  if (!notesSlide) return "";
  const blocks = [];
  for (const element of asArray(notesSlide.elements)) {
    const record = asRecord(element);
    if (!record || !isPresentationNotesBodyPlaceholder(record)) {
      continue;
    }
    const text = asArray(record.paragraphs).map(
      (paragraph) => asArray(asRecord(paragraph)?.runs).map((run) => asString(asRecord(run)?.text)).join("").trim()
    ).filter((line) => line && !/^\d+$/u.test(line)).join("\n").trim();
    if (text && !blocks.includes(text)) {
      blocks.push(text);
    }
  }
  return blocks.join("\n\n");
}
function isPresentationNotesBodyPlaceholder(element) {
  const placeholderType = asString(element.placeholderType).toLowerCase();
  const name = asString(element.name).toLowerCase();
  if (placeholderType === "sldimg" || placeholderType === "sldnum") return false;
  if (placeholderType === "body" || placeholderType === "notes") return true;
  if (name.includes("notes") || name.includes("body")) return true;
  return placeholderType === "" && asArray(element.paragraphs).length > 0;
}

// src/presentation/presentation-fill-styles.ts
function shapeFillToCss(shape, element, lineColor, rect) {
  const fill = fillToCss(shape?.fill) ?? fillToCss(element.fill);
  if (!fill) return void 0;
  if (shape && isTransparentOutlineEllipse(shape, rect)) return void 0;
  const isLikelyOutlineOnly = Math.abs(rect.width - rect.height) <= Math.max(2, Math.min(rect.width, rect.height) * 0.03);
  if (isLikelyOutlineOnly && lineColor && sameBaseColor(fill, lineColor) && colorAlphaFromCss(lineColor) < 0.5) {
    return void 0;
  }
  return fill;
}
function shapeFillToPaint(context, shape, element, lineColor, rect) {
  const fill = asRecord(shape?.fill) ?? asRecord(element.fill);
  const gradient = presentationGradientFill(context, fill, rect);
  if (gradient) return gradient;
  return shapeFillToCss(shape, element, lineColor, rect);
}
function presentationGradientStops(fill) {
  const stops = asArray(asRecord(fill)?.gradientStops).map((stop, index) => {
    const record = asRecord(stop);
    const color = colorToCss(record?.color ?? stop);
    if (!color) return null;
    return {
      color,
      index,
      position: gradientStopPosition(record)
    };
  }).filter(
    (stop) => stop != null
  );
  return stops.map((stop) => ({
    color: stop.color,
    position: stop.position ?? (stops.length === 1 ? 0 : stop.index / (stops.length - 1))
  }));
}
function presentationGradientFill(context, fill, rect) {
  const stops = presentationGradientStops(fill);
  if (stops.length < 2) return void 0;
  const line = gradientLine(rect, gradientAngle(fill));
  const gradient = context.createLinearGradient(
    line.x1,
    line.y1,
    line.x2,
    line.y2
  );
  for (const stop of stops) {
    gradient.addColorStop(clamp(stop.position, 0, 1), stop.color);
  }
  return gradient;
}
function gradientStopPosition(stop) {
  for (const key of ["position", "offset", "pos"]) {
    const value = asNumber(stop?.[key], Number.NaN);
    if (Number.isFinite(value)) {
      return value > 1 ? clamp(value / 1e5, 0, 1) : clamp(value, 0, 1);
    }
  }
  return null;
}
function gradientAngle(fill) {
  for (const key of ["angle", "gradientAngle", "direction"]) {
    const value = asNumber(fill?.[key], Number.NaN);
    if (Number.isFinite(value)) {
      return Math.abs(value) > 360 ? value / 6e4 : value;
    }
  }
  return 0;
}
function gradientLine(rect, angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const length = Math.abs(rect.width * dx) + Math.abs(rect.height * dy);
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  return {
    x1: cx - dx * length / 2,
    x2: cx + dx * length / 2,
    y1: cy - dy * length / 2,
    y2: cy + dy * length / 2
  };
}
function isTransparentOutlineEllipse(shape, rect) {
  const fill = fillToCss(shape?.fill);
  const line = lineToCss(shape?.line);
  if (!fill || !line.color) return false;
  const isNearSquare = Math.abs(rect.width - rect.height) <= Math.max(2, Math.min(rect.width, rect.height) * 0.03);
  return isNearSquare && colorAlphaFromCss(fill) === 0 && sameBaseColor(fill, line.color);
}
function sameBaseColor(left, right) {
  return cssRgbKey(left) === cssRgbKey(right);
}
function cssRgbKey(value) {
  const hex = value.match(/^#?([0-9a-f]{6})$/i);
  if (hex) return hex[1].toLowerCase();
  const rgba = parseCssColorChannels2(value);
  if (!rgba) return value.toLowerCase();
  return rgba.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("");
}
function colorAlphaFromCss(value) {
  const channels = parseCssColorChannels2(value);
  if (!channels || channels[3] == null) return 1;
  const alpha = Number(channels[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}
function parseCssColorChannels2(value) {
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open < 0 || close <= open) return null;
  const functionName = value.slice(0, open).trim().toLowerCase();
  if (functionName !== "rgb" && functionName !== "rgba") return null;
  const channels = value.slice(open + 1, close).split(",").map((channel) => channel.trim());
  return channels.length >= 3 ? channels : null;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/presentation/presentation-layout.ts
var DEFAULT_SLIDE_BOUNDS = { width: 12192e3, height: 6858e3 };
var EMU_PER_CSS_PIXEL = 9525;
var FIT_PADDING = 48;
var MIN_ZOOM = 0.25;
var MAX_ZOOM = 6;
function computePresentationFit(viewport2, frame, options = {}) {
  const padding = options.padding ?? FIT_PADDING;
  const zoom = clamp2(options.zoom ?? 1, MIN_ZOOM, MAX_ZOOM);
  if (viewport2.width <= 0 || viewport2.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { height: 0, scale: 0, width: 0 };
  }
  const availableWidth = Math.max(1, viewport2.width - padding * 2);
  const availableHeight = Math.max(1, viewport2.height - padding * 2);
  const fitScale = Math.min(
    availableWidth / frame.width,
    availableHeight / frame.height
  );
  const scale = Math.max(0.05, fitScale) * zoom;
  return {
    height: frame.height * scale,
    scale,
    width: frame.width * scale
  };
}
function applyPresentationLayoutInheritance(slide, layouts) {
  if (layouts.length === 0) return slide;
  const layoutChain = presentationLayoutChain(slide, layouts);
  if (layoutChain.length === 0) return slide;
  const inheritedBackground = [...layoutChain].reverse().map((layout) => asRecord(layout.background)).find((background) => background != null);
  const elements = asArray(slide.elements).map(asRecord).filter((element) => element != null).map((element) => applyElementLayoutInheritance(element, layoutChain));
  return {
    ...slide,
    ...slide.background == null && inheritedBackground ? { background: inheritedBackground } : {},
    elements
  };
}
function getSlideBounds(slide, layouts = []) {
  const elements = presentationElements(slide, layouts);
  return elements.reduce(
    (acc, element) => {
      const bbox = asRecord(element.bbox);
      return {
        height: Math.max(
          acc.height,
          asNumber(bbox?.yEmu) + Math.max(0, asNumber(bbox?.heightEmu))
        ),
        width: Math.max(
          acc.width,
          asNumber(bbox?.xEmu) + Math.max(0, asNumber(bbox?.widthEmu))
        )
      };
    },
    { ...DEFAULT_SLIDE_BOUNDS }
  );
}
function getSlideFrameSize(slide, layouts = []) {
  const bounds = getSlideBounds(slide, layouts);
  return {
    height: bounds.height / EMU_PER_CSS_PIXEL,
    width: bounds.width / EMU_PER_CSS_PIXEL
  };
}
function emuRectToCanvasRect(bbox, bounds, canvas) {
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;
  return {
    height: asNumber(bbox?.heightEmu) * scaleY,
    left: asNumber(bbox?.xEmu) * scaleX,
    top: asNumber(bbox?.yEmu) * scaleY,
    width: asNumber(bbox?.widthEmu) * scaleX
  };
}
function presentationShapeKind(shape, rect) {
  const geometry = asNumber(shape?.geometry);
  if (geometry === 1 || geometry === 96 || geometry === 97 || geometry === 98 || geometry === 99 || geometry === 100 || geometry === 101 || geometry === 102 || geometry === 103) {
    return "line";
  }
  if (geometry === 3 || geometry === 23) return "triangle";
  if (geometry === 4) return "rtTriangle";
  if (geometry === 26) return "roundRect";
  if (geometry === 6 || geometry === 30 || geometry === 133) return "diamond";
  if (geometry === 7 || geometry === 31 || geometry === 134 || geometry === 141)
    return "parallelogram";
  if (geometry === 8 || geometry === 144) return "trapezoid";
  if (geometry === 10 || geometry === 37 || geometry === 160) return "pentagon";
  if (geometry === 11 || geometry === 39 || geometry === 140) return "hexagon";
  if (geometry === 17) return "star5";
  if (geometry === 18) return "star6";
  if (geometry === 20) return "star8";
  if (geometry === 25) return "star32";
  if (geometry === 32) return "snipRect";
  if (geometry === 35 || geometry === 89 || geometry === 139 || geometry === 143 || isTransparentOutlineEllipse2(shape, rect)) {
    return "ellipse";
  }
  if (geometry === 38) return "chevron";
  if (geometry === 45) return "leftArrow";
  if (geometry === 50) return "bentUpArrow";
  if (geometry === 52) return "upDownArrow";
  if (geometry === 63) return "bentArrow";
  if (geometry === 75) return "lightningBolt";
  if (geometry === 42) return "donut";
  if (geometry === 84) return "frame";
  if (geometry === 95 || geometry === 111) return "bracePair";
  if (geometry === 94 || geometry === 112) return "bracketPair";
  if (geometry === 87) return "diagStripe";
  if (geometry === 137 || geometry === 138) return "document";
  if (geometry === 150 || geometry === 151) return "extract";
  return "rect";
}
function collectPresentationTypefaces(slides, layouts = []) {
  const typefaces = /* @__PURE__ */ new Set();
  for (const slide of slides) {
    for (const element of presentationElements(slide, layouts)) {
      for (const paragraph of asArray(element.paragraphs)) {
        const paragraphRecord = asRecord(paragraph);
        const paragraphStyle2 = asRecord(paragraphRecord?.textStyle);
        const paragraphTypeface = asString(paragraphStyle2?.typeface);
        if (paragraphTypeface) typefaces.add(paragraphTypeface);
        for (const run of asArray(paragraphRecord?.runs)) {
          const runStyle = asRecord(asRecord(run)?.textStyle);
          const runTypeface = asString(runStyle?.typeface);
          if (runTypeface) typefaces.add(runTypeface);
        }
      }
    }
  }
  return Array.from(typefaces);
}
function getPresentationElementTargets(slide, canvas, layouts = []) {
  const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
  const bounds = getSlideBounds(effectiveSlide);
  return presentationElements(effectiveSlide).map((element, index) => {
    const rect = emuRectToCanvasRect(asRecord(element.bbox), bounds, canvas);
    return {
      element,
      id: asString(element.id) || `element-${index}`,
      index,
      name: asString(element.name) || asString(element.id) || String(index + 1),
      rect
    };
  }).filter(({ rect }) => rect.width > 0 && rect.height > 0).sort(
    (left, right) => asNumber(left.element.zIndex, left.index) - asNumber(right.element.zIndex, right.index)
  );
}
function presentationElements(slide, layouts = []) {
  const effectiveSlide = layouts.length > 0 ? applyPresentationLayoutInheritance(slide, layouts) : slide;
  const elements = [];
  function visit(value) {
    const record = asRecord(value);
    if (record == null) return;
    elements.push(record);
    for (const child of asArray(record.children)) {
      visit(child);
    }
  }
  for (const element of asArray(effectiveSlide.elements)) {
    visit(element);
  }
  return elements;
}
function presentationCanvasScale(bounds, canvas) {
  const frameWidth = bounds.width / EMU_PER_CSS_PIXEL;
  const frameHeight = bounds.height / EMU_PER_CSS_PIXEL;
  if (frameWidth <= 0 || frameHeight <= 0) return 1;
  return Math.min(canvas.width / frameWidth, canvas.height / frameHeight);
}
function presentationLayoutChain(slide, layouts) {
  const byId = /* @__PURE__ */ new Map();
  for (const layout of layouts) {
    const id = asString(layout.id);
    if (id) byId.set(id, layout);
  }
  const chain = [];
  const visited = /* @__PURE__ */ new Set();
  function addLayout(layoutId) {
    if (!layoutId || visited.has(layoutId)) return;
    const layout = byId.get(layoutId);
    if (!layout) return;
    visited.add(layoutId);
    addLayout(asString(layout.parentLayoutId));
    chain.push(layout);
  }
  addLayout(asString(slide.useLayoutId));
  return chain;
}
function applyElementLayoutInheritance(element, layoutChain) {
  const placeholderDefaults = layoutChain.map((layout) => findMatchingPlaceholderElement(layout, element)).filter((match) => match != null).reduce(
    (acc, match) => mergeRecordDefaults(acc, match),
    null
  );
  const mergedElement = mergeRecordDefaults(placeholderDefaults, element);
  const inheritedLevelStyles = presentationLevelStylesForElement(
    element,
    layoutChain
  );
  const paragraphs = mergeParagraphLevelStyles(
    asArray(mergedElement.paragraphs),
    inheritedLevelStyles
  );
  const children = asArray(mergedElement.children).map(asRecord).filter((child) => child != null).map((child) => applyElementLayoutInheritance(child, layoutChain));
  return {
    ...mergedElement,
    ...paragraphs.length > 0 ? { paragraphs } : {},
    ...children.length > 0 ? { children } : {}
  };
}
function findMatchingPlaceholderElement(layout, element) {
  const candidates = flattenedLayoutElements(layout);
  let best = null;
  for (const candidate of candidates) {
    const score = placeholderMatchScore(candidate, element);
    if (score > (best?.score ?? 0)) {
      best = { score, value: candidate };
    }
  }
  return best?.value ?? null;
}
function flattenedLayoutElements(layout) {
  const elements = [];
  function visit(value) {
    const record = asRecord(value);
    if (!record) return;
    elements.push(record);
    for (const child of asArray(record.children)) {
      visit(child);
    }
  }
  for (const element of asArray(layout.elements)) {
    visit(element);
  }
  return elements;
}
function placeholderMatchScore(candidate, element) {
  const candidateType = normalizedPlaceholderType(candidate);
  const elementType = normalizedPlaceholderType(element);
  const candidateIndex = asNumber(candidate.placeholderIndex, -1);
  const elementIndex = asNumber(element.placeholderIndex, -1);
  if (!candidateType && candidateIndex < 0) return 0;
  if (candidateIndex >= 0 && elementIndex >= 0 && candidateIndex === elementIndex && candidateType === elementType)
    return 4;
  if (candidateIndex > 0 && elementIndex > 0 && candidateIndex === elementIndex)
    return 3;
  if (candidateType && elementType && candidateType === elementType) return 2;
  if (!elementType && candidateIndex > 0 && candidateIndex === elementIndex)
    return 1;
  return 0;
}
function presentationLevelStylesForElement(element, layoutChain) {
  const styleField = placeholderLevelStyleField(
    normalizedPlaceholderType(element)
  );
  const byLevel = /* @__PURE__ */ new Map();
  for (const layout of layoutChain) {
    for (const style of asArray(layout[styleField]).map(asRecord)) {
      if (!style) continue;
      const level = asNumber(style.level, 1);
      byLevel.set(
        level,
        mergeRecordDefaults(byLevel.get(level) ?? null, style)
      );
    }
  }
  return Array.from(byLevel.values());
}
function placeholderLevelStyleField(placeholderType) {
  if (placeholderType === "title" || placeholderType === "ctrtitle")
    return "titleLevelStyles";
  if (placeholderType === "body" || placeholderType === "subtitle" || placeholderType === "obj")
    return "bodyLevelStyles";
  return "otherLevelStyles";
}
function mergeParagraphLevelStyles(paragraphs, levelStyles) {
  if (paragraphs.length === 0) return [];
  const byLevel = new Map(
    levelStyles.map((style) => [asNumber(style.level, 1), style])
  );
  return paragraphs.map(asRecord).filter((paragraph) => paragraph != null).map((paragraph) => {
    const level = asNumber(
      paragraph.level,
      asNumber(asRecord(paragraph.textStyle)?.level, 1)
    );
    const style = byLevel.get(level) ?? byLevel.get(1);
    if (!style) return paragraph;
    const textStyle = mergeRecordDefaults(
      asRecord(style.textStyle),
      asRecord(paragraph.textStyle)
    );
    const paragraphStyle2 = mergeRecordDefaults(
      asRecord(style.paragraphStyle),
      asRecord(paragraph.paragraphStyle)
    );
    return {
      ...copyMissingParagraphStyleFields(style, paragraph),
      ...paragraph,
      ...Object.keys(textStyle).length > 0 ? { textStyle } : {},
      ...Object.keys(paragraphStyle2).length > 0 ? { paragraphStyle: paragraphStyle2 } : {}
    };
  });
}
function copyMissingParagraphStyleFields(style, paragraph) {
  const copied = {};
  for (const key of ["spaceBefore", "spaceAfter"]) {
    if (!(key in paragraph) && key in style) {
      copied[key] = style[key];
    }
  }
  const paragraphStyle2 = asRecord(style.paragraphStyle);
  for (const key of [
    "bulletCharacter",
    "indent",
    "lineSpacing",
    "marginLeft"
  ]) {
    if (!(key in paragraph) && paragraphStyle2 && key in paragraphStyle2) {
      copied[key] = paragraphStyle2[key];
    }
  }
  return copied;
}
function normalizedPlaceholderType(element) {
  return asString(element.placeholderType).replace(/[^a-z0-9]/giu, "").toLowerCase();
}
function mergeRecordDefaults(base, override) {
  if (!base && !override) return {};
  if (!base) return { ...override ?? {} };
  if (!override) return { ...base };
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value == null) {
      result[key] = value;
      continue;
    }
    const baseValue = result[key];
    const baseRecord = asRecord(baseValue);
    const overrideRecord = asRecord(value);
    if (baseRecord && overrideRecord && !Array.isArray(baseValue) && !Array.isArray(value) && key !== "fill" && key !== "line") {
      result[key] = mergeRecordDefaults(baseRecord, overrideRecord);
    } else {
      result[key] = value;
    }
  }
  return result;
}
function isTransparentOutlineEllipse2(shape, rect) {
  const fill = fillToCss(shape?.fill);
  const line = lineToCss(shape?.line);
  if (!fill || !line.color) return false;
  const isNearSquare = Math.abs(rect.width - rect.height) <= Math.max(2, Math.min(rect.width, rect.height) * 0.03);
  return isNearSquare && colorAlphaFromCss2(fill) === 0 && sameBaseColor2(fill, line.color);
}
function sameBaseColor2(left, right) {
  return cssRgbKey2(left) === cssRgbKey2(right);
}
function cssRgbKey2(value) {
  const hex = value.match(/^#?([0-9a-f]{6})$/i);
  if (hex) return hex[1].toLowerCase();
  const rgba = parseCssColorChannels3(value);
  if (!rgba) return value.toLowerCase();
  return rgba.map((channel) => Number(channel).toString(16).padStart(2, "0")).join("");
}
function colorAlphaFromCss2(value) {
  const channels = parseCssColorChannels3(value);
  if (!channels || channels[3] == null) return 1;
  const alpha = Number(channels[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}
function parseCssColorChannels3(value) {
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open < 0 || close <= open) return null;
  const functionName = value.slice(0, open).trim().toLowerCase();
  if (functionName !== "rgb" && functionName !== "rgba") return null;
  const channels = value.slice(open + 1, close).split(",").map((channel) => channel.trim());
  return channels.length >= 3 ? channels : null;
}
function clamp2(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/presentation/presentation-line-styles.ts
var EMU_PER_CSS_PIXEL2 = 9525;
function presentationLineStyle(line, slideScale) {
  const lineRecord = asRecord(line);
  const fillRecord = asRecord(lineRecord?.fill);
  const rawWidthEmu = asNumber(lineRecord?.widthEmu);
  const width = rawWidthEmu > 0 ? rawWidthEmu / EMU_PER_CSS_PIXEL2 : 1;
  const scaledWidth = Math.max(0.5, width * Math.max(0.01, slideScale));
  return {
    color: colorToCss(fillRecord?.color),
    dash: presentationLineDash(asNumber(lineRecord?.style), scaledWidth),
    headEnd: presentationLineEndStyle(
      lineRecord?.headEnd ?? lineRecord?.head,
      scaledWidth
    ),
    lineCap: presentationLineCap(asNumber(lineRecord?.cap)),
    lineJoin: presentationLineJoin(asNumber(lineRecord?.join)),
    tailEnd: presentationLineEndStyle(
      lineRecord?.tailEnd ?? lineRecord?.tail,
      scaledWidth
    ),
    width: scaledWidth
  };
}
function presentationElementLineStyle(element, slideScale) {
  const shapeLine = asRecord(asRecord(element.shape)?.line) ?? asRecord(element.line);
  const connectorLine = asRecord(asRecord(element.connector)?.lineStyle);
  if (!connectorLine) return presentationLineStyle(shapeLine, slideScale);
  return presentationLineStyle(
    {
      ...shapeLine,
      cap: connectorLine.cap ?? shapeLine?.cap,
      head: connectorLine.head ?? connectorLine.headEnd ?? shapeLine?.head,
      headEnd: connectorLine.headEnd ?? connectorLine.head ?? shapeLine?.headEnd,
      join: connectorLine.join ?? shapeLine?.join,
      tail: connectorLine.tail ?? connectorLine.tailEnd ?? shapeLine?.tail,
      tailEnd: connectorLine.tailEnd ?? connectorLine.tail ?? shapeLine?.tailEnd
    },
    slideScale
  );
}
function applyLineStyle(context, line) {
  context.strokeStyle = line.color ?? "#0f172a";
  context.lineWidth = line.width;
  context.lineCap = line.lineCap;
  context.lineJoin = line.lineJoin;
  context.setLineDash(line.dash);
}
function presentationLineCap(cap) {
  if (cap === 2) return "square";
  if (cap === 3) return "round";
  return "butt";
}
function presentationLineJoin(join) {
  if (join === 1) return "round";
  if (join === 2) return "bevel";
  return "miter";
}
function presentationLineDash(style, width) {
  const unit = Math.max(1, width);
  if (style === 2) return [unit * 4, unit * 2];
  if (style === 3) return [unit, unit * 2];
  if (style === 4) return [unit * 8, unit * 3];
  if (style === 5) return [unit * 8, unit * 3, unit, unit * 3];
  if (style === 6) return [unit * 8, unit * 3, unit, unit * 3, unit, unit * 3];
  return [];
}
function presentationLineEndStyle(end, lineWidth) {
  const record = asRecord(end);
  const type = asNumber(record?.type);
  if (!record || type <= 0) return null;
  return {
    length: lineEndScale(asNumber(record.length, 2), lineWidth),
    type,
    width: lineEndScale(asNumber(record.width, 2), lineWidth)
  };
}
function lineEndScale(value, lineWidth) {
  const multiplier = value <= 1 ? 2.5 : value === 2 ? 3.5 : value === 3 ? 5 : Math.min(value, 6);
  return Math.max(5, lineWidth * multiplier);
}
function drawLineEnd(context, width, height, end, color, atTail) {
  if (!end) return;
  const from = atTail ? { x: width, y: height } : { x: 0, y: 0 };
  const to = atTail ? { x: 0, y: 0 } : { x: width, y: height };
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const x = atTail ? 0 : width;
  const y = atTail ? 0 : height;
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = color;
  context.beginPath();
  if (end.type === 5) {
    context.ellipse(
      -end.length / 2,
      0,
      end.width / 2,
      end.width / 2,
      0,
      0,
      Math.PI * 2
    );
  } else {
    context.moveTo(0, 0);
    context.lineTo(-end.length, -end.width / 2);
    context.lineTo(-end.length, end.width / 2);
    context.closePath();
  }
  context.fill();
  context.restore();
}
function presentationShadowStyle(element, slideScale) {
  for (const effect of asArray(element.effects)) {
    const shadow = asRecord(asRecord(effect)?.shadow);
    const color = colorToCss(shadow?.color);
    if (!shadow || !color || colorAlphaFromCss3(color) <= 0) {
      continue;
    }
    const distance = asNumber(shadow.distance) / EMU_PER_CSS_PIXEL2 * Math.max(0.01, slideScale);
    const direction = asNumber(shadow.direction) / 6e4 / 180 * Math.PI;
    return {
      blur: Math.max(
        0,
        asNumber(shadow.blurRadius) / EMU_PER_CSS_PIXEL2 * Math.max(0.01, slideScale)
      ),
      color,
      offsetX: Math.cos(direction) * distance,
      offsetY: Math.sin(direction) * distance
    };
  }
  return null;
}
function applyElementShadow(context, element, slideScale) {
  const shadow = presentationShadowStyle(element, slideScale);
  if (!shadow) return;
  context.shadowBlur = shadow.blur;
  context.shadowColor = shadow.color;
  context.shadowOffsetX = shadow.offsetX;
  context.shadowOffsetY = shadow.offsetY;
}
function colorAlphaFromCss3(value) {
  const channels = parseCssColorChannels4(value);
  if (!channels || channels[3] == null) return 1;
  const alpha = Number(channels[3]);
  return Number.isFinite(alpha) ? alpha : 1;
}
function parseCssColorChannels4(value) {
  const open = value.indexOf("(");
  const close = value.lastIndexOf(")");
  if (open < 0 || close <= open) return null;
  const functionName = value.slice(0, open).trim().toLowerCase();
  if (functionName !== "rgb" && functionName !== "rgba") return null;
  const channels = value.slice(open + 1, close).split(",").map((channel) => channel.trim());
  return channels.length >= 3 ? channels : null;
}

// src/presentation/presentation-shape-paths.ts
function elementPath(kind, rect) {
  const path = new Path2D();
  if (kind === "ellipse") {
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2
    );
    return path;
  }
  if (kind === "roundRect") {
    const radius = Math.min(rect.width, rect.height) * 0.08;
    roundedRect(path, 0, 0, rect.width, rect.height, radius);
    return path;
  }
  if (kind === "triangle") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height],
      [0, rect.height]
    ]);
    return path;
  }
  if (kind === "rtTriangle") {
    polygon(path, [
      [0, 0],
      [rect.width, rect.height],
      [0, rect.height]
    ]);
    return path;
  }
  if (kind === "diamond") {
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, rect.height / 2],
      [rect.width / 2, rect.height],
      [0, rect.height / 2]
    ]);
    return path;
  }
  if (kind === "pentagon") {
    polygon(path, [
      [0, 0],
      [rect.width, 0],
      [rect.width, rect.height * 0.72],
      [rect.width / 2, rect.height],
      [0, rect.height * 0.72]
    ]);
    return path;
  }
  if (kind === "chevron") {
    const inset = Math.min(rect.width * 0.38, rect.height * 0.5);
    polygon(path, [
      [0, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height / 2],
      [rect.width - inset, rect.height],
      [0, rect.height],
      [inset, rect.height / 2]
    ]);
    return path;
  }
  if (kind === "star5" || kind === "star6" || kind === "star8" || kind === "star32") {
    const points = kind === "star32" ? 32 : kind === "star8" ? 8 : kind === "star6" ? 6 : 5;
    starPath(
      path,
      rect.width / 2,
      rect.height / 2,
      Math.min(rect.width, rect.height) / 2,
      Math.min(rect.width, rect.height) * 0.2,
      points
    );
    return path;
  }
  if (kind === "donut") {
    const radius = Math.min(rect.width, rect.height) / 2;
    const innerRadius = radius * 0.45;
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      radius,
      radius,
      0,
      0,
      Math.PI * 2
    );
    path.ellipse(
      rect.width / 2,
      rect.height / 2,
      innerRadius,
      innerRadius,
      0,
      0,
      Math.PI * 2,
      true
    );
    return path;
  }
  if (kind === "frame") {
    const inset = Math.min(rect.width, rect.height) * 0.16;
    path.rect(0, 0, rect.width, rect.height);
    const innerWidth = Math.max(0, rect.width - inset * 2);
    const innerHeight = Math.max(0, rect.height - inset * 2);
    path.moveTo(inset, inset);
    path.lineTo(inset, inset + innerHeight);
    path.lineTo(inset + innerWidth, inset + innerHeight);
    path.lineTo(inset + innerWidth, inset);
    path.closePath();
    return path;
  }
  if (kind === "document") {
    const wave = Math.min(rect.height * 0.18, rect.width * 0.08);
    path.moveTo(0, 0);
    path.lineTo(rect.width, 0);
    path.lineTo(rect.width, rect.height - wave);
    path.bezierCurveTo(
      rect.width * 0.66,
      rect.height + wave,
      rect.width * 0.34,
      rect.height - wave * 2,
      0,
      rect.height
    );
    path.closePath();
    return path;
  }
  if (kind === "extract") {
    polygon(path, [
      [0, 0],
      [rect.width, 0],
      [rect.width / 2, rect.height]
    ]);
    return path;
  }
  if (kind === "parallelogram") {
    const skew = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [skew, 0],
      [rect.width, 0],
      [rect.width - skew, rect.height],
      [0, rect.height]
    ]);
    return path;
  }
  if (kind === "diagStripe") {
    const skew = Math.min(rect.width * 0.45, rect.height * 0.55);
    polygon(path, [
      [skew, 0],
      [rect.width, 0],
      [rect.width - skew, rect.height],
      [0, rect.height]
    ]);
    return path;
  }
  if (kind === "snipRect") {
    const snip = Math.min(rect.width, rect.height) * 0.18;
    polygon(path, [
      [snip, 0],
      [rect.width, 0],
      [rect.width, rect.height - snip],
      [rect.width - snip, rect.height],
      [0, rect.height],
      [0, snip]
    ]);
    return path;
  }
  if (kind === "leftArrow") {
    const head = Math.min(rect.width * 0.42, rect.height * 0.5);
    const shaftTop = rect.height * 0.28;
    const shaftBottom = rect.height * 0.72;
    polygon(path, [
      [0, rect.height / 2],
      [head, 0],
      [head, shaftTop],
      [rect.width, shaftTop],
      [rect.width, shaftBottom],
      [head, shaftBottom],
      [head, rect.height]
    ]);
    return path;
  }
  if (kind === "upDownArrow") {
    const head = Math.min(rect.width * 0.42, rect.height * 0.28);
    const shaftLeft = rect.width * 0.32;
    const shaftRight = rect.width * 0.68;
    polygon(path, [
      [rect.width / 2, 0],
      [rect.width, head],
      [shaftRight, head],
      [shaftRight, rect.height - head],
      [rect.width, rect.height - head],
      [rect.width / 2, rect.height],
      [0, rect.height - head],
      [shaftLeft, rect.height - head],
      [shaftLeft, head],
      [0, head]
    ]);
    return path;
  }
  if (kind === "lightningBolt") {
    polygon(path, [
      [rect.width * 0.58, 0],
      [rect.width * 0.18, rect.height * 0.55],
      [rect.width * 0.46, rect.height * 0.55],
      [rect.width * 0.32, rect.height],
      [rect.width * 0.82, rect.height * 0.38],
      [rect.width * 0.54, rect.height * 0.38]
    ]);
    return path;
  }
  if (kind === "bentUpArrow" || kind === "bentArrow") {
    const head = Math.min(rect.width * 0.36, rect.height * 0.32);
    const shaft = Math.min(rect.width, rect.height) * 0.28;
    const verticalX = kind === "bentArrow" ? rect.width - shaft : rect.width - head;
    polygon(path, [
      [verticalX, 0],
      [rect.width, head],
      [verticalX + shaft / 2, head],
      [verticalX + shaft / 2, rect.height],
      [0, rect.height],
      [0, rect.height - shaft],
      [verticalX - shaft / 2, rect.height - shaft],
      [verticalX - shaft / 2, head],
      [verticalX - head, head]
    ]);
    return path;
  }
  if (kind === "trapezoid") {
    const inset = Math.min(rect.width / 3, rect.width * 0.18);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height],
      [0, rect.height]
    ]);
    return path;
  }
  if (kind === "hexagon") {
    const inset = Math.min(rect.width / 3, rect.width * 0.24);
    polygon(path, [
      [inset, 0],
      [rect.width - inset, 0],
      [rect.width, rect.height / 2],
      [rect.width - inset, rect.height],
      [inset, rect.height],
      [0, rect.height / 2]
    ]);
    return path;
  }
  if (kind === "bracePair" || kind === "bracketPair") {
    drawBracketLikePath(path, rect, kind);
    return path;
  }
  path.rect(0, 0, rect.width, rect.height);
  return path;
}
function customGeometryPath(shape, rect) {
  const paths = Array.isArray(shape?.customPaths) ? shape.customPaths : [];
  if (paths.length === 0) return null;
  const result = new Path2D();
  let hasCommands = false;
  for (const rawPath of paths) {
    const customPath = asRecord(rawPath);
    const width = asNumber(customPath?.widthEmu, rect.width);
    const height = asNumber(customPath?.heightEmu, rect.height);
    const scaleX = width === 0 ? 1 : rect.width / width;
    const scaleY = height === 0 ? 1 : rect.height / height;
    const commands = Array.isArray(customPath?.commands) ? customPath.commands : [];
    for (const rawCommand of commands) {
      const command = asRecord(rawCommand);
      if (!command) continue;
      const moveTo = asRecord(command.moveTo);
      const lineTo = asRecord(command.lineTo);
      const close = asRecord(command.close);
      const quadBezTo = asRecord(command.quadBezTo);
      const cubicBezTo = asRecord(command.cubicBezTo);
      if (moveTo) {
        result.moveTo(asNumber(moveTo.x) * scaleX, asNumber(moveTo.y) * scaleY);
        hasCommands = true;
      } else if (lineTo) {
        result.lineTo(asNumber(lineTo.x) * scaleX, asNumber(lineTo.y) * scaleY);
        hasCommands = true;
      } else if (quadBezTo) {
        result.quadraticCurveTo(
          asNumber(quadBezTo.x1) * scaleX,
          asNumber(quadBezTo.y1) * scaleY,
          asNumber(quadBezTo.x) * scaleX,
          asNumber(quadBezTo.y) * scaleY
        );
        hasCommands = true;
      } else if (cubicBezTo) {
        result.bezierCurveTo(
          asNumber(cubicBezTo.x1) * scaleX,
          asNumber(cubicBezTo.y1) * scaleY,
          asNumber(cubicBezTo.x2) * scaleX,
          asNumber(cubicBezTo.y2) * scaleY,
          asNumber(cubicBezTo.x) * scaleX,
          asNumber(cubicBezTo.y) * scaleY
        );
        hasCommands = true;
      } else if (close) {
        result.closePath();
      }
    }
  }
  return hasCommands ? result : null;
}
function polygon(path, points) {
  const [first, ...rest] = points;
  if (!first) return;
  path.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    path.lineTo(x, y);
  }
  path.closePath();
}
function starPath(path, centerX, centerY, outerRadius, innerRadius, points) {
  const steps = points * 2;
  for (let index = 0; index < steps; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + index / steps * Math.PI * 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    if (index === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  }
  path.closePath();
}
function drawBracketLikePath(path, rect, kind) {
  const strokeWidth = Math.max(1, Math.min(rect.width, rect.height) * 0.08);
  const inset = Math.min(rect.width * 0.2, strokeWidth * 2);
  if (kind === "bracketPair") {
    roundedRect(path, 0, 0, inset, rect.height, strokeWidth);
    roundedRect(path, rect.width - inset, 0, inset, rect.height, strokeWidth);
    return;
  }
  path.moveTo(inset, 0);
  path.quadraticCurveTo(0, rect.height * 0.25, inset, rect.height * 0.5);
  path.quadraticCurveTo(0, rect.height * 0.75, inset, rect.height);
  path.lineTo(inset + strokeWidth, rect.height);
  path.quadraticCurveTo(
    strokeWidth,
    rect.height * 0.75,
    inset + strokeWidth,
    rect.height * 0.5
  );
  path.quadraticCurveTo(
    strokeWidth,
    rect.height * 0.25,
    inset + strokeWidth,
    0
  );
  path.closePath();
  path.moveTo(rect.width - inset, 0);
  path.quadraticCurveTo(
    rect.width,
    rect.height * 0.25,
    rect.width - inset,
    rect.height * 0.5
  );
  path.quadraticCurveTo(
    rect.width,
    rect.height * 0.75,
    rect.width - inset,
    rect.height
  );
  path.lineTo(rect.width - inset - strokeWidth, rect.height);
  path.quadraticCurveTo(
    rect.width - strokeWidth,
    rect.height * 0.75,
    rect.width - inset - strokeWidth,
    rect.height * 0.5
  );
  path.quadraticCurveTo(
    rect.width - strokeWidth,
    rect.height * 0.25,
    rect.width - inset - strokeWidth,
    0
  );
  path.closePath();
}
function roundedRect(path, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + height - r);
  path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  path.lineTo(x + r, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}

// src/presentation/presentation-text-layout.ts
var PRESENTATION_POINT_TO_CSS_PIXEL = 1.333;
var POWERPOINT_WRAP_WIDTH_FACTOR = 1;
function presentationScaledFontSize(fontSize, slideScale, fallbackPx = 14) {
  const baseFontSize = cssFontSize(fontSize, fallbackPx) * PRESENTATION_POINT_TO_CSS_PIXEL;
  return Math.max(1, baseFontSize * Math.max(0.01, slideScale));
}
function drawPresentationTextBox({
  canvas,
  context,
  element,
  rect,
  slideBounds,
  slideScale,
  textOverflow
}) {
  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, EMPTY_OFFICE_TEXT_STYLE_MAPS));
  if (paragraphs.length === 0) return;
  const textStyle = asRecord(element.textStyle);
  const insets = textInsets(textStyle, rect, canvas.width / slideBounds.width, canvas.height / slideBounds.height);
  const maxWidth = Math.max(1, rect.width - insets.left - insets.right);
  const maxHeight = Math.max(1, rect.height - insets.top - insets.bottom);
  const layout = layoutTextFrame(context, paragraphs, {
    autoFit: asRecord(textStyle?.autoFit) != null,
    emuScaleX: canvas.width / slideBounds.width,
    maxHeight,
    maxWidth: presentationEffectiveTextMaxWidth(maxWidth, asNumber(textStyle?.wrap, 2) !== 1),
    slideScale,
    useParagraphSpacing: textStyle?.useParagraphSpacing !== false && paragraphs.length > 1,
    wrap: asNumber(textStyle?.wrap, 2) !== 1
  });
  const verticalOffset = verticalTextOffset(asNumber(textStyle?.anchor), layout.height, maxHeight);
  context.save();
  if (textOverflow === "clip") {
    context.beginPath();
    context.rect(0, 0, rect.width, rect.height);
    context.clip();
  }
  context.textBaseline = "top";
  for (const segment of layout.segments) {
    applyRunFont(context, segment.run, segment.fontSize);
    context.fillStyle = colorToCss(asRecord(segment.run.style?.fill)?.color) ?? "#0f172a";
    const segmentX = insets.left + segment.x;
    const segmentY = insets.top + verticalOffset + segment.y;
    context.fillText(segment.text, segmentX, segmentY);
    if (segment.run.style?.underline === true) {
      const underlineY = segmentY + segment.fontSize * 1.08;
      context.beginPath();
      context.moveTo(segmentX, underlineY);
      context.lineTo(segmentX + segment.width, underlineY);
      context.lineWidth = Math.max(1, segment.fontSize / 18);
      context.strokeStyle = context.fillStyle;
      context.stroke();
    }
  }
  context.restore();
}
function layoutTextFrame(context, paragraphs, options) {
  const layout = layoutTextRuns(context, paragraphs, options, 1);
  if (layout.height <= options.maxHeight || !shouldShrinkTextFrame(paragraphs, options)) {
    return layout;
  }
  let fontScale = 1;
  for (const nextScale of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65]) {
    const nextLayout = layoutTextRuns(context, paragraphs, options, nextScale);
    fontScale = nextScale;
    if (nextLayout.height <= options.maxHeight) {
      return nextLayout;
    }
  }
  return layoutTextRuns(context, paragraphs, options, fontScale);
}
function layoutTextRuns(context, paragraphs, options, fontScale) {
  const segments = [];
  const { emuScaleX, maxWidth, slideScale, wrap } = options;
  let y = 0;
  let line = [];
  let lineAlignment = 1;
  let lineHeight = defaultLineHeight(slideScale);
  let lineSpacing = 1;
  let lineWidth = 0;
  let activeAlignment = 1;
  let activeLineSpacing = 1;
  let activeParagraphStartX = 0;
  let inheritedEmptyLineHeight = defaultLineHeight(slideScale);
  let paragraphStartX = 0;
  function resetLine() {
    line = [];
    lineAlignment = activeAlignment;
    lineHeight = defaultLineHeight(slideScale);
    lineSpacing = activeLineSpacing;
    lineWidth = 0;
    paragraphStartX = activeParagraphStartX;
  }
  function flushLine(includeEmptyLine = false) {
    if (line.length === 0) {
      if (includeEmptyLine) {
        y += lineHeight * lineSpacing;
      }
      resetLine();
      return;
    }
    const availableWidth = Math.max(1, maxWidth - paragraphStartX);
    const offsetX = paragraphStartX + lineAlignmentOffset(lineAlignment, lineWidth, availableWidth);
    for (const segment of line) {
      segments.push({ ...segment, x: segment.x + offsetX, y });
    }
    y += lineHeight * lineSpacing;
    resetLine();
  }
  function setParagraphOptions(paragraph) {
    activeAlignment = paragraphAlignment(paragraph);
    activeLineSpacing = paragraphLineSpacing(paragraph);
    activeParagraphStartX = paragraphStartOffset(paragraph, emuScaleX);
    if (line.length === 0 && lineWidth === 0) {
      lineAlignment = activeAlignment;
      lineSpacing = activeLineSpacing;
      paragraphStartX = activeParagraphStartX;
    }
  }
  function pushTextSegment(run, text, width, fontSize) {
    if (line.length === 0 && lineWidth === 0) {
      lineAlignment = activeAlignment;
      lineSpacing = activeLineSpacing;
      paragraphStartX = activeParagraphStartX;
    }
    const nextLineHeight = fontSize * 1.18;
    line.push({
      fontSize,
      run,
      text,
      width,
      x: lineWidth,
      y: 0
    });
    lineWidth += width;
    lineHeight = Math.max(lineHeight, nextLineHeight);
    inheritedEmptyLineHeight = lineHeight;
  }
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    setParagraphOptions(paragraph);
    y += presentationParagraphSpacingPx(paragraph.style?.spaceBefore, slideScale, false);
    const bullet = paragraphBullet(paragraph);
    if (bullet) {
      const bulletRun = paragraph.runs[0] ?? { id: `${paragraph.id}-bullet`, style: paragraph.style, text: bullet };
      const bulletFontSize = runFontSize(bulletRun, slideScale, fontScale);
      applyRunFont(context, bulletRun, bulletFontSize);
      pushTextSegment(bulletRun, `${bullet} `, context.measureText(`${bullet} `).width, bulletFontSize);
    }
    if (paragraph.runs.length === 0) {
      lineHeight = Math.max(lineHeight, inheritedEmptyLineHeight);
      flushLine(true);
      y += presentationParagraphSpacingPx(
        paragraph.style?.spaceAfter,
        slideScale,
        options.useParagraphSpacing && paragraphIndex < paragraphs.length - 1
      );
      continue;
    }
    for (const run of paragraph.runs) {
      const fontSize = runFontSize(run, slideScale, fontScale);
      applyRunFont(context, run, fontSize);
      lineHeight = Math.max(lineHeight, fontSize * 1.18);
      const tokens = textTokens(run.text);
      for (const token of tokens) {
        if (token === "\n") {
          flushLine(true);
          continue;
        }
        const tokenWidth = context.measureText(token).width;
        const availableWidth = Math.max(1, maxWidth - paragraphStartX);
        if (wrap && lineWidth > 0 && lineWidth + tokenWidth > availableWidth) {
          flushLine();
        }
        if (!wrap || tokenWidth <= availableWidth || token.trim() === "" || lineWidth === 0 && Array.from(token).length <= 4) {
          pushTextSegment(run, token, tokenWidth, fontSize);
          continue;
        }
        for (const char of wrapCharacters(token)) {
          const charWidth = context.measureText(char).width;
          if (lineWidth > 0 && lineWidth + charWidth > availableWidth) {
            flushLine();
          }
          pushTextSegment(run, char, charWidth, fontSize);
        }
      }
    }
    flushLine();
    y += presentationParagraphSpacingPx(
      paragraph.style?.spaceAfter,
      slideScale,
      options.useParagraphSpacing && paragraphIndex < paragraphs.length - 1
    );
  }
  return { height: y, segments };
}
function shouldShrinkTextFrame(paragraphs, options) {
  return options.autoFit || paragraphs.some((paragraph) => asRecord(paragraph.style?.autoFit) != null);
}
function textInsets(textStyle, rect, scaleX, scaleY) {
  const defaultX = Math.max(2, Math.min(12, rect.height * 0.04));
  const defaultY = Math.max(2, Math.min(12, rect.height * 0.035));
  return {
    bottom: insetPx(textStyle?.bottomInset, scaleY, defaultY, rect.height * 0.45),
    left: insetPx(textStyle?.leftInset, scaleX, defaultX, rect.width * 0.45),
    right: insetPx(textStyle?.rightInset, scaleX, defaultX, rect.width * 0.45),
    top: insetPx(textStyle?.topInset, scaleY, defaultY, rect.height * 0.45)
  };
}
function insetPx(value, scale, fallback, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  return clamp3(value * scale, 0, max);
}
function verticalTextOffset(anchor, contentHeight, maxHeight) {
  if (contentHeight >= maxHeight) return 0;
  if (anchor === 2 || anchor === 4 || anchor === 5) return (maxHeight - contentHeight) / 2;
  if (anchor === 3) return maxHeight - contentHeight;
  return 0;
}
function paragraphAlignment(paragraph) {
  const alignment = asNumber(paragraph.style?.alignment);
  return alignment > 0 ? alignment : 1;
}
function paragraphLineSpacing(paragraph) {
  const percent = asNumber(paragraph.style?.lineSpacingPercent);
  if (percent > 0) return clamp3(percent / 118e3, 0.6, 3);
  const raw = asNumber(paragraph.style?.lineSpacing);
  if (raw > 1e4) return clamp3(raw / 118e3, 0.6, 3);
  if (raw > 0) return clamp3(raw, 0.6, 3);
  return 1;
}
function paragraphStartOffset(paragraph, emuScaleX) {
  const marginLeft = asNumber(paragraph.style?.marginLeft);
  const indent = asNumber(paragraph.style?.indent);
  return Math.max(0, (marginLeft + indent) * emuScaleX);
}
function paragraphBullet(paragraph) {
  const bullet = asString(paragraph.style?.bulletCharacter);
  return bullet.trim();
}
function presentationEffectiveTextMaxWidth(maxWidth, wrap) {
  if (!wrap) return maxWidth;
  return Math.max(1, maxWidth * POWERPOINT_WRAP_WIDTH_FACTOR);
}
function presentationParagraphSpacingPx(value, slideScale, useDefaultParagraphSpacing = false) {
  const raw = asNumber(value);
  if (raw <= 0) {
    return useDefaultParagraphSpacing ? Math.max(0, raw) * Math.max(0.01, slideScale) : 0;
  }
  return Math.min(24, raw / 20) * Math.max(0.01, slideScale);
}
function lineAlignmentOffset(alignment, lineWidth, maxWidth) {
  if (alignment === 2) return Math.max(0, (maxWidth - lineWidth) / 2);
  if (alignment === 3) return Math.max(0, maxWidth - lineWidth);
  return 0;
}
function textTokens(text) {
  const tokens = [];
  for (const part of text.split(/(\n|\s+)/u)) {
    if (!part) continue;
    if (part === "\n") {
      tokens.push(part);
      continue;
    }
    if (/^\s+$/u.test(part)) {
      tokens.push(part);
      continue;
    }
    tokens.push(part);
  }
  return tokens;
}
function wrapCharacters(text) {
  const chunks = [];
  for (const char of Array.from(text)) {
    if (isClosingPunctuation(char) && chunks.length > 0) {
      chunks[chunks.length - 1] += char;
      continue;
    }
    chunks.push(char);
  }
  return chunks;
}
function isClosingPunctuation(char) {
  return /^[,.;:!?，。！？；：、）】》」』”’)]$/u.test(char);
}
function applyRunFont(context, run, fontSize) {
  const fontStyle = run.style?.italic === true ? "italic" : "normal";
  const fontWeight = run.style?.bold === true ? "700" : "400";
  configureCanvasTextQuality(context);
  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${officeFontFamily(asString(run.style?.typeface))}`;
}
function configureCanvasTextQuality(context) {
  const qualityContext = context;
  qualityContext.fontKerning = "normal";
  qualityContext.letterSpacing = "0px";
  qualityContext.textRendering = "optimizeLegibility";
  qualityContext.wordSpacing = "0px";
}
function runFontSize(run, slideScale, fontScale = 1) {
  return presentationScaledFontSize(run.style?.fontSize, slideScale) * fontScale;
}
function defaultLineHeight(slideScale) {
  return Math.max(1, 16 * Math.max(0.01, slideScale));
}
function clamp3(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/presentation/presentation-table-renderer.ts
var EMU_PER_CSS_PIXEL3 = 9525;
function presentationTableGrid(table, rect) {
  const rows = asArray(table.rows).map(asRecord).filter((row) => row != null);
  const maxColumns = Math.max(
    1,
    rows.reduce((max, row) => {
      let count = 0;
      for (const cell of asArray(row.cells).map(asRecord)) {
        if (!cell) continue;
        count += Math.max(1, asNumber(cell.gridSpan, 1));
      }
      return Math.max(max, count);
    }, 0)
  );
  const columnSource = asArray(table.columns ?? table.columnWidths ?? table.gridColumns).map((value) => asNumber(value)).filter((value) => value > 0).slice(0, maxColumns);
  const rowSource = rows.map((row) => asNumber(row.heightEmu ?? row.height)).filter((value) => value > 0);
  return {
    columns: normalizeLengths(columnSource, maxColumns, rect.width),
    rows: normalizeLengths(rowSource, rows.length, rect.height)
  };
}
function drawPresentationTable(context, element, table, rect, bounds, canvas, slideScale) {
  const rows = asArray(table.rows).map(asRecord).filter((row) => row != null);
  if (rows.length === 0) return;
  const tableFill = fillToCss(asRecord(table.properties)?.fill ?? asRecord(table.tableProperties)?.fill);
  if (tableFill) {
    context.fillStyle = tableFill;
    context.fillRect(0, 0, rect.width, rect.height);
  }
  const grid = presentationTableGrid(table, rect);
  let y = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const rowHeight = grid.rows[rowIndex] ?? 0;
    const cells = asArray(row.cells).map(asRecord).filter((cell) => cell != null);
    let x = 0;
    let columnIndex = 0;
    for (const cell of cells) {
      const columnSpan = Math.max(1, asNumber(cell.gridSpan, 1));
      const rowSpan = Math.max(1, asNumber(cell.rowSpan, 1));
      const cellWidth = sumLengths(grid.columns, columnIndex, columnSpan);
      const cellHeight = sumLengths(grid.rows, rowIndex, rowSpan);
      const horizontalMerge = cell.horizontalMerge === true || cell.hMerge === true;
      const verticalMerge = cell.verticalMerge === true || cell.vMerge === true;
      if (!horizontalMerge && !verticalMerge && cellWidth > 0 && cellHeight > 0) {
        drawPresentationTableCellBackground(context, cell, tableFill, x, y, cellWidth, cellHeight);
        drawPresentationTableCellText(context, element, cell, {
          canvas,
          height: cellHeight,
          left: x,
          slideBounds: bounds,
          slideScale,
          top: y,
          width: cellWidth
        });
        drawPresentationTableCellBorders(context, cell, x, y, cellWidth, cellHeight, slideScale);
      }
      x += cellWidth;
      columnIndex += columnSpan;
    }
    y += rowHeight;
  }
}
function drawPresentationTableCellBackground(context, cell, tableFill, x, y, width, height) {
  const fill = fillToCss(cell.fill) ?? fillToCss(asRecord(cell.properties)?.fill) ?? fillToCss(asRecord(cell.tableCellProperties)?.fill) ?? tableFill;
  if (!fill) return;
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
}
function drawPresentationTableCellText(context, element, cell, options) {
  const paragraphs = tableCellParagraphs(cell);
  if (paragraphs.length === 0) return;
  const textStyle = {
    ...asRecord(element.textStyle) ?? {},
    ...asRecord(cell.textStyle) ?? {},
    anchor: tableCellAnchor(asString(cell.anchor), asNumber(asRecord(cell.textStyle)?.anchor)),
    ...definedInset("bottomInset", cell.bottomMargin),
    ...definedInset("leftInset", cell.leftMargin),
    ...definedInset("rightInset", cell.rightMargin),
    ...definedInset("topInset", cell.topMargin)
  };
  context.save();
  context.translate(options.left, options.top);
  drawPresentationTextBox({
    canvas: options.canvas,
    context,
    element: {
      ...element,
      paragraphs,
      textStyle
    },
    rect: {
      height: options.height,
      left: 0,
      top: 0,
      width: options.width
    },
    slideBounds: options.slideBounds,
    slideScale: options.slideScale,
    textOverflow: "clip"
  });
  context.restore();
}
function tableCellParagraphs(cell) {
  const paragraphs = asArray(cell.paragraphs);
  if (paragraphs.length > 0) return paragraphs;
  const text = asString(cell.text);
  if (!text) return [];
  return text.split(/\n/u).map((line) => ({
    runs: [{ text: line }]
  }));
}
function tableCellAnchor(anchor, fallback) {
  const normalized = anchor.toLowerCase();
  if (normalized === "ctr" || normalized === "center" || normalized === "middle") return 2;
  if (normalized === "b" || normalized === "bottom") return 3;
  return fallback;
}
function definedInset(key, value) {
  const raw = asNumber(value, Number.NaN);
  if (!Number.isFinite(raw)) return {};
  return { [key]: Math.max(0, raw) };
}
function drawPresentationTableCellBorders(context, cell, x, y, width, height, slideScale) {
  const borders = asRecord(cell.borders ?? cell.lines);
  const defaultLine = { color: "rgba(148, 163, 184, 0.35)", dash: [], width: Math.max(0.5, slideScale) };
  const top = tableCellBorderLine(borders, ["top", "topBorder", "topLine"], slideScale) ?? defaultLine;
  const right = tableCellBorderLine(borders, ["right", "rightBorder", "rightLine"], slideScale) ?? defaultLine;
  const bottom = tableCellBorderLine(borders, ["bottom", "bottomBorder", "bottomLine"], slideScale) ?? defaultLine;
  const left = tableCellBorderLine(borders, ["left", "leftBorder", "leftLine"], slideScale) ?? defaultLine;
  drawBorderSegment(context, top, x, y, x + width, y);
  drawBorderSegment(context, right, x + width, y, x + width, y + height);
  drawBorderSegment(context, bottom, x, y + height, x + width, y + height);
  drawBorderSegment(context, left, x, y, x, y + height);
}
function tableCellBorderLine(borders, keys, slideScale) {
  for (const key of keys) {
    const line = asRecord(borders?.[key]);
    if (!line) continue;
    const style = tableLineStyle(line, slideScale);
    if (style.color) {
      return { color: style.color, dash: style.dash, width: style.width };
    }
  }
  return null;
}
function tableLineStyle(line, slideScale) {
  const fill = asRecord(line.fill);
  const rawWidthEmu = asNumber(line.widthEmu);
  const width = rawWidthEmu > 0 ? rawWidthEmu / EMU_PER_CSS_PIXEL3 : 1;
  const scaledWidth = Math.max(0.5, width * Math.max(0.01, slideScale));
  return {
    color: colorToCss(fill?.color),
    dash: tableLineDash(asNumber(line.style), scaledWidth),
    width: scaledWidth
  };
}
function tableLineDash(style, width) {
  const unit = Math.max(1, width);
  if (style === 2) return [unit * 4, unit * 2];
  if (style === 3) return [unit, unit * 2];
  if (style === 4) return [unit * 8, unit * 3];
  if (style === 5) return [unit * 8, unit * 3, unit, unit * 3];
  if (style === 6) return [unit * 8, unit * 3, unit, unit * 3, unit, unit * 3];
  return [];
}
function drawBorderSegment(context, line, x1, y1, x2, y2) {
  context.save();
  context.strokeStyle = line.color;
  context.lineWidth = line.width;
  context.setLineDash(line.dash);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
}
function normalizeLengths(source, count, total) {
  if (count <= 0) return [];
  const values = source.slice(0, count).filter((value) => value > 0);
  const sum = values.reduce((acc, value) => acc + value, 0);
  if (values.length === count && sum > 0) {
    return values.map((value) => value / sum * total);
  }
  return Array.from({ length: count }, () => total / count);
}
function sumLengths(lengths, start, count) {
  let total = 0;
  for (let index = start; index < start + count; index++) {
    total += lengths[index] ?? 0;
  }
  return total;
}

// src/presentation/presentation-renderer.ts
function renderPresentationSlide({
  charts = [],
  context,
  height,
  images,
  layouts = [],
  slide,
  textOverflow = "visible",
  width
}) {
  const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
  const bounds = getSlideBounds(effectiveSlide);
  const elements = presentationElements(effectiveSlide).map((element, index) => ({ element, index })).sort(
    (left, right) => asNumber(left.element.zIndex, left.index) - asNumber(right.element.zIndex, right.index)
  );
  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, width, height);
  context.fillStyle = slideBackgroundToCss(effectiveSlide);
  context.fillRect(0, 0, width, height);
  for (const entry of elements) {
    drawElement(context, entry, bounds, { height, width }, images, {
      charts,
      textOverflow
    });
  }
  context.restore();
}
function drawElement(context, { element }, bounds, canvas, images, options) {
  const bbox = asRecord(element.bbox);
  const rect = emuRectToCanvasRect(bbox, bounds, canvas);
  if (rect.width <= 0 && rect.height <= 0) return;
  const slideScale = presentationCanvasScale(bounds, canvas);
  const shape = asRecord(element.shape);
  const line = presentationElementLineStyle(element, slideScale);
  const isLine = rect.height === 0 && line.color != null;
  const rotation = asNumber(bbox?.rotation) / 6e4;
  const horizontalFlip = bbox?.horizontalFlip === true;
  const verticalFlip = bbox?.verticalFlip === true;
  context.save();
  context.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (rotation !== 0) context.rotate(rotation * Math.PI / 180);
  if (horizontalFlip || verticalFlip)
    context.scale(horizontalFlip ? -1 : 1, verticalFlip ? -1 : 1);
  context.translate(-rect.width / 2, -rect.height / 2);
  applyElementShadow(context, element, slideScale);
  const shapeKind = presentationShapeKind(shape, rect);
  if (isLine || shapeKind === "line") {
    drawLine(context, rect.width, rect.height, line);
    context.restore();
    return;
  }
  const path = customGeometryPath(shape, rect) ?? elementPath(shapeKind, rect);
  const fill = shapeFillToPaint(context, shape, element, line.color, rect);
  if (fill) {
    context.fillStyle = fill;
    context.fill(path);
  }
  const imageId = elementImageReferenceId(element);
  const image = imageId ? images.get(imageId) : void 0;
  if (image) {
    context.save();
    context.clip(path);
    drawElementImage(context, image, element, rect);
    context.restore();
  }
  if (line.color) {
    applyLineStyle(context, line);
    context.stroke(path);
    context.setLineDash([]);
  }
  const table = asRecord(element.table);
  if (table) {
    drawPresentationTable(
      context,
      element,
      table,
      rect,
      bounds,
      canvas,
      slideScale
    );
    context.restore();
    return;
  }
  const chart = presentationChartById(
    options.charts,
    presentationChartReferenceId(element.chartReference)
  );
  if (chart) {
    drawPresentationChart(context, chart, rect, slideScale);
    context.restore();
    return;
  }
  drawPresentationTextBox({
    canvas,
    context,
    element,
    rect,
    slideBounds: bounds,
    slideScale,
    textOverflow: options.textOverflow
  });
  context.restore();
}
function drawLine(context, width, height, line) {
  if (!line.color) return;
  applyLineStyle(context, line);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(width, height);
  context.stroke();
  context.setLineDash([]);
  drawLineEnd(context, width, height, line.headEnd, line.color, false);
  drawLineEnd(context, width, height, line.tailEnd, line.color, true);
}
function drawElementImage(context, image, element, rect) {
  const naturalSize = imageNaturalSize(image);
  const sourceRect = elementImageSourceRect(element);
  if (!sourceRect || naturalSize.width <= 0 || naturalSize.height <= 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return;
  }
  const left = cropRatio(sourceRect.left ?? sourceRect.l);
  const top = cropRatio(sourceRect.top ?? sourceRect.t);
  const right = cropRatio(sourceRect.right ?? sourceRect.r);
  const bottom = cropRatio(sourceRect.bottom ?? sourceRect.b);
  const sourceWidth = naturalSize.width * Math.max(0.01, 1 - left - right);
  const sourceHeight = naturalSize.height * Math.max(0.01, 1 - top - bottom);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    context.drawImage(image, 0, 0, rect.width, rect.height);
    return;
  }
  context.drawImage(
    image,
    naturalSize.width * left,
    naturalSize.height * top,
    sourceWidth,
    sourceHeight,
    0,
    0,
    rect.width,
    rect.height
  );
}
function imageNaturalSize(image) {
  const record = image;
  return {
    height: asNumber(
      record.naturalHeight,
      asNumber(record.videoHeight, asNumber(record.height))
    ),
    width: asNumber(
      record.naturalWidth,
      asNumber(record.videoWidth, asNumber(record.width))
    )
  };
}
function elementImageSourceRect(element) {
  const shapeFill = asRecord(asRecord(element.shape)?.fill);
  const fill = asRecord(element.fill) ?? shapeFill;
  return asRecord(fill?.sourceRect) ?? asRecord(fill?.sourceRectangle) ?? asRecord(fill?.srcRect) ?? asRecord(fill?.stretchFillRect) ?? asRecord(element.imageMask);
}
function cropRatio(value) {
  const raw = asNumber(value);
  if (raw <= 0) return 0;
  if (raw > 1) return clamp4(raw / 1e5, 0, 0.99);
  return clamp4(raw, 0, 0.99);
}
function clamp4(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// src/presentation/presentation-preview.tsx
import { jsx as jsx16, jsxs as jsxs12 } from "react/jsx-runtime";
var MAX_THUMBNAIL_WIDTH = 192;
var MIN_THUMBNAIL_WIDTH = 96;
var SLIDE_BITMAP_WIDTH = 1920;
var STACK_BAR_COUNT = 12;
var PRESENTATION_HEADER_ACTIONS_ID = "office-wasm-presentation-header-actions";
function PresentationPreview({
  labels,
  proto
}) {
  const root = asRecord(proto);
  const slides = useMemo5(
    () => asArray(root?.slides).map(asRecord).filter((slide) => slide != null),
    [root]
  );
  const layouts = useMemo5(
    () => asArray(root?.layouts).map(asRecord).filter((layout) => layout != null),
    [root]
  );
  const charts = useMemo5(
    () => asArray(root?.charts).map(asRecord).filter((chart) => chart != null),
    [root]
  );
  const imageSources = useOfficeImageSources(root);
  const imageElements = useLoadedOfficeImages(imageSources);
  const slideBitmaps = useRenderedSlideBitmaps(slides, imageElements, layouts, charts);
  const railRef = useRef6(null);
  const railSize = useElementSize(railRef);
  const thumbnailWidth = Math.max(
    MIN_THUMBNAIL_WIDTH,
    Math.min(MAX_THUMBNAIL_WIDTH, (railSize.width || 252) - 56)
  );
  const [activeSlideIndex, setActiveSlideIndex] = useState2(0);
  const [isSlideshowOpen, setIsSlideshowOpen] = useState2(false);
  const [headerActions, setHeaderActions] = useState2(null);
  const [thumbnailRailOpen, setThumbnailRailOpen] = useState2(false);
  const selectedSlideIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const selectedSlide = slides[selectedSlideIndex] ?? {};
  const openSlideshow = useCallback(() => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.({ navigationUI: "hide" }).catch(() => void 0);
    }
    setIsSlideshowOpen(true);
  }, []);
  const closeSlideshow = useCallback(() => setIsSlideshowOpen(false), []);
  useEffect6(() => {
    void prewarmOfficeFonts(collectPresentationTypefaces(slides, layouts));
  }, [layouts, slides]);
  useEffect6(() => {
    const frame = window.requestAnimationFrame(() => {
      setHeaderActions(document.getElementById(PRESENTATION_HEADER_ACTIONS_ID));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect6(() => {
    function handleKeyDown(event) {
      if (isSlideshowOpen || isEditableKeyboardTarget(event.target)) return;
      if (!isSlideNavigationKey(event.key)) return;
      event.preventDefault();
      setActiveSlideIndex((currentIndex) => nextSlideIndexFromKey(event.key, currentIndex, slides.length));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSlideshowOpen, slides.length]);
  useEffect6(() => {
    scrollThumbnailIntoView(railRef, selectedSlideIndex);
  }, [selectedSlideIndex]);
  if (slides.length === 0) {
    return /* @__PURE__ */ jsx16("p", { style: { color: "#64748b" }, children: labels.noSlides });
  }
  return /* @__PURE__ */ jsxs12("div", { className: void 0, "data-testid": "presentation-preview", children: [
    /* @__PURE__ */ jsxs12("aside", { className: void 0, "data-open": thumbnailRailOpen, ref: railRef, children: [
      /* @__PURE__ */ jsx16(
        "button",
        {
          "aria-label": labels.slide,
          className: void 0,
          onClick: () => setThumbnailRailOpen((isOpen) => !isOpen),
          type: "button",
          children: Array.from({ length: Math.min(STACK_BAR_COUNT, slides.length) }).map((_, index) => /* @__PURE__ */ jsx16("span", { className: void 0 }, index))
        }
      ),
      /* @__PURE__ */ jsx16("div", { className: void 0, children: slides.map((slide, index) => /* @__PURE__ */ jsxs12(
        "button",
        {
          "aria-label": `${labels.slide} ${asNumber(slide.index, index + 1)}`,
          "aria-current": index === selectedSlideIndex ? "true" : void 0,
          className: void 0,
          "data-active": index === selectedSlideIndex,
          "data-slide-index": index + 1,
          "data-testid": "presentation-thumbnail",
          onClick: () => {
            setActiveSlideIndex(index);
            setThumbnailRailOpen(false);
          },
          onKeyDown: (event) => {
            if (!isSlideNavigationKey(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const nextIndex = nextSlideIndexFromKey(event.key, index, slides.length);
            setActiveSlideIndex(nextIndex);
            focusThumbnail(railRef, nextIndex);
          },
          type: "button",
          children: [
            /* @__PURE__ */ jsx16("span", { className: void 0, children: asNumber(slide.index, index + 1) }),
            /* @__PURE__ */ jsx16(
              SlideRasterFrame,
              {
                alt: "",
                bitmap: slideBitmaps.get(slideRenderKey(slide, index)),
                className: void 0,
                fallbackImages: imageElements,
                fallbackTextOverflow: "clip",
                charts,
                layouts,
                slide,
                width: thumbnailWidth
              }
            )
          ]
        },
        `${asString(slide.id)}-${index}`
      )) })
    ] }),
    /* @__PURE__ */ jsx16(
      SlideStage,
      {
        charts,
        images: imageElements,
        labels,
        layouts,
        slide: selectedSlide,
        slideIndex: selectedSlideIndex
      },
      slideRenderKey(selectedSlide, selectedSlideIndex)
    ),
    headerActions ? createPortal(
      /* @__PURE__ */ jsxs12("button", { "aria-label": labels.playSlideshow, className: void 0, onClick: openSlideshow, type: "button", children: [
        /* @__PURE__ */ jsx16(Play, { "aria-hidden": "true", size: 15, strokeWidth: 2 }),
        /* @__PURE__ */ jsx16("span", { children: labels.playSlideshow })
      ] }),
      headerActions
    ) : null,
    isSlideshowOpen ? /* @__PURE__ */ jsx16(
      SlideshowOverlay,
      {
        activeSlideIndex: selectedSlideIndex,
        charts,
        images: imageElements,
        labels,
        layouts,
        onClose: closeSlideshow,
        setActiveSlideIndex,
        slides
      }
    ) : null
  ] });
}
function SlideStage({
  charts,
  images,
  labels,
  layouts,
  slide,
  slideIndex
}) {
  const viewportRef = useRef6(null);
  const [selection, setSelection] = useState2(null);
  const viewportSize = useElementSize(viewportRef);
  const footnote2 = useMemo5(() => slideFootnoteText(slide), [slide]);
  const frame = getSlideFrameSize(slide, layouts);
  const fit = computePresentationFit(
    {
      height: viewportSize.height,
      width: viewportSize.width
    },
    frame,
    { padding: 24 }
  );
  const canvasWidth = Math.max(1, fit.width);
  const canvasHeight = Math.max(1, fit.height);
  const slideKey = `${asString(slide.id)}-${slideIndex}`;
  const elementTargets = useMemo5(
    () => getPresentationElementTargets(slide, { height: canvasHeight, width: canvasWidth }, layouts),
    [canvasHeight, canvasWidth, layouts, slide]
  );
  const selectedTarget = selection?.slideKey === slideKey ? elementTargets.find((target) => target.id === selection.elementId) ?? null : null;
  const footnoteTop = Math.max(0, (viewportSize.height - canvasHeight) / 2 + canvasHeight + 14);
  return /* @__PURE__ */ jsx16("main", { className: void 0, children: /* @__PURE__ */ jsx16("div", { className: void 0, children: /* @__PURE__ */ jsxs12("div", { className: void 0, ref: viewportRef, children: [
    /* @__PURE__ */ jsxs12(
      "div",
      {
        className: void 0,
        style: { height: canvasHeight, width: canvasWidth },
        children: [
          /* @__PURE__ */ jsx16(
            SlideCanvasFrame,
            {
              className: void 0,
              charts,
              images,
              layouts,
              slide,
              testId: "presentation-slide-canvas",
              textOverflow: "visible",
              width: canvasWidth
            }
          ),
          /* @__PURE__ */ jsx16(
            "button",
            {
              "aria-label": selectedTarget?.name ?? labels.slide,
              className: void 0,
              onClick: (event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const point = {
                  x: event.clientX - rect.left,
                  y: event.clientY - rect.top
                };
                const target = hitTestElementTarget(elementTargets, point);
                setSelection(target ? { elementId: target.id, slideKey } : null);
              },
              type: "button",
              children: selectedTarget ? /* @__PURE__ */ jsxs12(
                "span",
                {
                  "aria-hidden": "true",
                  className: void 0,
                  style: {
                    height: selectedTarget.rect.height,
                    transform: `translate(${selectedTarget.rect.left}px, ${selectedTarget.rect.top}px)`,
                    width: selectedTarget.rect.width
                  },
                  children: [
                    /* @__PURE__ */ jsx16("span", { className: void 0, "data-position": "top-left" }),
                    /* @__PURE__ */ jsx16("span", { className: void 0, "data-position": "top-right" }),
                    /* @__PURE__ */ jsx16("span", { className: void 0, "data-position": "bottom-left" }),
                    /* @__PURE__ */ jsx16("span", { className: void 0, "data-position": "bottom-right" })
                  ]
                }
              ) : null
            }
          )
        ]
      }
    ),
    footnote2 ? /* @__PURE__ */ jsx16(
      "pre",
      {
        className: void 0,
        "data-testid": "presentation-footnote",
        style: { top: footnoteTop, width: canvasWidth },
        children: footnote2
      }
    ) : null
  ] }) }) });
}
function isSlideNavigationKey(key) {
  return key === "ArrowDown" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowLeft" || key === "PageDown" || key === "PageUp" || key === "Home" || key === "End";
}
function nextSlideIndexFromKey(key, currentIndex, slideCount) {
  if (slideCount <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return slideCount - 1;
  if (key === "ArrowDown" || key === "ArrowRight" || key === "PageDown") return Math.min(slideCount - 1, currentIndex + 1);
  if (key === "ArrowUp" || key === "ArrowLeft" || key === "PageUp") return Math.max(0, currentIndex - 1);
  return currentIndex;
}
function isEditableKeyboardTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return element.closest("input, textarea, select, [contenteditable='true']") != null;
}
function focusThumbnail(railRef, index) {
  window.requestAnimationFrame(() => {
    const button = thumbnailButtonAt(railRef, index);
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  });
}
function scrollThumbnailIntoView(railRef, index) {
  window.requestAnimationFrame(() => {
    thumbnailButtonAt(railRef, index)?.scrollIntoView({ block: "nearest" });
  });
}
function thumbnailButtonAt(railRef, index) {
  return railRef.current?.querySelector(
    `[data-testid="presentation-thumbnail"][data-slide-index="${index + 1}"]`
  ) ?? null;
}
function SlideshowOverlay({
  activeSlideIndex,
  charts,
  images,
  labels,
  layouts,
  onClose,
  setActiveSlideIndex,
  slides
}) {
  const frameRef = useRef6(null);
  const frameSize = useElementSize(frameRef);
  const didEnterFullscreenRef = useRef6(typeof document !== "undefined" && document.fullscreenElement != null);
  const selectedIndex = Math.min(activeSlideIndex, Math.max(0, slides.length - 1));
  const slide = slides[selectedIndex] ?? {};
  const frame = getSlideFrameSize(slide, layouts);
  const fit = computePresentationFit(frameSize, frame, { padding: 0 });
  const canvasWidth = Math.max(1, fit.width);
  const [showSpeakerNotes, setShowSpeakerNotes] = useState2(false);
  const speakerNotes = useMemo5(() => presentationSlideNotesText(slide), [slide]);
  const hasSpeakerNotes = speakerNotes.length > 0;
  const speakerNotesLabel = labels.speakerNotes ?? labels.slide;
  const showSpeakerNotesLabel = labels.showSpeakerNotes ?? speakerNotesLabel;
  const hideSpeakerNotesLabel = labels.hideSpeakerNotes ?? speakerNotesLabel;
  useEffect6(() => {
    if (!hasSpeakerNotes) {
      setShowSpeakerNotes(false);
    }
  }, [hasSpeakerNotes]);
  const goPrevious = useCallback(() => {
    setActiveSlideIndex(Math.max(0, selectedIndex - 1));
  }, [selectedIndex, setActiveSlideIndex]);
  const goNext = useCallback(() => {
    setActiveSlideIndex(Math.min(slides.length - 1, selectedIndex + 1));
  }, [selectedIndex, setActiveSlideIndex, slides.length]);
  const closeSlideshow = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => void 0);
    }
    onClose();
  }, [onClose]);
  useEffect6(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  useEffect6(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement) {
        didEnterFullscreenRef.current = true;
        return;
      }
      if (didEnterFullscreenRef.current) {
        onClose();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [onClose]);
  useEffect6(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlideshow();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goPrevious();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key.toLowerCase() === "n" && hasSpeakerNotes) {
        event.preventDefault();
        setShowSpeakerNotes((isOpen) => !isOpen);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSlideshow, goNext, goPrevious, hasSpeakerNotes]);
  return /* @__PURE__ */ jsxs12(
    "div",
    {
      "aria-label": labels.playSlideshow,
      "aria-modal": "true",
      className: void 0,
      "data-testid": "presentation-slideshow",
      role: "dialog",
      children: [
        /* @__PURE__ */ jsxs12("div", { className: void 0, children: [
          /* @__PURE__ */ jsx16(
            "button",
            {
              "aria-label": labels.previousSlide,
              className: void 0,
              "data-testid": "presentation-slideshow-previous",
              disabled: selectedIndex === 0,
              onClick: goPrevious,
              type: "button",
              children: /* @__PURE__ */ jsx16(ChevronLeft, { "aria-hidden": "true", size: 18, strokeWidth: 2 })
            }
          ),
          /* @__PURE__ */ jsxs12("div", { className: void 0, children: [
            labels.slide,
            " ",
            asNumber(slide.index, selectedIndex + 1),
            " / ",
            slides.length
          ] }),
          /* @__PURE__ */ jsx16(
            "button",
            {
              "aria-label": labels.nextSlide,
              className: void 0,
              "data-testid": "presentation-slideshow-next",
              disabled: selectedIndex >= slides.length - 1,
              onClick: goNext,
              type: "button",
              children: /* @__PURE__ */ jsx16(ChevronRight, { "aria-hidden": "true", size: 18, strokeWidth: 2 })
            }
          ),
          hasSpeakerNotes ? /* @__PURE__ */ jsx16(
            "button",
            {
              "aria-label": showSpeakerNotes ? hideSpeakerNotesLabel : showSpeakerNotesLabel,
              "aria-pressed": showSpeakerNotes,
              className: void 0,
              "data-testid": "presentation-speaker-notes-toggle",
              onClick: () => setShowSpeakerNotes((isOpen) => !isOpen),
              type: "button",
              children: /* @__PURE__ */ jsx16(StickyNote, { "aria-hidden": "true", size: 17, strokeWidth: 2 })
            }
          ) : null,
          /* @__PURE__ */ jsx16("button", { "aria-label": labels.closeSlideshow, className: void 0, onClick: closeSlideshow, type: "button", children: /* @__PURE__ */ jsx16(X, { "aria-hidden": "true", size: 18, strokeWidth: 2 }) })
        ] }),
        /* @__PURE__ */ jsxs12("div", { className: void 0, "data-notes-open": showSpeakerNotes && hasSpeakerNotes, children: [
          /* @__PURE__ */ jsx16(
            "button",
            {
              "aria-label": labels.nextSlide,
              className: void 0,
              onClick: goNext,
              ref: frameRef,
              type: "button",
              children: /* @__PURE__ */ jsx16(
                SlideCanvasFrame,
                {
                  className: void 0,
                  charts,
                  images,
                  layouts,
                  slide,
                  textOverflow: "visible",
                  width: canvasWidth
                }
              )
            }
          ),
          showSpeakerNotes && hasSpeakerNotes ? /* @__PURE__ */ jsxs12("aside", { className: void 0, "data-testid": "presentation-speaker-notes", children: [
            /* @__PURE__ */ jsx16("div", { className: void 0, children: speakerNotesLabel }),
            /* @__PURE__ */ jsx16("pre", { className: void 0, children: speakerNotes })
          ] }) : null
        ] })
      ]
    }
  );
}
function SlideRasterFrame({
  alt,
  bitmap,
  charts,
  className,
  fallbackImages,
  fallbackTextOverflow,
  layouts,
  slide,
  width
}) {
  const frame = getSlideFrameSize(slide, layouts);
  const height = Math.max(1, width / frame.width * frame.height);
  if (bitmap) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Runtime object URLs are generated from the canvas preview surface.
      /* @__PURE__ */ jsx16(
        "img",
        {
          alt,
          className,
          draggable: false,
          height: Math.round(height),
          src: bitmap.url,
          style: { height, width },
          width: Math.round(width)
        }
      )
    );
  }
  return /* @__PURE__ */ jsx16(
    SlideCanvasFrame,
    {
      className,
      charts,
      images: fallbackImages,
      layouts,
      slide,
      textOverflow: fallbackTextOverflow,
      width
    }
  );
}
function SlideCanvasFrame({
  charts,
  className,
  images,
  layouts,
  slide,
  testId,
  textOverflow,
  width
}) {
  const canvasRef = useRef6(null);
  const frame = getSlideFrameSize(slide, layouts);
  const height = Math.max(1, width / frame.width * frame.height);
  useEffect6(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    renderPresentationSlide({ charts, context, height, images, layouts, slide, textOverflow, width });
  }, [charts, height, images, layouts, slide, textOverflow, width]);
  return /* @__PURE__ */ jsx16(
    "canvas",
    {
      "aria-hidden": "true",
      className,
      "data-testid": testId,
      height: Math.round(height),
      ref: canvasRef,
      width: Math.round(width)
    }
  );
}
function useRenderedSlideBitmaps(slides, images, layouts, charts) {
  const [bitmaps, setBitmaps] = useState2(/* @__PURE__ */ new Map());
  useEffect6(() => {
    let cancelled = false;
    const objectUrls = [];
    window.requestAnimationFrame(() => {
      if (!cancelled) {
        setBitmaps(/* @__PURE__ */ new Map());
      }
    });
    async function renderBitmaps() {
      if (slides.length === 0) return;
      await waitForDocumentFonts();
      const next = /* @__PURE__ */ new Map();
      for (const [index, slide] of slides.entries()) {
        if (cancelled) return;
        const frame = getSlideFrameSize(slide, layouts);
        const width = SLIDE_BITMAP_WIDTH;
        const height = Math.max(1, width / frame.width * frame.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        const context = canvas.getContext("2d");
        if (!context) continue;
        renderPresentationSlide({
          charts,
          context,
          height,
          images,
          layouts,
          slide,
          textOverflow: "visible",
          width
        });
        const blob = await canvasToBlob(canvas);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        next.set(slideRenderKey(slide, index), { height, url, width });
        if (!cancelled) {
          setBitmaps(new Map(next));
        }
      }
    }
    void renderBitmaps();
    return () => {
      cancelled = true;
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [charts, images, layouts, slides]);
  return bitmaps;
}
async function waitForDocumentFonts() {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await document.fonts.ready.catch(() => void 0);
}
function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}
function useLoadedOfficeImages(imageSources) {
  const [images, setImages] = useState2(/* @__PURE__ */ new Map());
  useEffect6(() => {
    let cancelled = false;
    const next = /* @__PURE__ */ new Map();
    if (imageSources.size === 0) {
      window.requestAnimationFrame(() => {
        if (!cancelled) setImages(next);
      });
      return;
    }
    for (const [id, src] of imageSources) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        next.set(id, image);
        if (!cancelled) setImages(new Map(next));
      };
      image.onerror = () => {
        if (!cancelled) setImages(new Map(next));
      };
      image.src = src;
      if (image.complete && image.naturalWidth > 0) {
        next.set(id, image);
      }
    }
    window.requestAnimationFrame(() => {
      if (!cancelled) setImages(new Map(next));
    });
    return () => {
      cancelled = true;
    };
  }, [imageSources]);
  return images;
}
function slideRenderKey(slide, index) {
  return `${asString(slide.id) || "slide"}-${index}`;
}
function useElementSize(ref) {
  const [size, setSize] = useState2({ height: 0, width: 0 });
  useEffect6(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ height: rect.height, width: rect.width });
    };
    update();
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(update);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}
function hitTestElementTarget(targets, point) {
  for (let index = targets.length - 1; index >= 0; index--) {
    const target = targets[index];
    if (!target) {
      continue;
    }
    if (point.x >= target.rect.left && point.x <= target.rect.left + target.rect.width && point.y >= target.rect.top && point.y <= target.rect.top + target.rect.height) {
      return target;
    }
  }
  return null;
}
function slideFootnoteText(slide) {
  return presentationSlideNotesText(slide);
}
export {
  PRESENTATION_HEADER_ACTIONS_ID,
  PresentationPreview,
  SpreadsheetPreview,
  WordPreview
};
