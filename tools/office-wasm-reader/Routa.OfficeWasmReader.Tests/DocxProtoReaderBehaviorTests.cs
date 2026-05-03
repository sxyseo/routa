using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Google.Protobuf;
using Xunit;

namespace Routa.OfficeWasmReader.Tests;

/// <summary>
/// Focused behavior tests for DocxDocumentProtoReader that test specific
/// domain contracts through the public Read() API. These tests are more
/// targeted than the golden contract tests and describe *why* the output
/// is what it is, making them useful guards during refactoring.
/// </summary>
public class DocxProtoReaderBehaviorTests
{
    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a minimal in-memory .docx with a single body paragraph.
    /// </summary>
    private static byte[] BuildDocx(Action<Body> configure)
    {
        using var ms = new MemoryStream();
        using var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        configure(mainPart.Document.Body!);
        mainPart.Document.Save();
        doc.Save();
        return ms.ToArray();
    }

    private static byte[] SingleParagraphDocx(string text)
    {
        return BuildDocx(body =>
            body.AppendChild(new Paragraph(new Run(new Text(text)))));
    }

    // ── empty / null input ────────────────────────────────────────────────────

    [Fact]
    public void Read_EmptyDocument_ReturnsNonEmptyBytes()
    {
        var docx = BuildDocx(_ => { });
        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }

    // ── text extraction ───────────────────────────────────────────────────────

    [Fact]
    public void Read_SingleParagraph_ProtoIsNonEmpty()
    {
        var docx = SingleParagraphDocx("Hello world");
        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }

    [Fact]
    public void Read_TwoParagraphs_ProtoLargerThanOne()
    {
        var singleDocx = SingleParagraphDocx("Alpha");
        var singleBytes = DocxDocumentProtoReader.Read(singleDocx).Length;
        var doubleDocx = BuildDocx(body =>
        {
            body.AppendChild(new Paragraph(new Run(new Text("Alpha"))));
            body.AppendChild(new Paragraph(new Run(new Text("Beta"))));
        });
        var doubleBytes = DocxDocumentProtoReader.Read(doubleDocx).Length;
        Assert.True(doubleBytes > singleBytes,
            "Document with more paragraphs should produce larger proto output");
    }

    [Fact]
    public void Read_DeterministicOutput_SameInputSameOutput()
    {
        var docx = SingleParagraphDocx("Stable content");
        var first = DocxDocumentProtoReader.Read(docx);
        var second = DocxDocumentProtoReader.Read(docx);
        Assert.Equal(first, second);
    }

    // ── table ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Read_SingleCellTable_ProtoIsNonEmpty()
    {
        var docx = BuildDocx(body =>
        {
            var table = new Table(
                new TableRow(
                    new TableCell(new Paragraph(new Run(new Text("Cell"))))));
            body.AppendChild(table);
        });
        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }

    [Fact]
    public void Read_Table_ProtoLargerThanParagraph()
    {
        var paragraphDocx = SingleParagraphDocx("Cell text");
        var tableDocx = BuildDocx(body =>
        {
            var table = new Table(
                new TableRow(
                    new TableCell(new Paragraph(new Run(new Text("Cell text"))))));
            body.AppendChild(table);
        });

        var paragraphSize = DocxDocumentProtoReader.Read(paragraphDocx).Length;
        var tableSize = DocxDocumentProtoReader.Read(tableDocx).Length;
        Assert.True(tableSize > paragraphSize,
            "Table element should produce more proto bytes than a plain paragraph");
    }

    // ── hyperlink ─────────────────────────────────────────────────────────────

    [Fact]
    public void Read_ParagraphWithHyperlink_ProtoIsNonEmpty()
    {
        var docx = BuildDocx(body =>
        {
            var para = new Paragraph();
            var hyperlink = new Hyperlink(new Run(new Text("Click me")))
            {
                Anchor = new StringValue("bookmark1"),
            };
            para.AppendChild(hyperlink);
            body.AppendChild(para);
        });

        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }

    // ── review marks ──────────────────────────────────────────────────────────

    [Fact]
    public void Read_InsertedRun_ProtoIsNonEmpty()
    {
        var docx = BuildDocx(body =>
        {
            var para = new Paragraph(
                new InsertedRun(new Run(new Text("Inserted text")))
                {
                    Id = new StringValue("1"),
                    Author = "Author A",
                    Date = new DateTimeValue(DateTime.UtcNow),
                });
            body.AppendChild(para);
        });

        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }

    // ── section ───────────────────────────────────────────────────────────────

    [Fact]
    public void Read_DocumentWithExplicitPageSize_ProtoIsNonEmpty()
    {
        var docx = BuildDocx(body =>
        {
            body.AppendChild(new Paragraph(new Run(new Text("Content"))));
            body.AppendChild(new SectionProperties(
                new PageSize { Width = 12_240U, Height = 15_840U }));
        });

        var result = DocxDocumentProtoReader.Read(docx);
        Assert.NotEmpty(result);
    }
}
