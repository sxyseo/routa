import { describe, expect, it } from "vitest";

import { wordImageStyle } from "../word-preview-layout";

describe("word preview layout", () => {
  it("renders decoded DOCX image outlines as CSS borders", () => {
    const style = wordImageStyle(
      {
        bbox: { heightEmu: 457_200, widthEmu: 914_400 },
        line: { fill: { color: { value: "FF0000" } }, widthEmu: 12_700 },
      },
      "blob:test-image",
    );

    expect(style).toMatchObject({ borderColor: "#FF0000", borderStyle: "solid", boxSizing: "border-box" });
    expect(Number(style.borderWidth)).toBeCloseTo(1.41, 1);
  });

  it("renders decoded DOCX image shadows as CSS box shadows", () => {
    const style = wordImageStyle(
      {
        bbox: { heightEmu: 457_200, widthEmu: 914_400 },
        effects: [
          {
            shadow: {
              blurRadius: 19_050,
              color: { transform: { alpha: 50_000 }, value: "000000" },
              direction: 5_400_000,
              distance: 9_525,
            },
          },
        ],
      },
      "blob:test-image",
    );

    expect(style.boxShadow).toBe("0px 1px 2px rgba(0, 0, 0, 0.5)");
  });
});
