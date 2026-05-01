using System.Security.Cryptography;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Routa.OfficeWasmReader;

internal static class DocxDocumentProtoReader
{
    private const int ElementTypeText = 1;
    private const int ElementTypeImageReference = 7;
    private const int ElementTypeTable = 9;
    private const int ColorTypeRgb = 1;
    private const int AlignmentLeft = 1;
    private const int AlignmentCenter = 2;
    private const int AlignmentRight = 3;
    private const int SectionBreakNextPage = 2;
    private const long EmuPerTwip = 635L;

    public static byte[] Read(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var document = WordprocessingDocument.Open(stream, false);
        var mainPart = document.MainDocumentPart;
        var body = mainPart?.Document.Body;
        if (mainPart is null || body is null)
        {
            return Message(_ => { });
        }

        var page = PageMetrics.From(body);
        var context = new DocxReadContext(mainPart, page);
        var elements = ExtractBodyElements(body, context).Take(OpenXmlReaderLimits.MaxDocumentTextBlocks).ToList();
        var images = context.Images.Values.OrderBy(image => image.Id, StringComparer.Ordinal).ToList();

        return Message(output =>
        {
            WriteInt64(output, 3, page.WidthTwips);
            WriteInt64(output, 4, page.HeightTwips);

            foreach (var element in elements)
            {
                WriteMessage(output, 5, element);
            }

            foreach (var image in images)
            {
                WriteMessage(output, 7, WriteImage(image));
            }

            foreach (var style in ExtractTextStyles(mainPart))
            {
                WriteMessage(output, 11, style);
            }

            WriteMessage(output, 13, WriteSection(page));

            foreach (var numbering in ExtractNumberingDefinitions(mainPart))
            {
                WriteMessage(output, 14, numbering);
            }
        });
    }

    private static IEnumerable<byte[]> ExtractBodyElements(W.Body body, DocxReadContext context)
    {
        foreach (var child in body.ChildElements)
        {
            if (child is W.Paragraph paragraph)
            {
                var paragraphProto = WriteParagraph(paragraph, context);
                if (paragraphProto is not null)
                {
                    yield return WriteParagraphElement(paragraphProto);
                }

                foreach (var image in ExtractImageElements(paragraph, context))
                {
                    yield return image;
                }
            }
            else if (child is W.Table table)
            {
                yield return WriteTableElement(table, context);
            }
        }
    }

    private static byte[]? WriteParagraph(W.Paragraph paragraph, DocxReadContext context)
    {
        var runs = paragraph.Elements<W.Run>()
            .Select(run => WriteRun(run, context))
            .Where(run => run is not null)
            .Select(run => run!)
            .ToList();
        var hasDrawing = paragraph.Descendants<W.Drawing>().Any();
        if (runs.Count == 0 && !hasDrawing && !HasParagraphProperties(paragraph))
        {
            return null;
        }

        var id = $"paragraph-{context.NextParagraphIndex()}";
        return Message(output =>
        {
            foreach (var run in runs)
            {
                WriteMessage(output, 1, run);
            }

            var paragraphStyle = WriteParagraphTextStyle(paragraph.ParagraphProperties);
            if (paragraphStyle is not null)
            {
                WriteMessage(output, 2, paragraphStyle);
            }

            WriteInt32(output, 6, IntFromString(paragraph.ParagraphProperties?.SpacingBetweenLines?.After?.Value));
            WriteInt32(output, 7, IntFromString(paragraph.ParagraphProperties?.SpacingBetweenLines?.Before?.Value));
            WriteString(output, 8, paragraph.ParagraphProperties?.ParagraphStyleId?.Val?.Value);
            WriteString(output, 9, id);
        });
    }

    private static byte[]? WriteRun(W.Run run, DocxReadContext context)
    {
        var text = RunText(run);
        if (text.Length == 0)
        {
            return null;
        }

        var id = $"run-{context.NextRunIndex():x8}";
        return Message(output =>
        {
            WriteString(output, 1, text);
            var textStyle = WriteRunTextStyle(run.RunProperties);
            if (textStyle is not null)
            {
                WriteMessage(output, 2, textStyle);
            }

            WriteString(output, 4, id);
        });
    }

    private static IEnumerable<byte[]> ExtractImageElements(W.Paragraph paragraph, DocxReadContext context)
    {
        foreach (var drawing in paragraph.Descendants<W.Drawing>())
        {
            var blip = drawing.Descendants<A.Blip>().FirstOrDefault();
            var relationshipId = blip?.Embed?.Value;
            if (string.IsNullOrEmpty(relationshipId))
            {
                continue;
            }

            if (context.MainPart.GetPartById(relationshipId) is not ImagePart imagePart)
            {
                continue;
            }

            var image = context.AddImage(imagePart);
            var extent = drawing.Descendants<DW.Extent>().FirstOrDefault();
            var widthEmu = ToLong(extent?.Cx) ?? 0;
            var heightEmu = ToLong(extent?.Cy) ?? 0;
            var xEmu = context.Page.LeftMarginTwips * EmuPerTwip;
            var contentWidthEmu = context.Page.ContentWidthTwips * EmuPerTwip;
            var alignment = paragraph.ParagraphProperties?.Justification?.Val?.ToString();
            if (alignment == "center")
            {
                xEmu += Math.Max(0, contentWidthEmu - widthEmu) / 2;
            }
            else if (alignment == "right")
            {
                xEmu += Math.Max(0, contentWidthEmu - widthEmu);
            }

            yield return Message(output =>
            {
                WriteMessage(output, 1, WriteBoundingBox(xEmu, 0, widthEmu, heightEmu));
                WriteMessage(output, 3, WriteImageReference(image.Id));
                WriteInt32(output, 11, ElementTypeImageReference);
                WriteString(output, 27, $"element-{image.Id["image-".Length..]}");
            });
        }
    }

    private static byte[] WriteParagraphElement(byte[] paragraph)
    {
        return Message(output =>
        {
            WriteMessage(output, 6, paragraph);
            WriteInt32(output, 11, ElementTypeText);
        });
    }

    private static byte[] WriteTableElement(W.Table table, DocxReadContext context)
    {
        return Message(output =>
        {
            WriteMessage(
                output,
                1,
                WriteBoundingBox(
                    context.Page.LeftMarginTwips * EmuPerTwip,
                    0,
                    context.Page.ContentWidthTwips * EmuPerTwip,
                    0));
            WriteInt32(output, 11, ElementTypeTable);
            WriteMessage(output, 21, WriteTable(table, context));
        });
    }

    private static byte[] WriteTable(W.Table table, DocxReadContext context)
    {
        return Message(output =>
        {
            foreach (var row in table.Elements<W.TableRow>().Take(OpenXmlReaderLimits.MaxRowsPerTable))
            {
                WriteMessage(output, 1, WriteTableRow(row, context));
            }

            var gridWidths = table.GetFirstChild<W.TableGrid>()?.Elements<W.GridColumn>()
                .Select(column => IntFromString(column.Width?.Value))
                .Where(width => width is > 0)
                .Select(width => width!.Value)
                .ToList() ?? [];
            if (gridWidths.Count == 0)
            {
                var width = IntFromString(table.GetFirstChild<W.TableProperties>()?.TableWidth?.Width?.Value);
                if (width is > 0)
                {
                    gridWidths.Add(width.Value);
                }
            }

            foreach (var width in gridWidths)
            {
                WriteInt32Always(output, 2, width);
            }
        });
    }

    private static byte[] WriteTableRow(W.TableRow row, DocxReadContext context)
    {
        return Message(output =>
        {
            foreach (var cell in row.Elements<W.TableCell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
            {
                WriteMessage(output, 1, WriteTableCell(cell, context));
            }

            WriteString(output, 3, $"table-row-{context.NextTableRowIndex():x8}");
        });
    }

    private static byte[] WriteTableCell(W.TableCell cell, DocxReadContext context)
    {
        return Message(output =>
        {
            var text = string.Join("\n", cell.Elements<W.Paragraph>().Select(ParagraphText));
            WriteString(output, 1, text);

            foreach (var paragraph in cell.Elements<W.Paragraph>())
            {
                var paragraphProto = WriteParagraph(paragraph, context);
                if (paragraphProto is not null)
                {
                    WriteMessage(output, 3, paragraphProto);
                }
            }

            var fill = cell.TableCellProperties?.Shading?.Fill?.Value;
            if (IsHexColor(fill))
            {
                WriteMessage(output, 5, WriteColorFill(fill!));
            }

            WriteString(output, 7, $"table-cell-{context.NextTableCellIndex():x8}");
        });
    }

    private static IEnumerable<byte[]> ExtractTextStyles(MainDocumentPart mainPart)
    {
        foreach (var style in mainPart.StyleDefinitionsPart?.Styles?.Elements<W.Style>() ?? Enumerable.Empty<W.Style>())
        {
            if (style.Type?.Value != W.StyleValues.Paragraph)
            {
                continue;
            }

            var styleId = style.StyleId?.Value;
            if (string.IsNullOrEmpty(styleId))
            {
                continue;
            }

            yield return Message(output =>
            {
                WriteString(output, 1, styleId);
                WriteString(output, 2, style.StyleName?.Val?.Value ?? styleId);

                var textStyle = WriteRunTextStyle(style.StyleRunProperties);
                if (textStyle is not null)
                {
                    WriteMessage(output, 4, textStyle);
                }

                var paragraphStyle = WriteParagraphStyle(style.StyleParagraphProperties);
                if (paragraphStyle is not null)
                {
                    WriteMessage(output, 5, paragraphStyle);
                }

                WriteString(output, 6, style.BasedOn?.Val?.Value);
                WriteString(output, 8, style.NextParagraphStyle?.Val?.Value);
                WriteInt32(output, 9, IntFromString(style.StyleParagraphProperties?.SpacingBetweenLines?.Before?.Value));
                WriteInt32(output, 10, IntFromString(style.StyleParagraphProperties?.SpacingBetweenLines?.After?.Value));
            });
        }
    }

    private static IEnumerable<byte[]> ExtractNumberingDefinitions(MainDocumentPart mainPart)
    {
        var numbering = mainPart.NumberingDefinitionsPart?.Numbering;
        if (numbering is null)
        {
            yield break;
        }

        var abstractNums = numbering.Elements<W.AbstractNum>()
            .Where(item => item.AbstractNumberId?.Value is not null)
            .ToDictionary(item => item.AbstractNumberId!.Value!.ToString(), item => item);

        foreach (var instance in numbering.Elements<W.NumberingInstance>())
        {
            var numId = instance.NumberID?.Value.ToString();
            var abstractNumId = instance.AbstractNumId?.Val?.Value.ToString();
            if (string.IsNullOrEmpty(numId) || string.IsNullOrEmpty(abstractNumId))
            {
                continue;
            }

            abstractNums.TryGetValue(abstractNumId, out var abstractNum);
            yield return Message(output =>
            {
                WriteString(output, 1, numId);
                WriteString(output, 2, abstractNumId);
                foreach (var level in abstractNum?.Elements<W.Level>() ?? Enumerable.Empty<W.Level>())
                {
                    WriteMessage(output, 3, WriteNumberingLevel(level));
                }
            });
        }
    }

    private static byte[] WriteNumberingLevel(W.Level level)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, level.LevelIndex?.Value);
            WriteString(output, 2, level.NumberingFormat?.Val?.ToString());
            WriteString(output, 3, level.LevelText?.Val?.Value);
            WriteInt32(output, 4, level.StartNumberingValue?.Val?.Value);
            WriteString(output, 5, level.ParagraphStyleIdInLevel?.Val?.Value);
        });
    }

    private static byte[] WriteSection(PageMetrics page)
    {
        return Message(output =>
        {
            WriteString(output, 1, "section-1");
            WriteInt32(output, 2, SectionBreakNextPage);
            WriteMessage(output, 3, Message(pageOutput =>
            {
                WriteInt64(pageOutput, 1, page.WidthTwips);
                WriteInt64(pageOutput, 2, page.HeightTwips);
                WriteMessage(pageOutput, 3, Message(marginOutput =>
                {
                    WriteInt32(marginOutput, 1, page.TopMarginTwips);
                    WriteInt32(marginOutput, 2, page.BottomMarginTwips);
                    WriteInt32(marginOutput, 3, page.LeftMarginTwips);
                    WriteInt32(marginOutput, 4, page.RightMarginTwips);
                    WriteInt32(marginOutput, 5, page.HeaderTwips);
                    WriteInt32(marginOutput, 6, page.FooterTwips);
                    WriteInt32Always(marginOutput, 7, page.GutterTwips);
                }));
            }));
            WriteMessage(output, 4, Message(columnsOutput =>
            {
                WriteInt32(columnsOutput, 1, 1);
                WriteInt32(columnsOutput, 2, page.ColumnSpaceTwips);
            }));
        });
    }

    private static byte[]? WriteRunTextStyle(OpenXmlElement? runProperties)
    {
        if (runProperties is null)
        {
            return null;
        }

        var bold = runProperties.GetFirstChild<W.Bold>();
        var italic = runProperties.GetFirstChild<W.Italic>();
        var fontSize = runProperties.GetFirstChild<W.FontSize>();
        var colorElement = runProperties.GetFirstChild<W.Color>();
        var underlineElement = runProperties.GetFirstChild<W.Underline>();
        var runFonts = runProperties.GetFirstChild<W.RunFonts>();
        var hasStyle =
            bold is not null ||
            italic is not null ||
            fontSize?.Val?.Value is not null ||
            IsHexColor(colorElement?.Val?.Value) ||
            underlineElement?.Val is not null ||
            runFonts is not null;
        if (!hasStyle)
        {
            return null;
        }

        return Message(output =>
        {
            WriteBool(output, 4, bold?.Val?.Value ?? bold is not null);
            WriteBool(output, 5, italic?.Val?.Value ?? italic is not null);
            WriteInt32(output, 6, HalfPointStringToCentipoints(fontSize?.Val?.Value));
            var color = colorElement?.Val?.Value;
            if (IsHexColor(color))
            {
                WriteMessage(output, 7, WriteColorFill(color!));
            }

            var underline = underlineElement?.Val?.ToString();
            if (!string.IsNullOrEmpty(underline) && underline != "None")
            {
                WriteString(output, 9, underline);
            }

            var typeface =
                runFonts?.EastAsia?.Value ??
                runFonts?.Ascii?.Value ??
                runFonts?.HighAnsi?.Value ??
                runFonts?.ComplexScript?.Value;
            WriteString(output, 18, typeface);
        });
    }

    private static byte[]? WriteParagraphTextStyle(W.ParagraphProperties? paragraphProperties)
    {
        var alignment = AlignmentFromJustification(paragraphProperties?.Justification);
        if (alignment is null)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 8, alignment);
        });
    }

    private static byte[]? WriteParagraphStyle(W.StyleParagraphProperties? paragraphProperties)
    {
        if (paragraphProperties is null)
        {
            return null;
        }

        var linePercent = IntFromString(paragraphProperties.SpacingBetweenLines?.Line?.Value);
        if (linePercent is null)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 4, linePercent * 50);
        });
    }

    private static byte[] WriteColorFill(string color)
    {
        return Message(output =>
        {
            WriteMessage(output, 2, WriteColor(color));
        });
    }

    private static byte[] WriteColor(string color)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, ColorTypeRgb);
            WriteString(output, 2, color);
        });
    }

    private static byte[] WriteImage(DocumentImage image)
    {
        return Message(output =>
        {
            WriteString(output, 1, NormalizeImageContentType(image.ContentType));
            WriteBytes(output, 2, image.Bytes);
            WriteString(output, 3, image.Id);
        });
    }

    private static byte[] WriteImageReference(string imageId)
    {
        return Message(output =>
        {
            WriteString(output, 1, imageId);
        });
    }

    private static byte[] WriteBoundingBox(long xEmu, long yEmu, long widthEmu, long heightEmu)
    {
        return Message(output =>
        {
            WriteInt64(output, 1, xEmu);
            WriteInt64(output, 2, yEmu);
            WriteInt64(output, 3, widthEmu);
            WriteInt64(output, 4, heightEmu);
        });
    }

    private static bool HasParagraphProperties(W.Paragraph paragraph)
    {
        var properties = paragraph.ParagraphProperties;
        return properties?.ParagraphStyleId is not null ||
            properties?.Justification is not null ||
            properties?.SpacingBetweenLines is not null;
    }

    private static string ParagraphText(W.Paragraph paragraph)
    {
        return string.Concat(paragraph.Elements<W.Run>().Select(RunText));
    }

    private static string RunText(W.Run run)
    {
        return string.Concat(run.ChildElements.Select(child => child switch
        {
            W.Text text => text.Text,
            W.TabChar _ => "\t",
            W.Break _ => "\n",
            W.CarriageReturn _ => "\n",
            _ => "",
        }));
    }

    private static int? AlignmentFromJustification(W.Justification? justification)
    {
        return justification?.Val?.ToString() switch
        {
            "left" => AlignmentLeft,
            "center" => AlignmentCenter,
            "right" => AlignmentRight,
            _ => null,
        };
    }

    private static int? HalfPointStringToCentipoints(string? value)
    {
        var halfPoints = IntFromString(value);
        return halfPoints is null ? null : halfPoints * 50;
    }

    private static int? IntFromString(string? value)
    {
        return int.TryParse(value, out var parsed) ? parsed : null;
    }

    private static long? ToLong(Int64Value? value)
    {
        return value?.Value;
    }

    private static bool IsHexColor(string? value)
    {
        return value is { Length: 6 } && value.All(Uri.IsHexDigit);
    }

    private static string NormalizeImageContentType(string contentType)
    {
        return contentType == "image/jpeg" ? "image/jpg" : contentType;
    }

    private static byte[] Message(Action<CodedOutputStream> write)
    {
        using var stream = new MemoryStream();
        var output = new CodedOutputStream(stream);
        write(output);
        output.Flush();
        return stream.ToArray();
    }

    private static void WriteMessage(CodedOutputStream output, int fieldNumber, byte[] bytes)
    {
        if (bytes.Length == 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.LengthDelimited);
        output.WriteBytes(ByteString.CopyFrom(bytes));
    }

    private static void WriteString(CodedOutputStream output, int fieldNumber, string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.LengthDelimited);
        output.WriteString(value);
    }

    private static void WriteBytes(CodedOutputStream output, int fieldNumber, byte[] value)
    {
        if (value.Length == 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.LengthDelimited);
        output.WriteBytes(ByteString.CopyFrom(value));
    }

    private static void WriteInt32(CodedOutputStream output, int fieldNumber, int? value)
    {
        if (value is null or 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteInt32(value.Value);
    }

    private static void WriteInt32Always(CodedOutputStream output, int fieldNumber, int value)
    {
        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteInt32(value);
    }

    private static void WriteInt64(CodedOutputStream output, int fieldNumber, long? value)
    {
        if (value is null or 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteInt64(value.Value);
    }

    private static void WriteBool(CodedOutputStream output, int fieldNumber, bool value)
    {
        if (!value)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteBool(value);
    }

    private sealed class DocxReadContext(MainDocumentPart mainPart, PageMetrics page)
    {
        private int _paragraphIndex = 1;
        private int _runIndex = 1;
        private int _tableRowIndex = 1;
        private int _tableCellIndex = 1;

        public MainDocumentPart MainPart { get; } = mainPart;
        public PageMetrics Page { get; } = page;
        public Dictionary<string, DocumentImage> Images { get; } = [];

        public int NextParagraphIndex() => _paragraphIndex++;

        public int NextRunIndex() => _runIndex++;

        public int NextTableRowIndex() => _tableRowIndex++;

        public int NextTableCellIndex() => _tableCellIndex++;

        public DocumentImage AddImage(ImagePart imagePart)
        {
            using var stream = imagePart.GetStream();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            var bytes = memory.ToArray();
            var id = $"image-{Convert.ToHexString(SHA256.HashData(bytes)[..8]).ToLowerInvariant()}";
            if (!Images.TryGetValue(id, out var image))
            {
                image = new DocumentImage(id, NormalizeImageContentType(imagePart.ContentType), bytes);
                Images[id] = image;
            }

            return image;
        }
    }

    private sealed record DocumentImage(string Id, string ContentType, byte[] Bytes);

    private sealed record PageMetrics(
        long WidthTwips,
        long HeightTwips,
        int TopMarginTwips,
        int BottomMarginTwips,
        int LeftMarginTwips,
        int RightMarginTwips,
        int HeaderTwips,
        int FooterTwips,
        int GutterTwips,
        int ColumnSpaceTwips)
    {
        public long ContentWidthTwips => Math.Max(0, WidthTwips - LeftMarginTwips - RightMarginTwips);

        public static PageMetrics From(W.Body body)
        {
            var section = body.Elements<W.SectionProperties>().LastOrDefault() ??
                body.Descendants<W.SectionProperties>().LastOrDefault();
            var pageSize = section?.GetFirstChild<W.PageSize>();
            var margin = section?.GetFirstChild<W.PageMargin>();
            var columns = section?.GetFirstChild<W.Columns>();
            return new PageMetrics(
                pageSize?.Width?.Value ?? 12_240,
                pageSize?.Height?.Value ?? 15_840,
                margin?.Top?.Value ?? 1_440,
                margin?.Bottom?.Value ?? 1_440,
                (int)(margin?.Left?.Value ?? 1_440),
                (int)(margin?.Right?.Value ?? 1_440),
                (int)(margin?.Header?.Value ?? 720),
                (int)(margin?.Footer?.Value ?? 720),
                (int)(margin?.Gutter?.Value ?? 0),
                IntFromString(columns?.Space?.Value) ?? 720);
        }
    }
}
