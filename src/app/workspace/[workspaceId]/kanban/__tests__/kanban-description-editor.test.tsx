import { describe, expect, it } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "../kanban-description-editor";

describe("KanbanDescriptionEditor markdown conversion", () => {
  it("preserves bullet and ordered list structure when converting edited HTML back to markdown", () => {
    const markdown = htmlToMarkdown(`
      <ul>
        <li>First item</li>
        <li>Second item
          <ol>
            <li>Nested first</li>
            <li>Nested second</li>
          </ol>
        </li>
      </ul>
    `);

    expect(markdown).toBe("- First item\n- Second item\n  1. Nested first\n  2. Nested second");
  });

  it("escapes markdown-sensitive inline content during roundtrip serialization", () => {
    const markdown = htmlToMarkdown("<p><strong>Bold</strong> + [link-like] text</p>");

    expect(markdown).toBe("**Bold** \\+ \\[link\\-like\\] text");
    expect(markdownToHtml(markdown)).toContain("<strong>Bold</strong>");
  });
});
