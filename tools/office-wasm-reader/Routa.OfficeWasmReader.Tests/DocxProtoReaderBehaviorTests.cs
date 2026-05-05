using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Google.Protobuf;
using System.Globalization;
using System.Text;
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
    private static readonly byte[] TinyPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axm8R0AAAAASUVORK5CYII=");

    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a minimal in-memory .docx with a single body paragraph.
    /// </summary>
    private static byte[] BuildDocx(Action<Body> configure)
    {
        return BuildDocx((_, body) => configure(body));
    }

    private static byte[] BuildDocx(Action<MainDocumentPart, Body> configure)
    {
        using var ms = new MemoryStream();
        using var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document);
        var mainPart = doc.AddMainDocumentPart();
        mainPart.Document = new Document(new Body());
        configure(mainPart, mainPart.Document.Body!);
        mainPart.Document.Save();
        doc.Save();
        return ms.ToArray();
    }

    private static byte[] SingleParagraphDocx(string text)
    {
        return BuildDocx(body =>
            body.AppendChild(new Paragraph(new Run(new Text(text)))));
    }

    private static byte[] AnchoredImageDocx(
        long verticalOffsetEmu,
        string behindDoc = "0",
        int relativeHeight = 0)
    {
        return BuildDocx((mainPart, body) =>
        {
            var imagePart = mainPart.AddImagePart(ImagePartType.Png, "rIdImage1");
            using var imageStream = new MemoryStream(TinyPng);
            imagePart.FeedData(imageStream);
            body.AppendChild(new Paragraph(new Run(new Drawing(AnchoredImageDrawingXml(
                verticalOffsetEmu,
                behindDoc: behindDoc,
                relativeHeight: relativeHeight)))));
        });
    }

    private static byte[] CroppedImageDocx()
    {
        return BuildDocx((mainPart, body) =>
        {
            var imagePart = mainPart.AddImagePart(ImagePartType.Png, "rIdImage1");
            using var imageStream = new MemoryStream(TinyPng);
            imagePart.FeedData(imageStream);
            body.AppendChild(new Paragraph(new Run(new Drawing(AnchoredImageDrawingXml(
                0,
                "<a:srcRect l=\"10000\" t=\"5000\" r=\"30000\" b=\"20000\"/>")))));
        });
    }

    private static string AnchoredImageDrawingXml(
        long verticalOffsetEmu,
        string sourceRectangle = "",
        string behindDoc = "0",
        int relativeHeight = 0)
    {
        var offset = verticalOffsetEmu.ToString(CultureInfo.InvariantCulture);
        var relativeHeightValue = relativeHeight.ToString(CultureInfo.InvariantCulture);
        return $"""
<w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <wp:anchor allowOverlap="1" behindDoc="{behindDoc}" distB="0" distT="0" distL="0" distR="0" layoutInCell="1" relativeHeight="{relativeHeightValue}" simplePos="0">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>
    <wp:positionV relativeFrom="page"><wp:posOffset>{offset}</wp:posOffset></wp:positionV>
    <wp:extent cx="914400" cy="914400"/>
    <wp:effectExtent b="0" l="0" r="0" t="0"/>
    <wp:wrapTopAndBottom distB="0" distT="0"/>
    <wp:docPr id="1" name="test.png"/>
    <a:graphic>
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic>
          <pic:nvPicPr><pic:cNvPr id="0" name="test.png"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="rIdImage1"/>{sourceRectangle}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>
""";
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

    [Fact]
    public void Read_GeneratedTableOfContentsContentControl_RetainsVisibleEntries()
    {
        var docx = BuildDocx(body =>
        {
            body.AppendChild(new SdtBlock(
                new SdtProperties(
                    new SdtContentDocPartObject(
                        new DocPartGallery { Val = "Table of Contents" },
                        new DocPartUnique { Val = true })),
                new SdtContentBlock(
                    new Paragraph(new Run(new Text("Thoughtworks approach to operations and maintenance"))),
                    new Paragraph(new Run(new Text("Service configuration"))))));
        });

        var result = DocxDocumentProtoReader.Read(docx);
        var protoText = Encoding.UTF8.GetString(result);
        Assert.Contains("Thoughtworks approach to operations and maintenance", protoText);
        Assert.Contains("Service configuration", protoText);
    }

    [Fact]
    public void Read_PageRelativeAnchorVerticalOffset_AffectsImageBoundingBox()
    {
        var topAnchored = DocxDocumentProtoReader.Read(AnchoredImageDocx(0));
        var lowerAnchored = DocxDocumentProtoReader.Read(AnchoredImageDocx(914_400));

        Assert.NotEqual(topAnchored, lowerAnchored);
    }

    [Fact]
    public void Read_ImageSourceRectangle_AffectsImageProto()
    {
        var uncropped = DocxDocumentProtoReader.Read(AnchoredImageDocx(0));
        var cropped = DocxDocumentProtoReader.Read(CroppedImageDocx());

        Assert.True(cropped.Length > uncropped.Length);
    }

    [Fact]
    public void Read_AnchoredImageLayering_AffectsImageProto()
    {
        var foreground = DocxDocumentProtoReader.Read(AnchoredImageDocx(
            0,
            behindDoc: "0",
            relativeHeight: 10));
        var behindText = DocxDocumentProtoReader.Read(AnchoredImageDocx(
            0,
            behindDoc: "1",
            relativeHeight: 10));

        Assert.NotEqual(foreground, behindText);
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

    [Fact]
    public void Read_TrailingBodySectionAfterBreakExpansion_RetainsFinalSection()
    {
        var docx = BuildDocx(body =>
        {
            body.AppendChild(new Paragraph(new Run(new Text("First section"))));
            body.AppendChild(new Paragraph(
                new ParagraphProperties(new SectionProperties(
                    new SectionType { Val = SectionMarkValues.NextPage },
                    new PageSize { Width = 12_240U, Height = 15_840U })),
                new Run(new Text("Before hard-break section"))));
            body.AppendChild(new Paragraph(
                new Run(new Break { Type = BreakValues.Page }),
                new Run(new Text("Middle hard-break section"))));
            body.AppendChild(new Paragraph(
                new ParagraphProperties(new SectionProperties(
                    new SectionType { Val = SectionMarkValues.NextPage },
                    new PageSize { Width = 12_240U, Height = 15_840U })),
                new Run(new Text("Before trailing body section"))));
            body.AppendChild(new Paragraph(new Run(new Text("Final contact section"))));
            body.AppendChild(new SectionProperties(
                new SectionType { Val = SectionMarkValues.NextPage },
                new PageSize { Width = 12_240U, Height = 15_840U }));
        });

        var protoText = Encoding.UTF8.GetString(DocxDocumentProtoReader.Read(docx));
        Assert.Contains("section-4", protoText);
        Assert.Contains("Final contact section", protoText);
    }
}
