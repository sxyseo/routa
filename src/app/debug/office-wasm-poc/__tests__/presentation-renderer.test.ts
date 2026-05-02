import { describe, expect, it } from "vitest";

import { officeFontFamily } from "../office-preview-utils";
import {
  computePresentationFit,
  emuRectToCanvasRect,
  presentationImageSourceRect,
  presentationLineStyle,
  presentationScaledFontSize,
  presentationShadowStyle,
  presentationShapeKind,
} from "../presentation-renderer";

describe("presentation renderer helpers", () => {
  it("quotes source typefaces and appends Office/CJK fallbacks", () => {
    expect(officeFontFamily("PingFang SC")).toContain('"PingFang SC"');
    expect(officeFontFamily('Aptos "Display"')).toContain('"Aptos \\"Display\\""');
    expect(officeFontFamily("")).toContain("Carlito");
    expect(officeFontFamily("")).toContain('"Microsoft YaHei"');
    expect(officeFontFamily("Noto Serif CJK SC")).toContain('"Songti SC"');
  });

  it("fits a slide into the viewport with Codex-like padding and zoom clamping", () => {
    const fit = computePresentationFit({ height: 720, width: 1280 }, { height: 720, width: 1280 });
    expect(fit.width).toBeCloseTo(1109.33, 1);
    expect(fit.height).toBeCloseTo(624, 1);

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
    expect(presentationShapeKind({ geometry: 23 }, rect)).toBe("triangle");
    expect(presentationShapeKind({ geometry: 30 }, rect)).toBe("diamond");
    expect(presentationShapeKind({ geometry: 39 }, rect)).toBe("hexagon");
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

  it("maps PPT line styles without clamping Office line widths", () => {
    const line = presentationLineStyle(
      {
        cap: 3,
        fill: { color: { type: 1, value: "8FA69D" } },
        join: 1,
        style: 2,
        widthEmu: 19_050,
      },
      2,
    );

    expect(line.color).toBe("#8FA69D");
    expect(line.width).toBeCloseTo(4);
    expect(line.lineCap).toBe("round");
    expect(line.lineJoin).toBe("round");
    expect(line.dash.length).toBeGreaterThan(0);
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
