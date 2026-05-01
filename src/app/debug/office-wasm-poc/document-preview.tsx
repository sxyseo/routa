"use client";

import { type CSSProperties } from "react";

import {
  asArray,
  asRecord,
  asString,
  collectTextBlocks,
  elementImageReferenceId,
  type DocumentStyleMaps,
  paragraphStyle,
  type ParagraphView,
  paragraphView,
  type PreviewLabels,
  type RecordValue,
  textRunStyle,
  useOfficeImageSources,
} from "./office-preview-utils";

export function DocumentPreview({ labels, proto }: { labels: PreviewLabels; proto: unknown }) {
  const root = asRecord(proto);
  const elements = asArray(root?.elements);
  const imageSources = useOfficeImageSources(root);
  const textStyles = new Map<string, RecordValue>();
  for (const style of asArray(root?.textStyles)) {
    const record = asRecord(style);
    const id = asString(record?.id);
    if (record && id) textStyles.set(id, record);
  }
  const styleMaps: DocumentStyleMaps = { textStyles, images: imageSources };

  const hasRenderableBlocks = elements.some((element) => {
    const record = asRecord(element);
    return (
      record != null &&
      (asArray(record.paragraphs).length > 0 || asRecord(record.table) != null || elementImageReferenceId(record) !== "")
    );
  });

  if (!hasRenderableBlocks) {
    const blocks = collectTextBlocks(elements.length > 0 ? elements : proto, 120);
    if (blocks.length === 0) {
      return <p style={{ color: "#64748b" }}>{labels.noDocumentBlocks}</p>;
    }

    return (
      <div data-testid="document-preview" style={{ display: "grid", gap: 10 }}>
        {blocks.map((block, index) => (
          <p key={`${block.slice(0, 24)}-${index}`} style={documentFallbackBlockStyle}>
            {block}
          </p>
        ))}
      </div>
    );
  }

  return (
    <article
      data-testid="document-preview"
      style={{
        background: "#ffffff",
        borderColor: "#d8e0ea",
        borderRadius: 8,
        borderStyle: "solid",
        borderWidth: 1,
        boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
        color: "#0f172a",
        display: "grid",
        gap: 6,
        margin: "0 auto",
        maxWidth: 920,
        minHeight: 680,
        padding: "56px 64px",
        width: "100%",
      }}
    >
      {elements.map((element, index) => (
        <DocumentElement
          element={asRecord(element) ?? {}}
          key={`${asString(asRecord(element)?.id)}-${index}`}
          styleMaps={styleMaps}
        />
      ))}
    </article>
  );
}

function DocumentElement({
  element,
  styleMaps,
}: {
  element: RecordValue;
  styleMaps: DocumentStyleMaps;
}) {
  const table = asRecord(element.table);
  if (table) return <DocumentTable table={table} styleMaps={styleMaps} />;

  const imageId = elementImageReferenceId(element);
  const imageSrc = imageId ? styleMaps.images.get(imageId) : undefined;
  if (imageSrc) {
    return (
      <span
        aria-label={asString(element.name)}
        role="img"
        style={{
          backgroundImage: `url("${imageSrc}")`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          display: "block",
          height: 280,
          maxHeight: 360,
          maxWidth: "100%",
          width: "100%",
        }}
      />
    );
  }

  const paragraphs = asArray(element.paragraphs).map((paragraph) => paragraphView(paragraph, styleMaps));
  if (paragraphs.length === 0) return null;

  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <DocumentParagraph key={paragraph.id || index} paragraph={paragraph} />
      ))}
    </>
  );
}

function DocumentParagraph({ paragraph }: { paragraph: ParagraphView }) {
  return (
    <p style={paragraphStyle(paragraph)}>
      {paragraph.runs.map((run, index) => (
        <span key={run.id || index} style={textRunStyle(run)}>
          {run.text}
        </span>
      ))}
    </p>
  );
}

function DocumentTable({
  styleMaps,
  table,
}: {
  styleMaps: DocumentStyleMaps;
  table: RecordValue;
}) {
  const rows = asArray(table.rows).map(asRecord).filter((row): row is RecordValue => row != null);
  if (rows.length === 0) return null;

  return (
    <div style={{ margin: "12px 0 18px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", minWidth: "70%", width: "100%" }}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={asString(row.id) || rowIndex}>
              {asArray(row.cells).map((cell, cellIndex) => {
                const cellRecord = asRecord(cell) ?? {};
                const paragraphs = asArray(cellRecord.paragraphs).map((paragraph) => paragraphView(paragraph, styleMaps));
                return (
                  <td
                    key={asString(cellRecord.id) || cellIndex}
                    style={{
                      background: rowIndex === 0 ? "#f8fafc" : "#ffffff",
                      borderColor: "#cbd5e1",
                      borderStyle: "solid",
                      borderWidth: 1,
                      color: "#0f172a",
                      padding: "8px 10px",
                      verticalAlign: "top",
                    }}
                  >
                    {paragraphs.length > 0 ? (
                      paragraphs.map((paragraph, index) => (
                        <DocumentParagraph key={paragraph.id || index} paragraph={paragraph} />
                      ))
                    ) : (
                      asString(cellRecord.text)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const documentFallbackBlockStyle: CSSProperties = {
  borderBottomColor: "#e2e8f0",
  borderBottomStyle: "solid",
  borderBottomWidth: 1,
  color: "#0f172a",
  lineHeight: 1.6,
  margin: 0,
  paddingBottom: 10,
  whiteSpace: "pre-wrap",
};
