import { describe, expect, it } from "vitest";

import { drawPresentationChart } from "../../shared/office-chart-renderer";
import { EMPTY_OFFICE_TEXT_STYLE_MAPS, officeFontFamily, paragraphView } from "../../shared/office-preview-utils";
import {
  applyPresentationLayoutInheritance,
  computePresentationFit,
  emuRectToCanvasRect,
  getSlideBounds,
  presentationGradientStops,
  presentationChartById,
  presentationChartReferenceId,
  presentationElementLineStyle,
  presentationImageSourceRect,
  presentationLineEndStyle,
  presentationLineStyle,
  presentationScaledFontSize,
  presentationShadowStyle,
  presentationShapeKind,
  presentationTableGrid,
} from "../presentation-renderer";
import {
  presentationEffectiveTextMaxWidth,
  presentationParagraphSpacingPx,
  presentationTextShouldShrinkForAutoFit,
} from "../presentation-text-layout";

describe("presentation renderer helpers", () => {
  it("quotes source typefaces and appends Office/CJK fallbacks", () => {
    expect(officeFontFamily("PingFang SC")).toContain('"PingFang SC"');
    expect(officeFontFamily('Aptos "Display"')).toContain('"Aptos \\"Display\\""');
    expect(officeFontFamily("")).toContain("Carlito");
    expect(officeFontFamily("")).toContain('"Microsoft YaHei"');
    expect(officeFontFamily("Noto Serif CJK SC")).toContain('"Songti SC"');
    expect(officeFontFamily("Arial;Helvetica;sans-serif")).toContain('"Arial", "Helvetica", sans-serif');
    expect(officeFontFamily("Arial;Helvetica;sans-serif")).not.toContain('"Songti SC"');
  });

  it("fits a slide into the viewport with Codex-like padding and zoom clamping", () => {
    const fit = computePresentationFit({ height: 720, width: 1280 }, { height: 720, width: 1280 });
    expect(fit.width).toBeCloseTo(1109.33, 1);
    expect(fit.height).toBeCloseTo(624, 1);

    const fullscreen = computePresentationFit(
      { height: 720, width: 1280 },
      { height: 720, width: 1280 },
      { padding: 0 },
    );
    expect(fullscreen.width).toBeCloseTo(1280, 1);
    expect(fullscreen.height).toBeCloseTo(720, 1);

    const zoomed = computePresentationFit(
      { height: 720, width: 1280 },
      { height: 720, width: 1280 },
      { zoom: 99 },
    );
    expect(zoomed.scale).toBeCloseTo(fit.scale * 6);

    const zoomedOut = computePresentationFit(
      { height: 720, width: 1280 },
      { height: 720, width: 1280 },
      { zoom: 0.01 },
    );
    expect(zoomedOut.scale).toBeCloseTo(fit.scale * 0.25);
  });

  it("maps EMU bounding boxes into canvas coordinates", () => {
    const rect = emuRectToCanvasRect(
      { heightEmu: 1_714_500, widthEmu: 3_048_000, xEmu: 1_524_000, yEmu: 857_250 },
      { height: 6_858_000, width: 12_192_000 },
      { height: 720, width: 1280 },
    );

    expect(rect).toEqual({
      height: 180,
      left: 160,
      top: 90,
      width: 320,
    });
  });

  it("scales presentation font sizes with the fitted slide", () => {
    const fullSize = presentationScaledFontSize(3600, 1);
    expect(fullSize).toBeCloseTo(48, 1);
    expect(presentationScaledFontSize(3600, 0.25)).toBeCloseTo(fullSize * 0.25, 1);
    expect(presentationScaledFontSize(3600, 2)).toBeCloseTo(fullSize * 2, 1);
  });

  it("maps protocol geometry codes to canvas shape kinds", () => {
    const rect = { height: 100, left: 0, top: 0, width: 100 };
    expect(presentationShapeKind({ geometry: 35 }, rect)).toBe("ellipse");
    expect(presentationShapeKind({ geometry: 96 }, rect)).toBe("line");
    expect(presentationShapeKind({ geometry: 99 }, rect)).toBe("line");
    expect(presentationShapeKind({ geometry: 100 }, rect)).toBe("line");
    expect(presentationShapeKind({ geometry: 3 }, rect)).toBe("triangle");
    expect(presentationShapeKind({ geometry: 23 }, rect)).toBe("triangle");
    expect(presentationShapeKind({ geometry: 6 }, rect)).toBe("diamond");
    expect(presentationShapeKind({ geometry: 30 }, rect)).toBe("diamond");
    expect(presentationShapeKind({ geometry: 11 }, rect)).toBe("hexagon");
    expect(presentationShapeKind({ geometry: 39 }, rect)).toBe("hexagon");
    expect(presentationShapeKind({ geometry: 18 }, rect)).toBe("star6");
    expect(presentationShapeKind({ geometry: 20 }, rect)).toBe("star8");
    expect(presentationShapeKind({ geometry: 25 }, rect)).toBe("star32");
    expect(presentationShapeKind({ geometry: 32 }, rect)).toBe("snipRect");
    expect(presentationShapeKind({ geometry: 44 }, rect)).toBe("rightArrow");
    expect(presentationShapeKind({ geometry: 45 }, rect)).toBe("leftArrow");
    expect(presentationShapeKind({ geometry: 50 }, rect)).toBe("bentUpArrow");
    expect(presentationShapeKind({ geometry: 52 }, rect)).toBe("upDownArrow");
    expect(presentationShapeKind({ geometry: 63 }, rect)).toBe("bentArrow");
    expect(presentationShapeKind({ geometry: 75 }, rect)).toBe("lightningBolt");
    expect(presentationShapeKind({ geometry: 87 }, rect)).toBe("diagStripe");
    expect(presentationShapeKind({ geometry: 95 }, rect)).toBe("bracePair");
    expect(presentationShapeKind({ geometry: 137 }, rect)).toBe("document");
    expect(presentationShapeKind({ geometry: 150 }, rect)).toBe("extract");
  });

  it("maps PPT source rectangles to image crop coordinates", () => {
    const crop = presentationImageSourceRect(
      {
        fill: {
          sourceRect: {
            bottom: 20_000,
            left: 10_000,
            right: 30_000,
            top: 5_000,
          },
        },
      },
      { height: 500, width: 1000 },
    );

    expect(crop.height).toBeCloseTo(375);
    expect(crop.width).toBeCloseTo(600);
    expect(crop.x).toBeCloseTo(100);
    expect(crop.y).toBeCloseTo(25);
  });

  it("resolves PPT chart references by relationship or chart uri", () => {
    const charts = [
      { id: "/ppt/charts/chart1.xml", title: "One" },
      { uri: "/ppt/charts/chart2.xml", title: "Two" },
    ];

    expect(presentationChartReferenceId({ id: "/ppt/charts/chart1.xml" })).toBe("/ppt/charts/chart1.xml");
    expect(presentationChartReferenceId({ relationshipId: "rId9" })).toBe("rId9");
    expect(presentationChartById(charts, "/ppt/charts/chart2.xml")?.title).toBe("Two");
    expect(presentationChartById(charts, "missing")).toBeNull();
  });

  it("renders protocol trendline and error bar hints in shared Office charts", () => {
    const context = mockCanvasContext();

    drawPresentationChart(
      context,
      {
        series: [
          {
            errorBars: { amount: 2, color: { value: "334155" }, direction: "both" },
            fill: { color: { value: "156082" } },
            name: "Forecast",
            trendlines: [{ color: { value: "FF0000" }, type: "linear" }],
            values: [2, 5, 8],
          },
        ],
        type: 13,
      },
      { height: 180, left: 0, top: 0, width: 320 },
      1,
    );

    expect(context.strokeStyles).toContain("#334155");
    expect(context.strokeStyles).toContain("#FF0000");
    expect(context.lineDashes).toContainEqual([6, 4]);
  });

  it("normalizes PPT table rows, columns, and spans into fitted cells", () => {
    const grid = presentationTableGrid(
      {
        columns: [2_000, 1_000, 1_000],
        rows: [
          { cells: [{ gridSpan: 2 }, {}], height: 2_000 },
          { cells: [{}, {}, {}], height: 1_000 },
        ],
      },
      { height: 150, left: 0, top: 0, width: 300 },
    );

    expect(grid.columns).toEqual([150, 75, 75]);
    expect(grid.rows).toEqual([100, 50]);
  });

  it("maps PPT line styles without clamping Office line widths", () => {
    const line = presentationLineStyle(
      {
        cap: 3,
        fill: { color: { type: 1, value: "8FA69D" } },
        headEnd: { length: 3, type: 2, width: 2 },
        join: 1,
        style: 2,
        tailEnd: { length: 2, type: 5, width: 2 },
        widthEmu: 19_050,
      },
      2,
    );

    expect(line.color).toBe("#8FA69D");
    expect(line.width).toBeCloseTo(4);
    expect(line.lineCap).toBe("round");
    expect(line.lineJoin).toBe("round");
    expect(line.dash.length).toBeGreaterThan(0);
    expect(line.headEnd?.type).toBe(2);
    expect(line.tailEnd?.type).toBe(5);
  });

  it("renders connector line-end metadata with the base shape line", () => {
    const line = presentationElementLineStyle(
      {
        connector: {
          lineStyle: {
            cap: 2,
            head: { length: 3, type: 2, width: 3 },
            join: 2,
            tail: { length: 1, type: 5, width: 1 },
          },
        },
        shape: {
          line: {
            fill: { color: { type: 1, value: "C65F20" } },
            style: 1,
            widthEmu: 38_100,
          },
        },
      },
      1,
    );

    expect(line.color).toBe("#C65F20");
    expect(line.width).toBeCloseTo(4);
    expect(line.lineCap).toBe("square");
    expect(line.lineJoin).toBe("bevel");
    expect(line.headEnd?.type).toBe(2);
    expect(line.tailEnd?.type).toBe(5);
  });

  it("maps PPT line end records into canvas arrowhead dimensions", () => {
    expect(presentationLineEndStyle(undefined, 2)).toBeNull();
    expect(presentationLineEndStyle({ type: 0 }, 2)).toBeNull();
    expect(presentationLineEndStyle({ length: 3, type: 2, width: 2 }, 2)).toEqual({
      length: 10,
      type: 2,
      width: 7,
    });
  });

  it("normalizes PPT gradient stops and percent positions", () => {
    expect(
      presentationGradientStops({
        gradientStops: [
          { color: { type: 1, value: "FF0000" }, position: 0 },
          { color: { transform: { alpha: 50_000 }, type: 1, value: "00FF00" }, position: 50_000 },
          { color: { lastColor: "0000FF", transform: { alpha: 25_000 }, type: 2, value: "accent2" }, position: 100_000 },
        ],
      }),
    ).toEqual([
      { color: "#FF0000", position: 0 },
      { color: "rgba(0, 255, 0, 0.5)", position: 0.5 },
      { color: "rgba(0, 0, 255, 0.25)", position: 1 },
    ]);

    expect(
      presentationGradientStops({
        gradientStops: [
          { color: { type: 1, value: "111111" } },
          { color: { type: 1, value: "222222" } },
          { color: { type: 1, value: "333333" } },
        ],
      }),
    ).toEqual([
      { color: "#111111", position: 0 },
      { color: "#222222", position: 0.5 },
      { color: "#333333", position: 1 },
    ]);
  });

  it("preserves top-level PPT paragraph spacing, bullet, and indent fields", () => {
    const paragraph = paragraphView(
      {
        bulletCharacter: "*",
        indent: -90_000,
        marginLeft: 180_000,
        runs: [{ text: "Nested point", textStyle: { fontSize: 1400 } }],
        spaceAfter: 120,
        textStyle: { alignment: 1 },
      },
      EMPTY_OFFICE_TEXT_STYLE_MAPS,
    );

    expect(paragraph.style?.bulletCharacter).toBe("*");
    expect(paragraph.style?.marginLeft).toBe(180_000);
    expect(paragraph.style?.indent).toBe(-90_000);
    expect(paragraph.style?.spaceAfter).toBe(120);
    expect(paragraph.runs[0]?.style?.marginLeft).toBe(180_000);
  });

  it("uses PPT text frame paragraph spacing and full text frame width", () => {
    expect(presentationParagraphSpacingPx(undefined, 2, false)).toBe(0);
    expect(presentationParagraphSpacingPx(undefined, 2, true)).toBe(0);
    expect(presentationParagraphSpacingPx(120, 2, true)).toBe(12);
    expect(presentationEffectiveTextMaxWidth(500, false)).toBe(500);
    expect(presentationEffectiveTextMaxWidth(500, true)).toBe(500);
  });

  it("only shrinks text for normal autofit, not shape autofit", () => {
    expect(presentationTextShouldShrinkForAutoFit({ normalAutoFit: {} })).toBe(true);
    expect(presentationTextShouldShrinkForAutoFit({ normAutofit: {} })).toBe(true);
    expect(presentationTextShouldShrinkForAutoFit({ shapeAutoFit: {} })).toBe(false);
    expect(presentationTextShouldShrinkForAutoFit({ spAutoFit: {} })).toBe(false);
    expect(presentationTextShouldShrinkForAutoFit({ noAutoFit: {} })).toBe(false);
  });

  it("inherits PPT placeholder geometry and text styles from layouts and masters", () => {
    const slide = {
      elements: [
        {
          id: "body-1",
          paragraphs: [
            {
              runs: [{ text: "Inherited body" }],
            },
          ],
          placeholderIndex: 1,
          placeholderType: "body",
        },
        {
          id: "title-1",
          paragraphs: [
            {
              textStyle: { fontSize: 1800 },
              runs: [
                {
                  text: "Direct title",
                  textStyle: { fill: { color: { type: 1, value: "AA0000" } } },
                },
              ],
            },
          ],
          placeholderType: "title",
        },
      ],
      useLayoutId: "layout-1",
    };
    const layouts = [
      {
        bodyLevelStyles: [
          {
            level: 1,
            paragraphStyle: {
              bulletCharacter: "•",
              marginLeft: 342_900,
            },
            spaceAfter: 120,
            textStyle: {
              fill: { color: { type: 1, value: "111111" } },
              fontSize: 2400,
              typeface: "Aptos",
            },
          },
        ],
        id: "master-1",
        titleLevelStyles: [
          {
            level: 1,
            textStyle: {
              fill: { color: { type: 1, value: "FFFFFF" } },
              fontSize: 3200,
            },
          },
        ],
        type: "master",
      },
      {
        elements: [
          {
            bbox: {
              heightEmu: 1_000,
              widthEmu: 2_000,
              xEmu: 100,
              yEmu: 200,
            },
            placeholderIndex: 1,
            placeholderType: "body",
            levelStyles: [
              {
                level: 1,
                paragraphStyle: {
                  indent: -228_600,
                },
                textStyle: {
                  fontSize: 2800,
                },
              },
            ],
            textStyle: { anchor: 2 },
          },
        ],
        id: "layout-1",
        parentLayoutId: "master-1",
        type: "layout",
      },
    ];

    const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
    const effectiveElements = effectiveSlide.elements as Array<Record<string, unknown>>;
    const body = effectiveElements[0];
    const bodyParagraph = (body.paragraphs as Array<Record<string, unknown>>)[0];
    const bodyTextStyle = bodyParagraph.textStyle as Record<string, unknown>;
    const bodyParagraphStyle = bodyParagraph.paragraphStyle as Record<string, unknown>;
    const title = effectiveElements[1];
    const titleParagraph = (title.paragraphs as Array<Record<string, unknown>>)[0];
    const titleTextStyle = titleParagraph.textStyle as Record<string, unknown>;

    expect(body.bbox).toEqual({
      heightEmu: 1_000,
      widthEmu: 2_000,
      xEmu: 100,
      yEmu: 200,
    });
    expect(body.textStyle).toEqual({ anchor: 2 });
    expect(bodyTextStyle.fontSize).toBe(2800);
    expect(bodyTextStyle.typeface).toBe("Aptos");
    expect(bodyParagraph.spaceAfter).toBe(120);
    expect(bodyParagraphStyle.bulletCharacter).toBe("•");
    expect(bodyParagraphStyle.indent).toBe(-228_600);
    expect(bodyParagraphStyle.marginLeft).toBe(342_900);
    expect(titleTextStyle.fontSize).toBe(1800);
    expect(titleTextStyle.fill).toEqual({ color: { type: 1, value: "FFFFFF" } });
  });

  it("does not let generated decoder undefined optionals erase placeholder styles", () => {
    const slide = {
      elements: [
        {
          id: "title-1",
          paragraphs: [
            {
              indent: undefined,
              marginLeft: undefined,
              paragraphStyle: {
                bulletCharacter: undefined,
                indent: undefined,
                marginLeft: undefined,
              },
              runs: [
                {
                  text: "Inherited title",
                  textStyle: {
                    fill: undefined,
                    fontSize: 4800,
                    typeface: undefined,
                  },
                },
              ],
              spaceAfter: undefined,
              spaceBefore: undefined,
              textStyle: {
                alignment: 1,
                fill: undefined,
                fontSize: undefined,
                typeface: undefined,
              },
            },
          ],
          placeholderType: "ctrTitle",
        },
      ],
      useLayoutId: "layout-title",
    };
    const layouts = [
      {
        elements: [
          {
            placeholderType: "ctrTitle",
            levelsStyles: [
              {
                level: 1,
                paragraphStyle: {
                  bulletCharacter: "",
                  marginLeft: 12_700,
                },
                spaceAfter: 0,
                spaceBefore: 0,
                textStyle: {
                  fill: { color: { type: 1, value: "FFFFFF" } },
                  fontSize: 3200,
                  typeface: "Bitter",
                },
              },
            ],
          },
        ],
        id: "layout-title",
      },
    ];

    const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
    const title = (effectiveSlide.elements as Array<Record<string, unknown>>)[0];
    const paragraph = (title.paragraphs as Array<Record<string, unknown>>)[0];
    const paragraphTextStyle = paragraph.textStyle as Record<string, unknown>;
    const paragraphStyle = paragraph.paragraphStyle as Record<string, unknown>;

    expect(paragraph.spaceAfter).toBe(0);
    expect(paragraph.spaceBefore).toBe(0);
    expect(paragraphStyle.bulletCharacter).toBe("");
    expect(paragraphStyle.marginLeft).toBe(12_700);
    expect(paragraphTextStyle.alignment).toBe(1);
    expect(paragraphTextStyle.fill).toEqual({ color: { type: 1, value: "FFFFFF" } });
    expect(paragraphTextStyle.fontSize).toBe(3200);
    expect(paragraphTextStyle.typeface).toBe("Bitter");
  });

  it("inherits title master styles for center title placeholders", () => {
    const slide = {
      elements: [
        {
          id: "title-1",
          paragraphs: [
            {
              runs: [{ text: "Center title", textStyle: { fontSize: 4800 } }],
            },
          ],
          placeholderType: "ctrTitle",
        },
      ],
      useLayoutId: "layout-title",
    };
    const layouts = [
      {
        elements: [
          {
            placeholderType: "title",
            levelsStyles: [
              {
                level: 1,
                textStyle: {
                  bold: true,
                  fill: { color: { type: 2, value: "dk1" } },
                  fontSize: 2800,
                  typeface: "Bitter",
                },
              },
            ],
          },
        ],
        id: "master-title",
      },
      {
        elements: [
          {
            placeholderType: "ctrTitle",
            levelsStyles: [
              {
                level: 1,
                textStyle: {
                  fill: { color: { type: 2, value: "lt1" } },
                  fontSize: 3200,
                },
              },
            ],
          },
        ],
        id: "layout-title",
        parentLayoutId: "master-title",
      },
    ];

    const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
    const title = (effectiveSlide.elements as Array<Record<string, unknown>>)[0];
    const paragraph = (title.paragraphs as Array<Record<string, unknown>>)[0];
    const paragraphTextStyle = paragraph.textStyle as Record<string, unknown>;

    expect(paragraphTextStyle.bold).toBe(true);
    expect(paragraphTextStyle.fill).toEqual({ color: { type: 2, value: "lt1" } });
    expect(paragraphTextStyle.fontSize).toBe(3200);
    expect(paragraphTextStyle.typeface).toBe("Bitter");
    expect(((paragraph.runs as Array<Record<string, unknown>>)[0].textStyle as Record<string, unknown>).fontSize).toBe(4800);
  });

  it("inherits non-placeholder layout artwork before slide content", () => {
    const slide = {
      elements: [
        {
          id: "title-1",
          paragraphs: [{ runs: [{ text: "Slide title" }] }],
          placeholderType: "title",
        },
      ],
      useLayoutId: "layout-1",
    };
    const layouts = [
      {
        elements: [
          {
            bbox: {
              heightEmu: 6_858_000,
              widthEmu: 12_192_000,
              xEmu: 0,
              yEmu: 0,
            },
            fill: {
              imageReference: { id: "/ppt/media/background.png" },
              type: 4,
            },
            id: "background-art",
            name: "background.png",
            type: 7,
          },
          {
            bbox: {
              heightEmu: 1_000,
              widthEmu: 2_000,
              xEmu: 100,
              yEmu: 200,
            },
            placeholderType: "title",
          },
        ],
        id: "layout-1",
      },
    ];

    const effectiveSlide = applyPresentationLayoutInheritance(slide, layouts);
    const effectiveElements = effectiveSlide.elements as Array<Record<string, unknown>>;

    expect(effectiveElements).toHaveLength(2);
    expect(effectiveElements[0]?.id).toBe("background-art");
    expect(effectiveElements[1]?.id).toBe("title-1");
    expect(effectiveElements[1]?.bbox).toEqual({
      heightEmu: 1_000,
      widthEmu: 2_000,
      xEmu: 100,
      yEmu: 200,
    });
  });

  it("uses explicit PPT slide size instead of expanding to off-canvas template artwork", () => {
    expect(
      getSlideBounds({
        elements: [
          {
            bbox: {
              heightEmu: 1_000,
              widthEmu: 1_000,
              xEmu: 30_000_000,
              yEmu: 0,
            },
          },
        ],
        heightEmu: 13_716_000,
        widthEmu: 24_384_000,
      }),
    ).toEqual({
      height: 13_716_000,
      width: 24_384_000,
    });
  });

  it("inherits document text styles through basedOn chains", () => {
    const paragraph = paragraphView(
      {
        runs: [{ text: "Inherited heading" }],
        styleId: "Heading1",
      },
      {
        images: new Map(),
        textStyles: new Map([
          [
            "Normal",
            {
              id: "Normal",
              textStyle: { fill: { color: { type: 1, value: "111111" } }, fontSize: 1050 },
              spaceAfter: 200,
            },
          ],
          [
            "Heading1",
            {
              basedOn: "Normal",
              id: "Heading1",
              paragraphStyle: { alignment: 2 },
              textStyle: { bold: true },
              spaceBefore: 480,
            },
          ],
        ]),
      },
    );

    expect(paragraph.style?.bold).toBe(true);
    expect(paragraph.style?.fontSize).toBe(1050);
    expect(paragraph.style?.spaceAfter).toBe(200);
    expect(paragraph.style?.spaceBefore).toBe(480);
    expect(paragraph.style?.alignment).toBe(2);
    expect(paragraph.runs[0]?.style?.bold).toBe(true);
  });

  it("maps PPT shadow effects into canvas offsets", () => {
    const shadow = presentationShadowStyle(
      {
        effects: [
          {
            shadow: {
              blurRadius: 19_050,
              color: { transform: { alpha: 50_000 }, type: 1, value: "000000" },
              direction: 5_400_000,
              distance: 9_525,
            },
          },
        ],
      },
      1,
    );

    expect(shadow?.color).toBe("rgba(0, 0, 0, 0.5)");
    expect(shadow?.blur).toBeCloseTo(2);
    expect(shadow?.offsetX).toBeCloseTo(0, 5);
    expect(shadow?.offsetY).toBeCloseTo(1);
  });
});

function mockCanvasContext(): CanvasRenderingContext2D & { lineDashes: number[][]; strokeStyles: string[] } {
  const state = {
    fillStyle: "",
    lineDashes: [] as number[][],
    strokeStyle: "",
    strokeStyles: [] as string[],
  };
  return ({
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      state.fillStyle = String(value);
    },
    get lineDashes() {
      return state.lineDashes;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      state.strokeStyle = String(value);
    },
    get strokeStyles() {
      return state.strokeStyles;
    },
    arc: () => {},
    beginPath: () => {},
    clip: () => {},
    closePath: () => {},
    fill: () => {},
    fillRect: () => {},
    fillText: () => {},
    lineTo: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
    moveTo: () => {},
    rect: () => {},
    restore: () => {},
    rotate: () => {},
    save: () => {},
    setLineDash: (segments: number[]) => state.lineDashes.push([...segments]),
    stroke: () => state.strokeStyles.push(state.strokeStyle),
    strokeRect: () => {},
    translate: () => {},
  } as unknown) as CanvasRenderingContext2D & { lineDashes: number[][]; strokeStyles: string[] };
}
