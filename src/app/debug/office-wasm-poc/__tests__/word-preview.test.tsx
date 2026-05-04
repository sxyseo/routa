import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewLabels } from "../office-preview-utils";
import {
  WordPreview,
  wordChartStyle,
  wordImageStyle,
  wordTableCellStyle,
  wordTableContainerStyle,
} from "../word-preview";

const labels: PreviewLabels = {
  closeSlideshow: "Close",
  nextSlide: "Next",
  playSlideshow: "Play",
  previousSlide: "Previous",
  visualPreview: "Preview",
  rawJson: "JSON",
  sheet: "Sheet",
  slide: "Slide",
  noSheets: "No sheets",
  noSlides: "No slides",
  noDocumentBlocks: "No document blocks",
  showingFirstRows: "Showing rows",
  shapes: "Shapes",
  textRuns: "Text runs",
};

describe("WordPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses decoded DOCX table bbox, spans, and column widths", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              bbox: {
                widthEmu: 2_857_500,
                xEmu: 95_250,
              },
              table: {
                columnWidths: [1000, 3000, 2000],
                rows: [
                  {
                    cells: [
                      {
                        id: "cell-1",
                        gridSpan: 2,
                        paragraphs: [{ runs: [{ text: "Merged heading" }] }],
                      },
                      {
                        id: "cell-2",
                        paragraphs: [{ runs: [{ text: "Tail" }] }],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }}
      />,
    );

    const firstCell = container.querySelector("td");
    const tableWrapper = container.querySelector("table")?.parentElement;
    const columns = Array.from(container.querySelectorAll("col"));
    expect(firstCell?.getAttribute("colspan")).toBe("2");
    expect(tableWrapper?.style.width).toBe("300px");
    expect(tableWrapper?.style.marginLeft).toBe("10px");
    expect(columns.map((column) => column.getAttribute("style"))).toEqual([
      "width: 16.666666666666664%;",
      "width: 50%;",
      "width: 33.33333333333333%;",
    ]);
  });

  it("maps decoded DOCX cell margins, anchors, and borders into CSS", () => {
    const style = wordTableCellStyle(
      {
        anchor: "center",
        lines: {
          bottom: {
            style: 3,
            widthEmu: 19_050,
            fill: { color: { value: "CCCCCC" } },
          },
        },
        marginBottom: 19_050,
        marginLeft: 38_100,
        marginRight: 47_625,
        marginTop: 9_525,
      },
      "#ffffff",
      "#0f172a",
    );

    expect(style).toMatchObject({
      borderBottomColor: "#CCCCCC",
      borderBottomStyle: "dotted",
      borderBottomWidth: 2.1166666666666667,
      borderWidth: 0,
      paddingBottom: 2,
      paddingLeft: 4,
      paddingRight: 5,
      paddingTop: 2,
      verticalAlign: "middle",
    });
  });

  it("maps decoded DOCX paragraph alignment, indentation, and line spacing into CSS", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              paragraphs: [
                {
                  paragraphStyle: {
                    alignment: 4,
                    indent: -47_625,
                    lineSpacingPercent: 150_000,
                    marginLeft: 190_500,
                  },
                  runs: [{ text: "Indented justified paragraph" }],
                },
              ],
            },
          ],
        }}
      />,
    );

    const paragraph = container.querySelector("p");
    expect(paragraph?.style.lineHeight).toBe("1.5");
    expect(paragraph?.style.marginLeft).toBe("20px");
    expect(paragraph?.style.textAlign).toBe("justify");
    expect(paragraph?.style.textIndent).toBe("-5px");
  });

  it("maps decoded DOCX scheme metadata into run CSS", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              paragraphs: [
                {
                  runs: [
                    {
                      text: "highlighted caps",
                      textStyle: { scheme: "__docxHighlight:yellow;__docxCaps:true" },
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );

    const run = container.querySelector<HTMLElement>("p span");
    expect(run?.style.backgroundColor).toBe("rgb(255, 255, 0)");
    expect(run?.style.textTransform).toBe("uppercase");
  });

  it("renders decoded DOCX auto-number markers in document order", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              paragraphs: [
                {
                  id: "p1",
                  paragraphStyle: {
                    autoNumberStartAt: 3,
                    autoNumberType: "arabicPeriod",
                  },
                  runs: [{ text: "First item" }],
                },
                {
                  id: "p2",
                  paragraphStyle: {
                    autoNumberStartAt: 3,
                    autoNumberType: "arabicPeriod",
                  },
                  runs: [{ text: "Second item" }],
                },
              ],
            },
          ],
          paragraphNumberings: [
            { level: 0, numId: "list-1", paragraphId: "p1" },
            { level: 0, numId: "list-1", paragraphId: "p2" },
          ],
        }}
      />,
    );

    const paragraphs = Array.from(container.querySelectorAll("p")).map((paragraph) => paragraph.textContent);
    expect(paragraphs).toEqual(["3.First item", "4.Second item"]);
  });

  it("renders decoded DOCX hyperlinks and note reference markers", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          commentReferences: [{ commentId: "12", runIds: ["run-link"] }],
          comments: [{ id: "12", paragraphs: [{ runs: [{ text: "Check this" }] }] }],
          elements: [
            {
              paragraphs: [
                {
                  runs: [
                    {
                      hyperlink: { isExternal: true, uri: "https://example.test" },
                      id: "run-link",
                      text: "Linked text",
                    },
                  ],
                },
              ],
            },
          ],
          footnotes: [{ id: "footnote-1", referenceRunIds: ["run-link"] }],
        }}
      />,
    );

    const link = container.querySelector("a");
    const markers = Array.from(container.querySelectorAll("sup")).map((marker) => marker.textContent);
    expect(link?.getAttribute("href")).toBe("https://example.test");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(markers).toEqual(["1", "C1"]);
  });

  it("renders decoded DOCX footnote and comment bodies", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          comments: [{ id: "12", paragraphs: [{ runs: [{ text: "Comment body" }] }] }],
          elements: [
            {
              paragraphs: [{ runs: [{ id: "run-main", text: "Main text" }] }],
            },
          ],
          footnotes: [{ id: "footnote-1", paragraphs: [{ runs: [{ text: "Footnote body" }] }] }],
        }}
      />,
    );

    const paragraphs = Array.from(container.querySelectorAll("p")).map((paragraph) => paragraph.textContent);
    expect(paragraphs).toEqual(["Main text", "1Footnote body", "C1Comment body"]);
  });

  it("renders decoded DOCX section header and footer content", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              paragraphs: [{ runs: [{ text: "Body text" }] }],
            },
          ],
          sections: [
            {
              footer: { elements: [{ paragraphs: [{ runs: [{ text: "Footer text" }] }] }] },
              header: { elements: [{ paragraphs: [{ runs: [{ text: "Header text" }] }] }] },
            },
          ],
        }}
      />,
    );

    const paragraphs = Array.from(container.querySelectorAll("p")).map((paragraph) => paragraph.textContent);
    expect(paragraphs).toEqual(["Header text", "Body text", "Footer text"]);
  });

  it("renders decoded DOCX insertion review marks", () => {
    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          elements: [
            {
              paragraphs: [
                {
                  runs: [
                    {
                      id: "run-inserted",
                      reviewMarkIds: ["review-9"],
                      text: "Inserted text",
                    },
                  ],
                },
              ],
            },
          ],
          reviewMarks: [{ id: "review-9", type: 1 }],
        }}
      />,
    );

    const run = container.querySelector<HTMLElement>("p span");
    expect(run?.style.backgroundColor).toBe("rgb(220, 252, 231)");
    expect(run?.style.textDecoration).toContain("underline");
  });

  it("uses decoded DOCX image bbox for preview dimensions", () => {
    const style = wordImageStyle(
      {
        bbox: {
          heightEmu: 457_200,
          widthEmu: 914_400,
          xEmu: 457_200,
        },
      },
      "blob:test-image",
    );

    expect(style).toMatchObject({
      aspectRatio: "96 / 48",
      backgroundImage: 'url("blob:test-image")',
      height: undefined,
      marginLeft: 48,
      width: 96,
    });
  });

  it("uses decoded DOCX table bbox for preview dimensions", () => {
    const style = wordTableContainerStyle({
      bbox: {
        widthEmu: 2_857_500,
        xEmu: 95_250,
      },
    });

    expect(style).toMatchObject({
      marginLeft: 10,
      width: 300,
    });
  });

  it("renders DOCX chart references with decoded bbox sizing", async () => {
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      clip: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      rect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);

    const { container } = render(
      <WordPreview
        labels={labels}
        proto={{
          charts: [
            {
              id: "chart-1",
              series: [{ values: [2, 4, 3] }],
              title: "Delivery Trend",
            },
          ],
          elements: [
            {
              bbox: {
                heightEmu: 1_905_000,
                widthEmu: 3_810_000,
                xEmu: 95_250,
              },
              chartReference: { id: "chart-1" },
            },
          ],
        }}
      />,
    );

    const canvas = container.querySelector("canvas");
    expect(canvas?.getAttribute("aria-label")).toBe("Delivery Trend");
    expect(canvas?.getAttribute("style")).toContain("width: 400px");
    expect(canvas?.getAttribute("style")).toContain("height: 200px");
    expect(canvas?.style.marginLeft).toBe("10px");
    await waitFor(() => expect(getContext).toHaveBeenCalledWith("2d"));
    expect(context.setTransform).toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalled();
  });

  it("uses decoded DOCX chart bbox for preview dimensions", () => {
    const style = wordChartStyle({
      bbox: {
        heightEmu: 1_905_000,
        widthEmu: 3_810_000,
        xEmu: 95_250,
      },
    });

    expect(style).toMatchObject({
      height: 200,
      marginLeft: 10,
      width: 400,
    });
  });
});
