import { describe, expect, it } from "vitest";

import { officeFontFamily } from "../office-preview-utils";
import {
  computePresentationFit,
  emuRectToCanvasRect,
  presentationImageSourceRect,
  presentationScaledFontSize,
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
});
