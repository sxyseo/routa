import { describe, expect, it } from "vitest";

import { officeFontFamily } from "../office-preview-utils";
import { computePresentationFit, emuRectToCanvasRect } from "../presentation-renderer";

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
});
