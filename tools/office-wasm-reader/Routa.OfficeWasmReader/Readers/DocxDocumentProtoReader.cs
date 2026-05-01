using System.Globalization;
using System.Security.Cryptography;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace Routa.OfficeWasmReader;

internal static class DocxDocumentProtoReader
{
    private const int ElementTypeText = 1;
    private const int ElementTypeChartReference = 6;
    private const int ElementTypeImageReference = 7;
    private const int ElementTypeTable = 9;
    private const int ChartTypeArea = 2;
    private const int ChartTypeBar = 4;
    private const int ChartTypeBubble = 5;
    private const int ChartTypeDoughnut = 8;
    private const int ChartTypeLine = 13;
    private const int ChartTypePie = 16;
    private const int ChartTypeRadar = 17;
    private const int ChartTypeScatter = 18;
    private const int ChartTypeSurface = 22;
    private const int BarDirectionColumn = 1;
    private const int BarDirectionBar = 2;
    private const int ColorTypeRgb = 1;
    private const int AlignmentLeft = 1;
    private const int AlignmentCenter = 2;
    private const int AlignmentRight = 3;
    private const int SectionBreakContinuous = 1;
    private const int SectionBreakNextPage = 2;
    private const int SectionBreakEvenPage = 3;
    private const int SectionBreakOddPage = 4;
    private const int ReviewMarkTypeInsertion = 1;
    private const int ReviewMarkTypeDeletion = 2;
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
        var sectionProperties = LastSectionProperties(body);
        var context = new DocxReadContext(mainPart, page);
        var elements = ExtractBlockElements(body.ChildElements, context, mainPart)
            .Take(OpenXmlReaderLimits.MaxDocumentTextBlocks)
            .ToList();
        var footnotes = ExtractNotes(mainPart, context).ToList();
        var comments = ExtractComments(mainPart, context).ToList();
        var section = WriteSection(page, sectionProperties, context);
        var charts = context.Charts.Values.OrderBy(chart => chart.Uri.OriginalString, StringComparer.Ordinal).ToList();
        var images = context.Images.Values.OrderBy(image => image.Id, StringComparer.Ordinal).ToList();

        return Message(output =>
        {
            foreach (var chart in charts)
            {
                WriteMessage(output, 1, WriteChart(chart));
            }

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

            foreach (var footnote in footnotes)
            {
                WriteMessage(output, 8, footnote);
            }

            foreach (var comment in comments)
            {
                WriteMessage(output, 9, comment);
            }

            foreach (var commentReference in context.CommentReferenceRunIds.OrderBy(item => item.Key, StringComparer.Ordinal))
            {
                WriteMessage(output, 10, WriteCommentReference(commentReference.Key, commentReference.Value));
            }

            foreach (var style in ExtractTextStyles(mainPart))
            {
                WriteMessage(output, 11, style);
            }

            foreach (var reviewMark in context.ReviewMarks.Values.OrderBy(mark => mark.Id, StringComparer.Ordinal))
            {
                WriteMessage(output, 12, WriteReviewMark(reviewMark));
            }

            WriteMessage(output, 13, section);

            foreach (var numbering in ExtractNumberingDefinitions(mainPart))
            {
                WriteMessage(output, 14, numbering);
            }

            foreach (var paragraphNumbering in context.ParagraphNumberings)
            {
                WriteMessage(output, 15, WriteParagraphNumbering(paragraphNumbering));
            }
        });
    }

    private static IEnumerable<byte[]> ExtractBlockElements(
        IEnumerable<OpenXmlElement> childElements,
        DocxReadContext context,
        OpenXmlPartContainer partContainer)
    {
        foreach (var child in childElements)
        {
            if (child is W.Paragraph paragraph)
            {
                var paragraphProto = WriteParagraph(paragraph, context, partContainer);
                if (paragraphProto is not null)
                {
                    yield return WriteParagraphElement(paragraphProto);
                }

                foreach (var drawingElement in ExtractDrawingElements(paragraph, context, partContainer))
                {
                    yield return drawingElement;
                }
            }
            else if (child is W.Table table)
            {
                yield return WriteTableElement(table, context, partContainer);
            }
            else if (child is W.SdtBlock sdtBlock)
            {
                foreach (var element in ExtractBlockElements(sdtBlock.SdtContentBlock?.ChildElements ?? [], context, partContainer))
                {
                    yield return element;
                }
            }
        }
    }

    private static byte[]? WriteParagraph(
        W.Paragraph paragraph,
        DocxReadContext context,
        OpenXmlPartContainer partContainer)
    {
        var runs = ExtractRuns(paragraph.ChildElements, context, partContainer, null, null)
            .Where(run => run is not null)
            .Select(run => run!)
            .ToList();
        var hasDrawing = paragraph.Descendants<W.Drawing>().Any();
        if (runs.Count == 0 && !hasDrawing && !HasParagraphProperties(paragraph))
        {
            return null;
        }

        var id = $"paragraph-{context.NextParagraphIndex()}";
        var numbering = ParagraphNumberingFrom(paragraph, id);
        if (numbering is not null)
        {
            context.AddParagraphNumbering(numbering);
        }

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

    private static byte[]? WriteRun(
        W.Run run,
        DocxReadContext context,
        HyperlinkTarget? hyperlink,
        ReviewMarkData? reviewMark)
    {
        var text = RunText(run);
        var commentIds = run.Descendants<W.CommentReference>()
            .Select(reference => reference.Id?.Value)
            .Where(id => !string.IsNullOrEmpty(id))
            .Select(id => id!)
            .Concat(context.ActiveCommentIds)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var footnoteIds = run.Descendants<W.FootnoteReference>()
            .Select(reference => reference.Id?.Value)
            .Where(id => id is not null)
            .Select(id => FormatFootnoteId(id!.Value.ToString()))
            .ToList();
        var endnoteIds = run.Descendants<W.EndnoteReference>()
            .Select(reference => reference.Id?.Value)
            .Where(id => id is not null)
            .Select(id => FormatEndnoteId(id!.Value.ToString()))
            .ToList();
        var hasReferenceOnlyPayload = commentIds.Count > 0 || footnoteIds.Count > 0 || endnoteIds.Count > 0 || reviewMark is not null;
        if (text.Length == 0 && hyperlink is null && !hasReferenceOnlyPayload)
        {
            return null;
        }

        var id = $"run-{context.NextRunIndex():x8}";
        foreach (var commentId in commentIds)
        {
            context.AddCommentReference(commentId, id);
        }

        foreach (var footnoteId in footnoteIds.Concat(endnoteIds))
        {
            context.AddFootnoteReference(footnoteId, id);
        }

        var reviewMarkIds = new List<string>();
        if (reviewMark is not null)
        {
            reviewMarkIds.Add(context.AddReviewMark(reviewMark));
        }

        return Message(output =>
        {
            WriteString(output, 1, text);
            var textStyle = WriteRunTextStyle(run.RunProperties);
            if (textStyle is not null)
            {
                WriteMessage(output, 2, textStyle);
            }

            if (hyperlink is not null)
            {
                WriteMessage(output, 3, WriteHyperlink(hyperlink));
            }

            WriteString(output, 4, id);
            foreach (var reviewMarkId in reviewMarkIds)
            {
                WriteString(output, 6, reviewMarkId);
            }
        });
    }

    private static IEnumerable<byte[]> ExtractRuns(
        IEnumerable<OpenXmlElement> childElements,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        HyperlinkTarget? hyperlink,
        ReviewMarkData? reviewMark)
    {
        foreach (var child in childElements)
        {
            switch (child)
            {
                case W.Run run:
                {
                    var runProto = WriteRun(run, context, hyperlink, reviewMark);
                    if (runProto is not null)
                    {
                        yield return runProto;
                    }

                    break;
                }
                case W.Hyperlink hyperlinkElement:
                {
                    var resolvedHyperlink = ResolveHyperlink(hyperlinkElement, partContainer) ?? hyperlink;
                    foreach (var run in ExtractRuns(
                        hyperlinkElement.ChildElements,
                        context,
                        partContainer,
                        resolvedHyperlink,
                        reviewMark))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.SdtRun sdtRun:
                    foreach (var run in ExtractRuns(sdtRun.SdtContentRun?.ChildElements ?? [], context, partContainer, hyperlink, reviewMark))
                    {
                        yield return run;
                    }

                    break;
                case W.InsertedRun insertedRun:
                {
                    var insertedReviewMark = ReviewMarkFrom(insertedRun, ReviewMarkTypeInsertion) ?? reviewMark;
                    foreach (var run in ExtractRuns(insertedRun.ChildElements, context, partContainer, hyperlink, insertedReviewMark))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.DeletedRun deletedRun:
                {
                    var deletedReviewMark = ReviewMarkFrom(deletedRun, ReviewMarkTypeDeletion) ?? reviewMark;
                    foreach (var run in ExtractRuns(deletedRun.ChildElements, context, partContainer, hyperlink, deletedReviewMark))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.CommentRangeStart commentStart:
                    if (commentStart.Id?.Value is { } startId)
                    {
                        context.PushActiveComment(startId.ToString());
                    }

                    break;
                case W.CommentRangeEnd commentEnd:
                    if (commentEnd.Id?.Value is { } endId)
                    {
                        context.RemoveActiveComment(endId.ToString());
                    }

                    break;
                default:
                    if (child.HasChildren)
                    {
                        foreach (var run in ExtractRuns(child.ChildElements, context, partContainer, hyperlink, reviewMark))
                        {
                            yield return run;
                        }
                    }

                    break;
            }
        }
    }

    private static IEnumerable<byte[]> ExtractDrawingElements(
        W.Paragraph paragraph,
        DocxReadContext context,
        OpenXmlPartContainer partContainer)
    {
        foreach (var drawing in paragraph.Descendants<W.Drawing>())
        {
            var chartReference = drawing.Descendants<C.ChartReference>().FirstOrDefault();
            if (chartReference is not null)
            {
                var chartElement = WriteChartReferenceElement(drawing, context, partContainer);
                if (chartElement is not null)
                {
                    yield return chartElement;
                }

                continue;
            }

            var blip = drawing.Descendants<A.Blip>().FirstOrDefault();
            var relationshipId = blip?.Embed?.Value ?? blip?.Link?.Value;
            if (string.IsNullOrEmpty(relationshipId))
            {
                continue;
            }

            if (partContainer.GetPartById(relationshipId) is not ImagePart imagePart)
            {
                continue;
            }

            var image = context.AddImage(imagePart);
            var extent = drawing.Descendants<DW.Extent>().FirstOrDefault();
            var widthEmu = ToLong(extent?.Cx) ?? 0;
            var heightEmu = ToLong(extent?.Cy) ?? 0;
            var anchor = drawing.GetFirstChild<DW.Anchor>();
            var xEmu = ParseLong(anchor?.HorizontalPosition?.PositionOffset?.Text) ??
                context.Page.LeftMarginTwips * EmuPerTwip;
            var yEmu = ParseLong(anchor?.VerticalPosition?.PositionOffset?.Text) ?? 0;
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
                WriteMessage(output, 1, WriteBoundingBox(xEmu, yEmu, widthEmu, heightEmu));
                WriteMessage(output, 3, WriteImageReference(image.Id));
                WriteInt32(output, 11, ElementTypeImageReference);
                WriteString(output, 27, $"element-{image.Id["image-".Length..]}");
            });
        }
    }

    private static byte[]? WriteChartReferenceElement(
        W.Drawing drawing,
        DocxReadContext context,
        OpenXmlPartContainer partContainer)
    {
        var chartReference = drawing.Descendants<C.ChartReference>().FirstOrDefault();
        var relationshipId = chartReference?.Id?.Value;
        if (string.IsNullOrEmpty(relationshipId))
        {
            return null;
        }

        if (partContainer.GetPartById(relationshipId) is not ChartPart chartPart)
        {
            return null;
        }

        context.AddChart(chartPart);
        var extent = drawing.Descendants<DW.Extent>().FirstOrDefault();
        var anchor = drawing.GetFirstChild<DW.Anchor>();
        var xEmu = ParseLong(anchor?.HorizontalPosition?.PositionOffset?.Text) ??
            context.Page.LeftMarginTwips * EmuPerTwip;
        var yEmu = ParseLong(anchor?.VerticalPosition?.PositionOffset?.Text) ?? 0;

        return Message(output =>
        {
            WriteMessage(output, 1, WriteBoundingBox(
                xEmu,
                yEmu,
                ToLong(extent?.Cx) ?? 0,
                ToLong(extent?.Cy) ?? 0));
            WriteMessage(output, 18, WriteChartReference(chartPart.Uri.OriginalString));
            WriteInt32(output, 11, ElementTypeChartReference);
            WriteString(output, 27, $"element-chart-{context.NextChartElementIndex():x8}");
        });
    }

    private static byte[] WriteParagraphElement(byte[] paragraph)
    {
        return Message(output =>
        {
            WriteMessage(output, 6, paragraph);
            WriteInt32(output, 11, ElementTypeText);
        });
    }

    private static byte[] WriteTableElement(W.Table table, DocxReadContext context, OpenXmlPartContainer partContainer)
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
            WriteMessage(output, 21, WriteTable(table, context, partContainer));
        });
    }

    private static byte[] WriteTable(W.Table table, DocxReadContext context, OpenXmlPartContainer partContainer)
    {
        return Message(output =>
        {
            foreach (var row in table.Elements<W.TableRow>().Take(OpenXmlReaderLimits.MaxRowsPerTable))
            {
                WriteMessage(output, 1, WriteTableRow(row, context, partContainer));
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

    private static byte[] WriteTableRow(W.TableRow row, DocxReadContext context, OpenXmlPartContainer partContainer)
    {
        return Message(output =>
        {
            foreach (var cell in row.Elements<W.TableCell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
            {
                WriteMessage(output, 1, WriteTableCell(cell, context, partContainer));
            }

            WriteString(output, 3, $"table-row-{context.NextTableRowIndex():x8}");
        });
    }

    private static byte[] WriteTableCell(W.TableCell cell, DocxReadContext context, OpenXmlPartContainer partContainer)
    {
        return Message(output =>
        {
            var text = string.Join("\n", cell.Elements<W.Paragraph>().Select(ParagraphText));
            WriteString(output, 1, text);

            foreach (var paragraph in cell.Elements<W.Paragraph>())
            {
                var paragraphProto = WriteParagraph(paragraph, context, partContainer);
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

    private static IEnumerable<byte[]> ExtractNotes(MainDocumentPart mainPart, DocxReadContext context)
    {
        var footnotesPart = mainPart.FootnotesPart;
        if (footnotesPart?.Footnotes is not null)
        {
            foreach (var footnote in footnotesPart.Footnotes.Elements<W.Footnote>())
            {
                var note = WriteFootnote(footnote, context, footnotesPart, FormatFootnoteId);
                if (note is not null)
                {
                    yield return note;
                }
            }
        }

        var endnotesPart = mainPart.EndnotesPart;
        if (endnotesPart?.Endnotes is not null)
        {
            foreach (var endnote in endnotesPart.Endnotes.Elements<W.Endnote>())
            {
                var note = WriteEndnote(endnote, context, endnotesPart);
                if (note is not null)
                {
                    yield return note;
                }
            }
        }
    }

    private static byte[]? WriteFootnote(
        W.Footnote footnote,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        Func<string, string> formatId)
    {
        if (footnote.Type?.Value is not null && footnote.Type.Value.ToString() != "normal")
        {
            return null;
        }

        var rawId = footnote.Id?.Value.ToString();
        if (string.IsNullOrEmpty(rawId))
        {
            return null;
        }

        var id = formatId(rawId);
        var paragraphs = footnote.Elements<W.Paragraph>()
            .Select(paragraph => WriteParagraph(paragraph, context, partContainer))
            .Where(paragraph => paragraph is not null)
            .Select(paragraph => paragraph!)
            .ToList();
        if (paragraphs.Count == 0)
        {
            return null;
        }

        return WriteNote(id, paragraphs, context.FootnoteReferenceRunIds.GetValueOrDefault(id) ?? []);
    }

    private static byte[]? WriteEndnote(W.Endnote endnote, DocxReadContext context, OpenXmlPartContainer partContainer)
    {
        if (endnote.Type?.Value is not null && endnote.Type.Value.ToString() != "normal")
        {
            return null;
        }

        var rawId = endnote.Id?.Value.ToString();
        if (string.IsNullOrEmpty(rawId))
        {
            return null;
        }

        var id = FormatEndnoteId(rawId);
        var paragraphs = endnote.Elements<W.Paragraph>()
            .Select(paragraph => WriteParagraph(paragraph, context, partContainer))
            .Where(paragraph => paragraph is not null)
            .Select(paragraph => paragraph!)
            .ToList();
        if (paragraphs.Count == 0)
        {
            return null;
        }

        return WriteNote(id, paragraphs, context.FootnoteReferenceRunIds.GetValueOrDefault(id) ?? []);
    }

    private static byte[] WriteNote(string id, IReadOnlyList<byte[]> paragraphs, IEnumerable<string> referenceRunIds)
    {
        return Message(output =>
        {
            WriteString(output, 1, id);
            foreach (var paragraph in paragraphs)
            {
                WriteMessage(output, 2, paragraph);
            }

            foreach (var runId in referenceRunIds)
            {
                WriteString(output, 3, runId);
            }
        });
    }

    private static IEnumerable<byte[]> ExtractComments(MainDocumentPart mainPart, DocxReadContext context)
    {
        var commentsPart = mainPart.WordprocessingCommentsPart;
        if (commentsPart?.Comments is null)
        {
            yield break;
        }

        foreach (var comment in commentsPart.Comments.Elements<W.Comment>())
        {
            var id = comment.Id?.Value?.ToString();
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            var paragraphs = comment.Elements<W.Paragraph>()
                .Select(paragraph => WriteParagraph(paragraph, context, commentsPart))
                .Where(paragraph => paragraph is not null)
                .Select(paragraph => paragraph!)
                .ToList();

            yield return Message(output =>
            {
                WriteString(output, 1, id);
                WriteString(output, 2, comment.Author?.Value);
                WriteString(output, 3, comment.Initials?.Value);
                WriteString(output, 4, ToIsoString(comment.Date));
                foreach (var paragraph in paragraphs)
                {
                    WriteMessage(output, 5, paragraph);
                }
            });
        }
    }

    private static byte[] WriteCommentReference(string commentId, IReadOnlyCollection<string> runIds)
    {
        return Message(output =>
        {
            WriteString(output, 1, commentId);
            foreach (var runId in runIds.OrderBy(id => id, StringComparer.Ordinal))
            {
                WriteString(output, 2, runId);
            }
        });
    }

    private static byte[] WriteReviewMark(ReviewMarkData reviewMark)
    {
        return Message(output =>
        {
            WriteString(output, 1, reviewMark.Id);
            WriteInt32(output, 2, reviewMark.Type);
            WriteString(output, 3, reviewMark.Author);
            WriteString(output, 4, reviewMark.Initials);
            WriteString(output, 5, reviewMark.CreatedAt);
        });
    }

    private static byte[] WriteParagraphNumbering(ParagraphNumberingData paragraphNumbering)
    {
        return Message(output =>
        {
            WriteString(output, 1, paragraphNumbering.ParagraphId);
            WriteString(output, 2, paragraphNumbering.NumId);
            WriteInt32(output, 3, paragraphNumbering.Level);
        });
    }

    private static byte[] WriteSection(PageMetrics page, W.SectionProperties? sectionProperties, DocxReadContext context)
    {
        return Message(output =>
        {
            WriteString(output, 1, "section-1");
            WriteInt32(output, 2, SectionBreakType(sectionProperties));
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
                var columns = sectionProperties?.GetFirstChild<W.Columns>();
                var explicitColumns = columns?.Elements<W.Column>().ToList() ?? [];
                WriteInt32(columnsOutput, 1, (int?)columns?.ColumnCount?.Value ?? Math.Max(1, explicitColumns.Count));
                WriteInt32(columnsOutput, 2, page.ColumnSpaceTwips);
                foreach (var column in explicitColumns)
                {
                    WriteInt32Always(columnsOutput, 3, IntFromString(column.Width?.Value) ?? 0);
                }

                WriteBool(columnsOutput, 4, columns?.Separator?.Value ?? false);
            }));

            var header = WriteHeaderFooterContent(sectionProperties, context, header: true);
            if (header is not null)
            {
                WriteMessage(output, 6, header);
            }

            var footer = WriteHeaderFooterContent(sectionProperties, context, header: false);
            if (footer is not null)
            {
                WriteMessage(output, 7, footer);
            }
        });
    }

    private static byte[]? WriteHeaderFooterContent(W.SectionProperties? sectionProperties, DocxReadContext context, bool header)
    {
        var relationshipId = header
            ? ResolveHeaderFooterRelationshipId(sectionProperties?.Elements<W.HeaderReference>())
            : ResolveHeaderFooterRelationshipId(sectionProperties?.Elements<W.FooterReference>());
        if (string.IsNullOrEmpty(relationshipId))
        {
            return null;
        }

        var part = context.MainPart.GetPartById(relationshipId);
        var childElements = part switch
        {
            HeaderPart headerPart => headerPart.Header?.ChildElements,
            FooterPart footerPart => footerPart.Footer?.ChildElements,
            _ => null,
        };
        if (childElements is null)
        {
            return null;
        }

        var elements = ExtractBlockElements(childElements, context, part).ToList();
        if (elements.Count == 0)
        {
            return null;
        }

        return Message(output =>
        {
            foreach (var element in elements)
            {
                WriteMessage(output, 1, element);
            }
        });
    }

    private static string ResolveHeaderFooterRelationshipId<T>(IEnumerable<T>? references)
        where T : OpenXmlElement
    {
        var items = references?.ToList() ?? [];
        var selected =
            items.FirstOrDefault(item => HeaderFooterType(item) == "default") ??
            items.FirstOrDefault();
        return HeaderFooterRelationshipId(selected);
    }

    private static string HeaderFooterType(OpenXmlElement reference)
    {
        return reference switch
        {
            W.HeaderReference headerReference => headerReference.Type?.Value.ToString() ?? "",
            W.FooterReference footerReference => footerReference.Type?.Value.ToString() ?? "",
            _ => "",
        };
    }

    private static string HeaderFooterRelationshipId(OpenXmlElement? reference)
    {
        return reference switch
        {
            W.HeaderReference headerReference => headerReference.Id?.Value ?? "",
            W.FooterReference footerReference => footerReference.Id?.Value ?? "",
            _ => "",
        };
    }

    private static W.SectionProperties? LastSectionProperties(W.Body body)
    {
        return body.Elements<W.SectionProperties>().LastOrDefault() ??
            body.Descendants<W.SectionProperties>().LastOrDefault();
    }

    private static int SectionBreakType(W.SectionProperties? sectionProperties)
    {
        return sectionProperties?.GetFirstChild<W.SectionType>()?.Val?.Value.ToString() switch
        {
            "continuous" => SectionBreakContinuous,
            "evenPage" => SectionBreakEvenPage,
            "oddPage" => SectionBreakOddPage,
            _ => SectionBreakNextPage,
        };
    }

    private static ParagraphNumberingData? ParagraphNumberingFrom(W.Paragraph paragraph, string paragraphId)
    {
        var numbering = paragraph.ParagraphProperties?.NumberingProperties;
        var numId = numbering?.NumberingId?.Val?.Value.ToString();
        if (string.IsNullOrEmpty(numId))
        {
            return null;
        }

        return new ParagraphNumberingData(
            paragraphId,
            numId,
            numbering?.NumberingLevelReference?.Val?.Value ?? 0);
    }

    private static HyperlinkTarget? ResolveHyperlink(W.Hyperlink hyperlink, OpenXmlPartContainer partContainer)
    {
        var relationshipId = hyperlink.Id?.Value;
        if (!string.IsNullOrEmpty(relationshipId))
        {
            var relationship = partContainer.HyperlinkRelationships
                .FirstOrDefault(item => item.Id == relationshipId);
            if (relationship is not null)
            {
                return new HyperlinkTarget(relationship.Uri.ToString(), relationship.IsExternal, "");
            }
        }

        var anchor = hyperlink.Anchor?.Value;
        return string.IsNullOrEmpty(anchor) ? null : new HyperlinkTarget($"#{anchor}", false, "");
    }

    private static byte[] WriteHyperlink(HyperlinkTarget hyperlink)
    {
        return Message(output =>
        {
            WriteString(output, 1, hyperlink.Uri);
            WriteBool(output, 2, hyperlink.IsExternal);
            WriteString(output, 3, hyperlink.Action);
        });
    }

    private static ReviewMarkData? ReviewMarkFrom(W.InsertedRun insertedRun, int type)
    {
        return ReviewMarkFrom(
            insertedRun.Id?.Value,
            type,
            insertedRun.Author?.Value,
            "",
            ToIsoString(insertedRun.Date));
    }

    private static ReviewMarkData? ReviewMarkFrom(W.DeletedRun deletedRun, int type)
    {
        return ReviewMarkFrom(
            deletedRun.Id?.Value,
            type,
            deletedRun.Author?.Value,
            "",
            ToIsoString(deletedRun.Date));
    }

    private static ReviewMarkData? ReviewMarkFrom(string? rawId, int type, string? author, string? initials, string? createdAt)
    {
        if (string.IsNullOrEmpty(rawId))
        {
            return null;
        }

        return new ReviewMarkData($"review-{rawId}", type, author ?? "", initials ?? "", createdAt ?? "");
    }

    private static string FormatFootnoteId(string id)
    {
        return id;
    }

    private static string FormatEndnoteId(string id)
    {
        return $"endnote-{id}";
    }

    private static string ToIsoString(DateTimeValue? value)
    {
        return value?.Value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture) ?? "";
    }

    private static byte[] WriteChartReference(string chartId)
    {
        return Message(output =>
        {
            WriteString(output, 1, chartId);
        });
    }

    private static byte[] WriteChart(ChartPart chartPart)
    {
        var chartSpace = chartPart.ChartSpace;
        var series = chartSpace is null ? [] : ExtractChartSeries(chartSpace).ToList();
        var categories = series.SelectMany(item => item.Categories)
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        return Message(output =>
        {
            WriteString(output, 1, ChartTitle(chartSpace));
            foreach (var category in categories)
            {
                WriteString(output, 2, category);
            }

            foreach (var item in series)
            {
                WriteMessage(output, 3, WriteChartSeries(item));
            }

            WriteInt32(output, 5, ChartType(chartSpace));
            WriteString(output, 7, chartPart.Uri.OriginalString);
            WriteInt32(output, 10, BarDirection(chartSpace));
            WriteBool(output, 11, chartSpace?.Descendants<C.Legend>().Any() ?? false);
        });
    }

    private static byte[] WriteChartSeries(ChartSeriesData series)
    {
        return Message(output =>
        {
            WriteString(output, 1, series.Name);
            foreach (var value in series.Values)
            {
                WriteDouble(output, 2, value);
            }

            foreach (var category in series.Categories)
            {
                WriteString(output, 5, category);
            }

            WriteString(output, 8, series.Id);
        });
    }

    private static IEnumerable<ChartSeriesData> ExtractChartSeries(C.ChartSpace chartSpace)
    {
        var index = 0;
        foreach (var series in ChartSeriesElements(chartSpace))
        {
            var name = TextNormalization.Clean(series.Elements<C.SeriesText>().FirstOrDefault()?.InnerText);
            var categories = ExtractChartCategories(series).ToList();
            var values = ExtractChartValues(series).ToList();
            yield return new ChartSeriesData(
                $"series-{index:x8}",
                name.Length > 0 ? name : $"Series {index + 1}",
                categories,
                values,
                series);
            index++;
        }
    }

    private static IEnumerable<OpenXmlElement> ChartSeriesElements(C.ChartSpace chartSpace)
    {
        return chartSpace.Descendants<C.BarChartSeries>().Cast<OpenXmlElement>()
            .Concat(chartSpace.Descendants<C.LineChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.PieChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.AreaChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.ScatterChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.BubbleChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.RadarChartSeries>().Cast<OpenXmlElement>())
            .Concat(chartSpace.Descendants<C.SurfaceChartSeries>().Cast<OpenXmlElement>());
    }

    private static IEnumerable<string> ExtractChartCategories(OpenXmlElement series)
    {
        var categoryContainers = series.Elements<C.CategoryAxisData>().Cast<OpenXmlElement>()
            .Concat(series.Elements<C.XValues>());
        return categoryContainers
            .SelectMany(container => container.Descendants<C.NumericValue>())
            .Select(value => TextNormalization.Clean(value.Text))
            .Where(value => value.Length > 0);
    }

    private static IEnumerable<double> ExtractChartValues(OpenXmlElement series)
    {
        var valueContainers = series.Elements<C.Values>().Cast<OpenXmlElement>()
            .Concat(series.Elements<C.YValues>())
            .Concat(series.Elements<C.BubbleSize>());
        return valueContainers
            .SelectMany(container => container.Descendants<C.NumericValue>())
            .Select(value => ParseDouble(value.Text))
            .Where(double.IsFinite);
    }

    private static string ChartTitle(C.ChartSpace? chartSpace)
    {
        if (chartSpace is null)
        {
            return "";
        }

        return TextNormalization.Clean(string.Concat(
            chartSpace.Descendants<C.Title>().FirstOrDefault()?.Descendants<A.Text>().Select(item => item.Text) ??
            Enumerable.Empty<string>()));
    }

    private static int ChartType(C.ChartSpace? chartSpace)
    {
        if (chartSpace is null)
        {
            return 0;
        }

        if (chartSpace.Descendants<C.AreaChart>().Any()) return ChartTypeArea;
        if (chartSpace.Descendants<C.BarChart>().Any()) return ChartTypeBar;
        if (chartSpace.Descendants<C.BubbleChart>().Any()) return ChartTypeBubble;
        if (chartSpace.Descendants<C.DoughnutChart>().Any()) return ChartTypeDoughnut;
        if (chartSpace.Descendants<C.LineChart>().Any()) return ChartTypeLine;
        if (chartSpace.Descendants<C.PieChart>().Any()) return ChartTypePie;
        if (chartSpace.Descendants<C.RadarChart>().Any()) return ChartTypeRadar;
        if (chartSpace.Descendants<C.ScatterChart>().Any()) return ChartTypeScatter;
        if (chartSpace.Descendants<C.SurfaceChart>().Any()) return ChartTypeSurface;
        return 0;
    }

    private static int BarDirection(C.ChartSpace? chartSpace)
    {
        var direction = chartSpace?.Descendants<C.BarDirection>().FirstOrDefault()?.Val?.Value.ToString();
        return string.Equals(direction, "bar", StringComparison.OrdinalIgnoreCase) ? BarDirectionBar :
            string.Equals(direction, "column", StringComparison.OrdinalIgnoreCase) ? BarDirectionColumn :
            0;
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
        return string.Concat(paragraph.Descendants<W.Run>().Select(RunText));
    }

    private static string RunText(W.Run run)
    {
        return string.Concat(run.ChildElements.Select(child => child switch
        {
            W.Text text => text.Text,
            W.DeletedText deletedText => deletedText.Text,
            W.TabChar _ => "\t",
            W.Break _ => "\n",
            W.CarriageReturn _ => "\n",
            W.NoBreakHyphen _ => "-",
            W.SoftHyphen _ => "\u00ad",
            W.SymbolChar symbol => SymbolText(symbol),
            _ => "",
        }));
    }

    private static string SymbolText(W.SymbolChar symbol)
    {
        var value = symbol.Char?.Value;
        if (string.IsNullOrEmpty(value) || !int.TryParse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var codePoint))
        {
            return "";
        }

        return char.ConvertFromUtf32(codePoint);
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

    private static long? ParseLong(string? value)
    {
        return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static double ParseDouble(string? value)
    {
        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : double.NaN;
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

    private static void WriteDouble(CodedOutputStream output, int fieldNumber, double value)
    {
        if (value == 0 || !double.IsFinite(value))
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Fixed64);
        output.WriteDouble(value);
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
        private int _chartElementIndex = 1;
        private readonly List<string> _activeCommentIds = [];

        public MainDocumentPart MainPart { get; } = mainPart;
        public PageMetrics Page { get; } = page;
        public Dictionary<string, DocumentImage> Images { get; } = [];
        public Dictionary<string, ChartPart> Charts { get; } = [];
        public Dictionary<string, SortedSet<string>> CommentReferenceRunIds { get; } = [];
        public Dictionary<string, SortedSet<string>> FootnoteReferenceRunIds { get; } = [];
        public Dictionary<string, ReviewMarkData> ReviewMarks { get; } = [];
        public List<ParagraphNumberingData> ParagraphNumberings { get; } = [];
        public IEnumerable<string> ActiveCommentIds => _activeCommentIds;

        public int NextParagraphIndex() => _paragraphIndex++;

        public int NextRunIndex() => _runIndex++;

        public int NextTableRowIndex() => _tableRowIndex++;

        public int NextTableCellIndex() => _tableCellIndex++;

        public int NextChartElementIndex() => _chartElementIndex++;

        public void PushActiveComment(string commentId)
        {
            if (!_activeCommentIds.Contains(commentId, StringComparer.Ordinal))
            {
                _activeCommentIds.Add(commentId);
            }
        }

        public void RemoveActiveComment(string commentId)
        {
            _activeCommentIds.Remove(commentId);
        }

        public void AddCommentReference(string commentId, string runId)
        {
            AddReference(CommentReferenceRunIds, commentId, runId);
        }

        public void AddFootnoteReference(string footnoteId, string runId)
        {
            AddReference(FootnoteReferenceRunIds, footnoteId, runId);
        }

        public string AddReviewMark(ReviewMarkData reviewMark)
        {
            ReviewMarks.TryAdd(reviewMark.Id, reviewMark);
            return reviewMark.Id;
        }

        public void AddParagraphNumbering(ParagraphNumberingData numbering)
        {
            ParagraphNumberings.Add(numbering);
        }

        public void AddChart(ChartPart chartPart)
        {
            Charts.TryAdd(chartPart.Uri.OriginalString, chartPart);
        }

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

        private static void AddReference(Dictionary<string, SortedSet<string>> references, string id, string runId)
        {
            if (!references.TryGetValue(id, out var runIds))
            {
                runIds = new SortedSet<string>(StringComparer.Ordinal);
                references[id] = runIds;
            }

            runIds.Add(runId);
        }
    }

    private sealed record DocumentImage(string Id, string ContentType, byte[] Bytes);

    private sealed record HyperlinkTarget(string Uri, bool IsExternal, string Action);

    private sealed record ReviewMarkData(string Id, int Type, string Author, string Initials, string CreatedAt);

    private sealed record ParagraphNumberingData(string ParagraphId, string NumId, int Level);

    private sealed record ChartSeriesData(
        string Id,
        string Name,
        IReadOnlyList<string> Categories,
        IReadOnlyList<double> Values,
        OpenXmlElement Element);

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
