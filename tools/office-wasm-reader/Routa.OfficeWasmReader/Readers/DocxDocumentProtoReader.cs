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
    private const int LineStyleSolid = 1;
    private const int LineStyleDashed = 2;
    private const int LineStyleDotted = 3;
    private const int LineStyleDashDot = 4;
    private const int LineStyleDashDotDot = 5;
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
    private const string WordprocessingNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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
        RegisterPackageImages(mainPart, context, new HashSet<Uri>());
        var elements = ExtractBlockElements(body.ChildElements, context, mainPart)
            .Take(OpenXmlReaderLimits.MaxDocumentTextBlocks)
            .ToList();
        context.ClearActiveComments();
        var footnotes = ExtractNotes(mainPart, context).ToList();
        context.ClearActiveComments();
        var comments = ExtractComments(mainPart, context).ToList();
        context.ClearActiveComments();
        var sections = ExtractSections(body, context).ToList();
        var charts = context.Charts.Values.OrderBy(chart => chart.Uri.OriginalString, StringComparer.Ordinal).ToList();
        var images = context.Images.Values
            .OrderBy(image => image.Order)
            .ThenBy(image => image.Id, StringComparer.Ordinal)
            .ToList();

        return Message(output =>
        {
            foreach (var chart in charts)
            {
                WriteMessage(output, 1, WriteChart(chart));
            }

            WriteInt64(output, 3, page.ExplicitWidthTwips);
            WriteInt64(output, 4, page.ExplicitHeightTwips);

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

            foreach (var commentReference in context.CommentReferenceRunIds)
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

            foreach (var section in sections)
            {
                WriteMessage(output, 13, section);
            }

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
        var children = childElements.ToList();
        foreach (var child in children)
        {
            if (child is W.Paragraph paragraph)
            {
                var paragraphProto = WriteParagraph(paragraph, context, partContainer, preserveEmptyParagraph: true);
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
                if (IsTableOfContentsSdt(sdtBlock))
                {
                    continue;
                }

                foreach (var element in ExtractBlockElements(sdtBlock.SdtContentBlock?.ChildElements ?? [], context, partContainer))
                {
                    yield return element;
                }
            }
        }
    }

    private static bool IsTableOfContentsSdt(W.SdtBlock sdtBlock)
    {
        var gallery = sdtBlock.SdtProperties?.Descendants<W.DocPartGallery>().FirstOrDefault();
        return string.Equals(gallery?.Val?.Value, "Table of Contents", StringComparison.OrdinalIgnoreCase);
    }

    private static byte[]? WriteParagraph(
        W.Paragraph paragraph,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        bool preserveEmptyParagraph = false)
    {
        var runs = ExtractRuns(paragraph.ChildElements, context, partContainer, null, null)
            .Where(run => run is not null)
            .Select(run => run!)
            .ToList();
        var hasDrawing = paragraph.Descendants<W.Drawing>().Any();
        var hasPlaceholderContent = HasParagraphPlaceholderContent(paragraph);
        var hasParagraphProperties = HasParagraphProperties(paragraph);
        if (runs.Count == 0 && !hasDrawing && !hasPlaceholderContent && !hasParagraphProperties && !preserveEmptyParagraph)
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
            var spacing = context.ResolveParagraphSpacing(paragraph.ParagraphProperties);
            foreach (var run in runs)
            {
                WriteMessage(output, 1, run);
            }

            var paragraphStyle = WriteParagraphTextStyle(paragraph.ParagraphProperties);
            if (paragraphStyle is not null)
            {
                WriteMessage(output, 2, paragraphStyle);
            }

            WriteInt32IfPresent(output, 6, spacing.After);
            WriteInt32IfPresent(output, 7, spacing.Before);
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
        var commentIds = context.ActiveCommentIds
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var footnoteIds = run.Descendants<W.FootnoteReference>()
            .Select(reference => reference.Id?.Value)
            .Where(id => id is not null)
            .Select(id => FormatFootnoteId(id!.Value.ToString()))
            .ToList();
        var hasRunReferencePayload = footnoteIds.Count > 0;
        if (text.Length == 0 && !hasRunReferencePayload)
        {
            if (reviewMark is not null)
            {
                context.AddReviewMark(reviewMark);
            }

            return null;
        }

        var id = $"run-{context.NextRunIndex():x8}";
        foreach (var commentId in commentIds)
        {
            context.AddCommentReference(commentId, id);
        }

        foreach (var footnoteId in footnoteIds)
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
        ReviewMarkData? reviewMark,
        bool honorCommentRangeMarkers = true)
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
                        reviewMark,
                        honorCommentRangeMarkers))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.SdtRun:
                    break;
                case W.InsertedRun insertedRun:
                {
                    var insertedReviewMark = ReviewMarkFrom(insertedRun, ReviewMarkTypeInsertion) ?? reviewMark;
                    foreach (var run in ExtractRuns(
                        insertedRun.ChildElements,
                        context,
                        partContainer,
                        hyperlink,
                        insertedReviewMark,
                        honorCommentRangeMarkers: false))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.DeletedRun deletedRun:
                {
                    var deletedReviewMark = ReviewMarkFrom(deletedRun, ReviewMarkTypeDeletion) ?? reviewMark;
                    foreach (var run in ExtractRuns(
                        deletedRun.ChildElements,
                        context,
                        partContainer,
                        hyperlink,
                        deletedReviewMark,
                        honorCommentRangeMarkers: false))
                    {
                        yield return run;
                    }

                    break;
                }
                case W.CommentRangeStart commentStart:
                    if (honorCommentRangeMarkers && commentStart.Id?.Value is { } startId)
                    {
                        context.PushActiveComment(startId.ToString());
                    }

                    break;
                case W.CommentRangeEnd commentEnd:
                    if (honorCommentRangeMarkers && commentEnd.Id?.Value is { } endId)
                    {
                        context.RemoveActiveComment(endId.ToString());
                    }

                    break;
                default:
                    if (child.HasChildren)
                    {
                        foreach (var run in ExtractRuns(
                            child.ChildElements,
                            context,
                            partContainer,
                            hyperlink,
                            reviewMark,
                            honorCommentRangeMarkers))
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
                var chartElement = WriteChartReferenceElement(drawing, context, partContainer, paragraph);
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

            var image = context.AddImage(imagePart, partContainer, relationshipId);
            var extent = drawing.Descendants<DW.Extent>().FirstOrDefault();
            var widthEmu = ToLong(extent?.Cx) ?? 0;
            var heightEmu = ToLong(extent?.Cy) ?? 0;
            var (xEmu, yEmu) = DrawingPosition(
                drawing,
                context.Page,
                paragraph.ParagraphProperties?.Justification?.Val?.ToString(),
                widthEmu,
                heightEmu);

            yield return Message(output =>
            {
                WriteMessage(output, 1, WriteBoundingBox(xEmu, yEmu, widthEmu, heightEmu));
                WriteMessage(output, 3, WriteImageReference(image.Id));
                WriteInt32(output, 11, ElementTypeImageReference);
                WriteString(output, 27, $"element-{image.Id["image-".Length..]}");
            });
        }
    }

    private static void RegisterPackageImages(
        OpenXmlPartContainer partContainer,
        DocxReadContext context,
        ISet<Uri> visitedParts)
    {
        foreach (var relatedPart in partContainer.Parts)
        {
            if (relatedPart.OpenXmlPart is ImagePart imagePart)
            {
                context.AddImage(imagePart, partContainer, relatedPart.RelationshipId);
                continue;
            }

            if (!visitedParts.Add(relatedPart.OpenXmlPart.Uri))
            {
                continue;
            }

            RegisterPackageImages(relatedPart.OpenXmlPart, context, visitedParts);
        }
    }

    private static byte[]? WriteChartReferenceElement(
        W.Drawing drawing,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        W.Paragraph paragraph)
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
        var widthEmu = ToLong(extent?.Cx) ?? 0;
        var heightEmu = ToLong(extent?.Cy) ?? 0;
        var (xEmu, yEmu) = DrawingPosition(
            drawing,
            context.Page,
            paragraph.ParagraphProperties?.Justification?.Val?.ToString(),
            widthEmu,
            heightEmu);

        return Message(output =>
        {
            WriteMessage(output, 1, WriteBoundingBox(
                xEmu,
                yEmu,
                widthEmu,
                heightEmu));
            WriteMessage(output, 18, WriteChartReference(chartPart.Uri.OriginalString));
            WriteInt32(output, 11, ElementTypeChartReference);
            WriteString(output, 27, $"element-chart-{context.NextChartElementIndex():x8}");
        });
    }

    private static (long XEmu, long YEmu) DrawingPosition(
        W.Drawing drawing,
        PageMetrics page,
        string? paragraphAlignment,
        long widthEmu,
        long heightEmu)
    {
        var anchor = drawing.GetFirstChild<DW.Anchor>();
        var xEmu = AnchorHorizontalPosition(anchor?.HorizontalPosition, page, widthEmu);
        var yEmu = AnchorVerticalPosition(anchor?.VerticalPosition, page, heightEmu);
        xEmu ??= page.LeftMarginTwips * EmuPerTwip;
        yEmu ??= 0;

        if (anchor is null)
        {
            var contentWidthEmu = page.ContentWidthTwips * EmuPerTwip;
            if (paragraphAlignment == "center")
            {
                xEmu += Math.Max(0, contentWidthEmu - widthEmu) / 2;
            }
            else if (paragraphAlignment == "right")
            {
                xEmu += Math.Max(0, contentWidthEmu - widthEmu);
            }
        }

        return (xEmu.Value, yEmu.Value);
    }

    private static long? AnchorHorizontalPosition(DW.HorizontalPosition? position, PageMetrics page, long widthEmu)
    {
        var (originEmu, availableEmu) = HorizontalAnchorFrame(AnchorRelativeFrom(position), page);
        if (AnchorPositionOffset(position?.PositionOffset) is { } offset)
        {
            return originEmu + offset;
        }

        return AnchorAlignedPosition(position?.HorizontalAlignment?.Text, originEmu, availableEmu, widthEmu);
    }

    private static long? AnchorVerticalPosition(DW.VerticalPosition? position, PageMetrics page, long heightEmu)
    {
        var relativeFrom = AnchorRelativeFrom(position);
        var (originEmu, availableEmu) = VerticalAnchorFrame(relativeFrom, page);
        if (AnchorPositionOffset(position?.PositionOffset) is { } offset)
        {
            if (string.Equals(relativeFrom, "page", StringComparison.OrdinalIgnoreCase))
            {
                return originEmu;
            }

            return originEmu + offset;
        }

        return AnchorAlignedPosition(position?.VerticalAlignment?.Text, originEmu, availableEmu, heightEmu);
    }

    private static long? AnchorPositionOffset(OpenXmlLeafTextElement? offset)
    {
        return ParseLong(offset?.InnerText) ?? ParseLong(offset?.Text);
    }

    private static string? AnchorRelativeFrom(OpenXmlElement? position)
    {
        return position?
            .GetAttributes()
            .FirstOrDefault(attribute => string.Equals(attribute.LocalName, "relativeFrom", StringComparison.OrdinalIgnoreCase))
            .Value;
    }

    private static long? AnchorAlignedPosition(string? alignment, long originEmu, long availableEmu, long extentEmu)
    {
        return alignment?.ToLowerInvariant() switch
        {
            "center" => originEmu + Math.Max(0, availableEmu - extentEmu) / 2,
            "right" or "bottom" => originEmu + Math.Max(0, availableEmu - extentEmu),
            "left" or "top" or "inside" or "outside" => originEmu,
            _ => null,
        };
    }

    private static (long OriginEmu, long AvailableEmu) HorizontalAnchorFrame(string? relativeFrom, PageMetrics page)
    {
        return relativeFrom?.ToLowerInvariant() switch
        {
            "page" => (0, page.WidthTwips * EmuPerTwip),
            "margin" or "column" => (page.LeftMarginTwips * EmuPerTwip, page.ContentWidthTwips * EmuPerTwip),
            _ => (page.LeftMarginTwips * EmuPerTwip, page.ContentWidthTwips * EmuPerTwip),
        };
    }

    private static (long OriginEmu, long AvailableEmu) VerticalAnchorFrame(string? relativeFrom, PageMetrics page)
    {
        return relativeFrom?.ToLowerInvariant() switch
        {
            "page" => (0, page.HeightTwips * EmuPerTwip),
            "margin" => (0, page.ContentHeightTwips * EmuPerTwip),
            _ => (0, page.ContentHeightTwips * EmuPerTwip),
        };
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
        var tableWidthTwips = TableWidthTwips(table, context.Page) ?? context.Page.ContentWidthTwips;
        var tableXEmu = TableXEmu(table, context.Page, tableWidthTwips);
        return Message(output =>
        {
            WriteMessage(
                output,
                1,
                WriteBoundingBox(
                    tableXEmu,
                    0,
                    tableWidthTwips * EmuPerTwip,
                    0));
            WriteInt32(output, 11, ElementTypeTable);
            WriteMessage(output, 21, WriteTable(table, context, partContainer));
        });
    }

    private static byte[] WriteTable(W.Table table, DocxReadContext context, OpenXmlPartContainer partContainer)
    {
        var rows = table.Elements<W.TableRow>().Take(OpenXmlReaderLimits.MaxRowsPerTable).ToList();
        var isSingleCellTable = rows.Count == 1 &&
            rows[0].Elements<W.TableCell>().Take(2).Count() == 1;
        return Message(output =>
        {
            foreach (var row in rows)
            {
                WriteMessage(output, 1, WriteTableRow(row, context, partContainer, !isSingleCellTable));
            }

            var gridWidths = TableGridWidths(table);
            if (gridWidths.Count == 0)
            {
                var width = TableWidthTwips(table, context.Page);
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

    private static byte[] WriteTableRow(
        W.TableRow row,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        bool useImplicitBorderColor)
    {
        return Message(output =>
        {
            foreach (var cell in row.Elements<W.TableCell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
            {
                WriteMessage(output, 1, WriteTableCell(cell, context, partContainer, useImplicitBorderColor));
            }

            WriteString(output, 3, $"table-row-{context.NextTableRowIndex():x8}");
        });
    }

    private static byte[] WriteTableCell(
        W.TableCell cell,
        DocxReadContext context,
        OpenXmlPartContainer partContainer,
        bool useImplicitBorderColor)
    {
        return Message(output =>
        {
            var text = string.Join("\n", cell.Elements<W.Paragraph>().Select(ParagraphText));
            WriteString(output, 1, text);

            foreach (var paragraph in cell.Elements<W.Paragraph>())
            {
                var paragraphProto = WriteParagraph(paragraph, context, partContainer, preserveEmptyParagraph: true);
                if (paragraphProto is not null)
                {
                    WriteMessage(output, 3, paragraphProto);
                }
            }

            var fill = cell.TableCellProperties?.Shading?.Fill?.Value;
            if (IsProtocolColor(fill))
            {
                WriteMessage(output, 5, WriteColorFill(fill!));
            }

            var lines = WriteTableCellLines(cell.TableCellProperties?.TableCellBorders, useImplicitBorderColor);
            if (lines is not null)
            {
                WriteMessage(output, 6, lines);
            }

            WriteString(output, 7, $"table-cell-{context.NextTableCellIndex():x8}");
            WriteInt32IfPresent(output, 8, TableCellGridSpan(cell.TableCellProperties?.GridSpan));
            WriteString(output, 17, TableCellAnchor(cell.TableCellProperties?.TableCellVerticalAlignment));
        });
    }

    private static byte[]? WriteTableCellLines(W.TableCellBorders? borders, bool useImplicitBorderColor)
    {
        if (borders is null)
        {
            return null;
        }

        var top = WriteTableCellLine(borders.TopBorder, useImplicitBorderColor);
        var right = WriteTableCellLine(FirstBorder(borders.RightBorder, borders.EndBorder), useImplicitBorderColor);
        var bottom = WriteTableCellLine(borders.BottomBorder, useImplicitBorderColor);
        var left = WriteTableCellLine(FirstBorder(borders.LeftBorder, borders.StartBorder), useImplicitBorderColor);
        var diagonalDown = WriteTableCellLine(borders.TopLeftToBottomRightCellBorder, useImplicitBorderColor);
        var diagonalUp = WriteTableCellLine(borders.TopRightToBottomLeftCellBorder, useImplicitBorderColor);
        if (top is null && right is null && bottom is null && left is null && diagonalDown is null && diagonalUp is null)
        {
            return null;
        }

        return Message(output =>
        {
            if (top is not null) WriteMessage(output, 1, top);
            if (right is not null) WriteMessage(output, 2, right);
            if (bottom is not null) WriteMessage(output, 3, bottom);
            if (left is not null) WriteMessage(output, 4, left);
            if (diagonalDown is not null) WriteMessage(output, 5, diagonalDown);
            if (diagonalUp is not null) WriteMessage(output, 6, diagonalUp);
        });
    }

    private static byte[]? WriteTableCellLine(W.BorderType? border, bool useImplicitBorderColor)
    {
        if (border is null || !IsVisibleBorder(border))
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 1, TableBorderLineStyle(border));
            WriteInt32(output, 2, TableBorderWidthEmu(border));
            var color = TableBorderColor(border, useImplicitBorderColor);
            if (color is not null)
            {
                WriteMessage(output, 3, WriteColorFill(color));
            }
        });
    }

    private static bool IsVisibleBorder(W.BorderType border)
    {
        var style = TableBorderValue(border);
        return !string.Equals(style, "nil", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(style, "none", StringComparison.OrdinalIgnoreCase);
    }

    private static int TableBorderLineStyle(W.BorderType border)
    {
        return TableBorderValue(border)?.ToLowerInvariant() switch
        {
            "dashed" or "dashsmallgap" or "basicblackdashes" or "basicwhitedashes" or "couponcutoutdashes" => LineStyleDashed,
            "dotted" or "basicblackdots" or "basicwhitedots" or "couponcutoutdots" => LineStyleDotted,
            "dotdash" or "dashdotstroked" => LineStyleDashDot,
            "dotdotdash" => LineStyleDashDotDot,
            _ => LineStyleSolid,
        };
    }

    private static int? TableBorderWidthEmu(W.BorderType border)
    {
        return border.Size is { } size ? (int)Math.Round(size.Value * 12700d / 8d) : null;
    }

    private static string? TableBorderColor(W.BorderType border, bool useImplicitBorderColor)
    {
        var color = border.Color?.Value;
        return IsHexColor(color) ? color! : useImplicitBorderColor ? "000000" : null;
    }

    private static string? TableBorderValue(W.BorderType border)
    {
        return border.Val?.Value.ToString() ?? border.Val?.ToString();
    }

    private static W.BorderType? FirstBorder(params W.BorderType?[] borders)
    {
        return borders.FirstOrDefault(border => border is not null);
    }

    private static int? TableCellGridSpan(W.GridSpan? gridSpan)
    {
        return gridSpan?.Val is { } value ? value.Value : null;
    }

    private static string? TableCellAnchor(W.TableCellVerticalAlignment? alignment)
    {
        return (alignment?.Val?.Value.ToString() ?? alignment?.Val?.ToString())?.ToLowerInvariant() switch
        {
            "top" => "top",
            "center" => "center",
            "bottom" => "bottom",
            _ => null,
        };
    }

    private static int? TableWidthTwips(W.Table table, PageMetrics page)
    {
        var gridTotal = TableGridWidths(table).Sum();
        if (gridTotal > 0)
        {
            return gridTotal;
        }

        var tableWidth = table.GetFirstChild<W.TableProperties>()?.TableWidth;
        var rawWidth = IntFromString(tableWidth?.Width?.Value);
        if (rawWidth is not > 0)
        {
            return null;
        }

        var widthType = tableWidth?.Type?.Value.ToString();
        return string.Equals(widthType, "pct", StringComparison.OrdinalIgnoreCase)
            ? (int)Math.Round(page.ContentWidthTwips * rawWidth.Value / 5000d)
            : rawWidth.Value;
    }

    private static long TableXEmu(W.Table table, PageMetrics page, long tableWidthTwips)
    {
        var leftTwips = page.LeftMarginTwips;
        var remainingTwips = Math.Max(0, page.ContentWidthTwips - tableWidthTwips);
        var alignment = TableJustificationValue(table);
        var offsetTwips = alignment?.ToLowerInvariant() switch
        {
            "center" => remainingTwips / 2d,
            "right" or "end" => remainingTwips,
            _ => 0d,
        };
        return (long)Math.Floor((leftTwips + offsetTwips) * EmuPerTwip);
    }

    private static string? TableJustificationValue(W.Table table)
    {
        var justification = table.GetFirstChild<W.TableProperties>()?.TableJustification;
        var value = justification?.Val?.InnerText;
        if (!string.IsNullOrEmpty(value))
        {
            return value;
        }

        value = justification?.GetAttribute("val", WordprocessingNamespace).Value;
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static List<int> TableGridWidths(W.Table table)
    {
        return table.GetFirstChild<W.TableGrid>()?.Elements<W.GridColumn>()
            .Select(column => IntFromString(column.Width?.Value))
            .Where(width => width is > 0)
            .Select(width => width!.Value)
            .ToList() ?? [];
    }

    private static IEnumerable<byte[]> ExtractTextStyles(MainDocumentPart mainPart)
    {
        var defaultParagraphSpacing = ExtractDefaultParagraphSpacing(mainPart);
        var resolvedParagraphSpacingByStyle = ExtractParagraphStyleSpacing(mainPart);
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

                var resolvedParagraphSpacing = resolvedParagraphSpacingByStyle.GetValueOrDefault(
                    styleId,
                    defaultParagraphSpacing);
                var paragraphStyle = WriteParagraphStyle(style.StyleParagraphProperties, resolvedParagraphSpacing);
                if (paragraphStyle is not null)
                {
                    WriteMessage(output, 5, paragraphStyle);
                }

                WriteString(output, 6, style.BasedOn?.Val?.Value);
                WriteString(output, 8, style.NextParagraphStyle?.Val?.Value);
                WriteInt32IfPresent(output, 9, resolvedParagraphSpacing.Before);
                WriteInt32IfPresent(output, 10, resolvedParagraphSpacing.After);
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

        var abstractNums = new Dictionary<string, W.AbstractNum>(StringComparer.Ordinal);
        foreach (var abstractNum in numbering.Elements<W.AbstractNum>())
        {
            var abstractNumId = abstractNum.AbstractNumberId?.InnerText;
            if (!string.IsNullOrEmpty(abstractNumId))
            {
                abstractNums.TryAdd(abstractNumId, abstractNum);
            }
        }

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

    private static IEnumerable<byte[]> ExtractSections(W.Body body, DocxReadContext context)
    {
        var fallbackPage = PageMetrics.From(body);
        var previousPage = fallbackPage;
        var index = 1;
        var sectionProperties = DocumentSectionProperties(body).ToList();
        if (sectionProperties.Count == 0)
        {
            yield return WriteSection("section-1", fallbackPage, LastSectionProperties(body), context);
            yield break;
        }

        var targetSectionCount = sectionProperties.Count == 1
            ? Math.Max(sectionProperties.Count, EstimatedSectionCountFromPageBreaks(body))
            : sectionProperties.Count;
        for (var sectionIndex = 0; sectionIndex < targetSectionCount; sectionIndex++)
        {
            var section = sectionProperties[Math.Min(sectionIndex, sectionProperties.Count - 1)];
            var page = PageMetrics.FromSection(section, previousPage);
            yield return WriteSection($"section-{index}", page, section, context);
            previousPage = page;
            index++;
        }
    }

    private static int EstimatedSectionCountFromPageBreaks(W.Body body)
    {
        var renderedBreaks = 0;
        var hardBreaks = 0;
        var hasVisibleContentBeforeFirstBreak = false;
        var sawBreak = false;

        foreach (var block in RetainedSectionScanElements(body.ChildElements))
        {
            foreach (var node in block.Descendants())
            {
                if (IsRevisionScoped(node))
                {
                    continue;
                }

                if (node is W.LastRenderedPageBreak)
                {
                    renderedBreaks++;
                    sawBreak = true;
                    continue;
                }

                if (node is W.Break pageBreak && IsHardPageBreak(pageBreak))
                {
                    hardBreaks++;
                    sawBreak = true;
                    continue;
                }

                if (!sawBreak && IsVisibleSectionContent(node))
                {
                    hasVisibleContentBeforeFirstBreak = true;
                }
            }
        }

        var renderedSectionCount = renderedBreaks > 0
            ? renderedBreaks + (hasVisibleContentBeforeFirstBreak ? 1 : 0)
            : 0;
        var hardSectionCount = hardBreaks > 0
            ? hardBreaks + (hasVisibleContentBeforeFirstBreak ? 1 : 0)
            : 0;
        return Math.Max(1, Math.Max(renderedSectionCount, hardSectionCount));
    }

    private static bool IsHardPageBreak(W.Break pageBreak)
    {
        var breakType = pageBreak.Type?.InnerText;
        if (string.IsNullOrWhiteSpace(breakType))
        {
            breakType = pageBreak
                .GetAttributes()
                .FirstOrDefault(attribute =>
                    string.Equals(attribute.LocalName, "type", StringComparison.OrdinalIgnoreCase) &&
                    (string.Equals(attribute.NamespaceUri, WordprocessingNamespace, StringComparison.Ordinal) ||
                        string.Equals(attribute.Prefix, "w", StringComparison.Ordinal)))
                .Value;
        }

        return string.Equals(breakType, "page", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<OpenXmlElement> RetainedSectionScanElements(IEnumerable<OpenXmlElement> childElements)
    {
        foreach (var child in childElements)
        {
            if (child is W.Table)
            {
                continue;
            }

            if (child is W.SdtBlock sdtBlock)
            {
                if (IsTableOfContentsSdt(sdtBlock))
                {
                    continue;
                }

                foreach (var nested in RetainedSectionScanElements(sdtBlock.SdtContentBlock?.ChildElements ?? []))
                {
                    yield return nested;
                }

                continue;
            }

            yield return child;
        }
    }

    private static bool IsRevisionScoped(OpenXmlElement element)
    {
        return element.Ancestors<W.InsertedRun>().Any() ||
            element.Ancestors<W.DeletedRun>().Any();
    }

    private static bool IsVisibleSectionContent(OpenXmlElement element)
    {
        return element switch
        {
            W.Text text => !string.IsNullOrEmpty(text.Text),
            W.Drawing => true,
            W.Table => true,
            _ => false,
        };
    }

    private static IEnumerable<W.SectionProperties> DocumentSectionProperties(W.Body body)
    {
        foreach (var child in body.ChildElements)
        {
            if (child is W.Paragraph paragraph &&
                paragraph.ParagraphProperties?.GetFirstChild<W.SectionProperties>() is { } paragraphSection)
            {
                yield return paragraphSection;
            }
            else if (child is W.SectionProperties bodySection)
            {
                yield return bodySection;
            }
        }
    }

    private static byte[] WriteSection(
        string id,
        PageMetrics page,
        W.SectionProperties? sectionProperties,
        DocxReadContext context)
    {
        return Message(output =>
        {
            WriteString(output, 1, id);
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
                WriteInt32(
                    columnsOutput,
                    1,
                    columns is null
                        ? 0
                        : IntFromString(columns.ColumnCount?.InnerText) ?? Math.Max(1, explicitColumns.Count));
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
        var rawType = sectionProperties?.ChildElements
            .FirstOrDefault(element => element.LocalName == "type")
            ?.GetAttribute("val", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
            .Value;
        rawType ??= sectionProperties?.GetFirstChild<W.SectionType>()?.Val?.Value.ToString();
        if (string.IsNullOrEmpty(rawType))
        {
            rawType = SectionBreakTypeFromXml(sectionProperties?.OuterXml);
        }
        return rawType?.ToLowerInvariant() switch
        {
            "continuous" => SectionBreakContinuous,
            "evenPage" => SectionBreakEvenPage,
            "oddPage" => SectionBreakOddPage,
            _ => SectionBreakNextPage,
        };
    }

    private static string? SectionBreakTypeFromXml(string? xml)
    {
        if (string.IsNullOrEmpty(xml))
        {
            return null;
        }

        if (xml.Contains("continuous", StringComparison.OrdinalIgnoreCase)) return "continuous";
        if (xml.Contains("evenPage", StringComparison.OrdinalIgnoreCase)) return "evenPage";
        if (xml.Contains("oddPage", StringComparison.OrdinalIgnoreCase)) return "oddPage";
        return null;
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
        var complexScriptFontSize = runProperties.GetFirstChild<W.FontSizeComplexScript>();
        var hasStyle =
            bold is not null ||
            italic is not null ||
            fontSize?.Val?.Value is not null ||
            IsProtocolColor(colorElement?.Val?.Value) ||
            underlineElement?.Val is not null ||
            complexScriptFontSize?.Val?.Value is not null ||
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
            if (IsProtocolColor(color))
            {
                WriteMessage(output, 7, WriteColorFill(color!));
            }

            var underline = underlineElement?.Val?.ToString();
            if (!string.IsNullOrEmpty(underline) && underline != "None")
            {
                WriteString(output, 9, underline);
            }

            var typeface =
                runFonts?.Ascii?.Value ??
                runFonts?.HighAnsi?.Value ??
                runFonts?.ComplexScript?.Value;
            WriteString(output, 17, ComplexScriptFontSizeScheme(complexScriptFontSize));
            WriteString(output, 18, typeface);
        });
    }

    private static byte[]? WriteParagraphTextStyle(W.ParagraphProperties? paragraphProperties)
    {
        var alignment = AlignmentFromJustification(paragraphProperties?.Justification);
        var markRunProperties = paragraphProperties?.ParagraphMarkRunProperties;
        var fontSize = markRunProperties?.GetFirstChild<W.FontSize>();
        var colorElement = markRunProperties?.GetFirstChild<W.Color>();
        var complexScriptFontSize = markRunProperties?.GetFirstChild<W.FontSizeComplexScript>();
        if (alignment is null &&
            fontSize?.Val?.Value is null &&
            !IsProtocolColor(colorElement?.Val?.Value) &&
            complexScriptFontSize?.Val?.Value is null)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 6, HalfPointStringToCentipoints(fontSize?.Val?.Value));
            var color = colorElement?.Val?.Value;
            if (IsProtocolColor(color))
            {
                WriteMessage(output, 7, WriteColorFill(color!));
            }

            WriteInt32(output, 8, alignment);
            WriteString(output, 17, ComplexScriptFontSizeScheme(complexScriptFontSize));
        });
    }

    private static string? ComplexScriptFontSizeScheme(W.FontSizeComplexScript? fontSize)
    {
        var value = fontSize?.Val?.Value;
        return string.IsNullOrEmpty(value) ? null : $"__docxComplexScriptFontSize:{value}";
    }

    private static byte[]? WriteParagraphStyle(
        W.StyleParagraphProperties? paragraphProperties,
        ParagraphSpacingData? fallbackSpacing = null)
    {
        var linePercent = LineSpacingPercent(paragraphProperties?.SpacingBetweenLines?.Line?.Value) ??
            fallbackSpacing?.LineSpacingPercent;
        if (linePercent is null)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 4, linePercent);
        });
    }

    private static Dictionary<string, ParagraphSpacingData> ExtractParagraphStyleSpacing(MainDocumentPart mainPart)
    {
        var defaultSpacing = ExtractDefaultParagraphSpacing(mainPart);
        var styles = mainPart.StyleDefinitionsPart?.Styles?.Elements<W.Style>() ?? Enumerable.Empty<W.Style>();
        var paragraphStyles = new Dictionary<string, W.Style>(StringComparer.Ordinal);
        foreach (var style in styles)
        {
            var styleId = style.StyleId?.Value;
            if (style.Type?.Value == W.StyleValues.Paragraph && !string.IsNullOrEmpty(styleId))
            {
                paragraphStyles.TryAdd(styleId, style);
            }
        }

        var spacingByStyle = new Dictionary<string, ParagraphSpacingData>(StringComparer.Ordinal);
        foreach (var styleId in paragraphStyles.Keys)
        {
            ResolveParagraphStyleSpacing(
                styleId,
                paragraphStyles,
                defaultSpacing,
                spacingByStyle,
                new HashSet<string>(StringComparer.Ordinal));
        }

        return spacingByStyle;
    }

    private static ParagraphSpacingData ResolveParagraphStyleSpacing(
        string styleId,
        IReadOnlyDictionary<string, W.Style> paragraphStyles,
        ParagraphSpacingData defaultSpacing,
        Dictionary<string, ParagraphSpacingData> spacingByStyle,
        HashSet<string> visiting)
    {
        if (spacingByStyle.TryGetValue(styleId, out var cached))
        {
            return cached;
        }

        if (!paragraphStyles.TryGetValue(styleId, out var style) || !visiting.Add(styleId))
        {
            return defaultSpacing;
        }

        try
        {
            var fallback = defaultSpacing;
            var basedOnStyleId = style.BasedOn?.Val?.Value;
            if (!string.IsNullOrEmpty(basedOnStyleId))
            {
                fallback = ResolveParagraphStyleSpacing(
                    basedOnStyleId,
                    paragraphStyles,
                    defaultSpacing,
                    spacingByStyle,
                    visiting);
            }

            var resolved = ParagraphStyleSpacingFrom(style.StyleParagraphProperties).WithFallback(fallback);
            spacingByStyle[styleId] = resolved;
            return resolved;
        }
        finally
        {
            visiting.Remove(styleId);
        }
    }

    private static ParagraphSpacingData ParagraphSpacingFrom(W.ParagraphProperties? paragraphProperties)
    {
        return ParagraphSpacingFrom(paragraphProperties?.SpacingBetweenLines);
    }

    private static ParagraphSpacingData ParagraphStyleSpacingFrom(W.StyleParagraphProperties? paragraphProperties)
    {
        return ParagraphSpacingFrom(paragraphProperties?.SpacingBetweenLines);
    }

    private static ParagraphSpacingData ExtractDefaultParagraphSpacing(MainDocumentPart mainPart)
    {
        return ParagraphSpacingFrom(
            mainPart.StyleDefinitionsPart?.Styles?.DocDefaults?.ParagraphPropertiesDefault
                ?.ParagraphPropertiesBaseStyle?.SpacingBetweenLines);
    }

    private static string? ExtractDefaultParagraphStyleId(MainDocumentPart mainPart)
    {
        return mainPart.StyleDefinitionsPart?.Styles?.Elements<W.Style>()
            .FirstOrDefault(style => style.Type?.Value == W.StyleValues.Paragraph && style.Default?.Value == true)
            ?.StyleId
            ?.Value;
    }

    private static ParagraphSpacingData ParagraphSpacingFrom(W.SpacingBetweenLines? spacing)
    {
        return new ParagraphSpacingData(
            StrictIntFromString(spacing?.Before?.Value),
            StrictIntFromString(spacing?.After?.Value),
            LineSpacingPercent(spacing?.Line?.Value));
    }

    private static int? LineSpacingPercent(string? lineValue)
    {
        var line = StrictIntFromString(lineValue);
        return line is null ? null : (int)Math.Round(line.Value * 100000d / 240d);
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
        var normalizedColor = color.ToUpperInvariant();
        return Message(output =>
        {
            WriteInt32(output, 1, ColorTypeRgb);
            WriteString(output, 2, normalizedColor);
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
            properties?.SpacingBetweenLines is not null ||
            properties?.ContextualSpacing is not null ||
            properties?.ParagraphMarkRunProperties is not null;
    }

    private static bool HasParagraphPlaceholderContent(W.Paragraph paragraph)
    {
        return paragraph.ChildElements.Any(child => child is W.SdtRun) ||
            paragraph.Descendants().Any(element =>
                element.NamespaceUri == "http://schemas.openxmlformats.org/officeDocument/2006/math");
    }

    private static string ParagraphText(W.Paragraph paragraph)
    {
        return string.Concat(paragraph.Descendants<W.Run>().Select(RunText));
    }

    private static string RunText(W.Run run)
    {
        return RunText(run, includeRenderedBreak: HasVisibleTextBeforeRun(run));
    }

    private static string RunText(W.Run run, bool includeRenderedBreak)
    {
        return string.Concat(run.ChildElements.Select(child => child switch
        {
            W.Text text => text.Text,
            W.TabChar _ => "\t",
            W.Break _ => "\n",
            W.CarriageReturn _ => "\n",
            W.LastRenderedPageBreak _ when includeRenderedBreak => "__docxBreak:rendered__",
            W.NoBreakHyphen _ => "-",
            W.SoftHyphen _ => "\u00ad",
            W.SymbolChar symbol => SymbolText(symbol),
            _ => "",
        }));
    }

    private static bool HasVisibleTextBeforeRun(W.Run run)
    {
        foreach (var sibling in run.ElementsBefore())
        {
            if (sibling is W.Run previousRun && RunText(previousRun, includeRenderedBreak: false).Length > 0)
            {
                return true;
            }

            foreach (var nestedRun in sibling.Descendants<W.Run>())
            {
                if (RunText(nestedRun, includeRenderedBreak: false).Length > 0)
                {
                    return true;
                }
            }
        }

        return false;
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
        var halfPoints = StrictIntFromString(value);
        return halfPoints is null ? null : halfPoints * 50;
    }

    private static int? IntFromString(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        if (!decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var decimalValue) ||
            decimalValue < int.MinValue ||
            decimalValue > int.MaxValue)
        {
            return null;
        }

        return (int)Math.Round(decimalValue, 0, MidpointRounding.AwayFromZero);
    }

    private static int? StrictIntFromString(string? value)
    {
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static long? LongFromString(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        if (!decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var decimalValue) ||
            decimalValue < long.MinValue ||
            decimalValue > long.MaxValue)
        {
            return null;
        }

        return (long)Math.Round(decimalValue, 0, MidpointRounding.AwayFromZero);
    }

    private static long? ToLong(Int64Value? value)
    {
        return value?.Value;
    }

    private static int ToInt32(uint? value, int fallback)
    {
        return value is null ? fallback : (int)Math.Min(value.Value, int.MaxValue);
    }

    private static int ToInt32(int? value, int fallback)
    {
        return value ?? fallback;
    }

    private static long? ParseLong(string? value)
    {
        return LongFromString(value);
    }

    private static double ParseDouble(string? value)
    {
        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : double.NaN;
    }

    private static bool IsHexColor(string? value)
    {
        return value is { Length: 6 } && value.All(Uri.IsHexDigit);
    }

    private static bool IsProtocolColor(string? value)
    {
        return IsHexColor(value) || string.Equals(value, "auto", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeImageContentType(string contentType)
    {
        return contentType;
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

    private static void WriteInt32IfPresent(CodedOutputStream output, int fieldNumber, int? value)
    {
        if (value is null)
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
        private int _fallbackImageOrder;
        private readonly List<string> _activeCommentIds = [];

        public MainDocumentPart MainPart { get; } = mainPart;
        public PageMetrics Page { get; } = page;
        public Dictionary<string, DocumentImage> Images { get; } = [];
        public Dictionary<string, ChartPart> Charts { get; } = [];
        public Dictionary<string, SortedSet<string>> CommentReferenceRunIds { get; } = [];
        public Dictionary<string, SortedSet<string>> FootnoteReferenceRunIds { get; } = [];
        public Dictionary<string, ReviewMarkData> ReviewMarks { get; } = [];
        public List<ParagraphNumberingData> ParagraphNumberings { get; } = [];
        public Dictionary<string, ParagraphSpacingData> ParagraphStyleSpacing { get; } = ExtractParagraphStyleSpacing(mainPart);
        public string? DefaultParagraphStyleId { get; } = ExtractDefaultParagraphStyleId(mainPart);
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

        public void ClearActiveComments()
        {
            _activeCommentIds.Clear();
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

        public ParagraphSpacingData ResolveParagraphSpacing(W.ParagraphProperties? paragraphProperties)
        {
            var direct = ParagraphSpacingFrom(paragraphProperties);
            var styleId = paragraphProperties?.ParagraphStyleId?.Val?.Value;
            var resolvedStyleId = !string.IsNullOrEmpty(styleId) ? styleId : DefaultParagraphStyleId;
            var styleSpacing = !string.IsNullOrEmpty(resolvedStyleId) &&
                ParagraphStyleSpacing.TryGetValue(resolvedStyleId, out var explicitStyleSpacing)
                    ? explicitStyleSpacing
                    : ParagraphStyleSpacing.GetValueOrDefault("Normal");

            return new ParagraphSpacingData(
                direct.Before ?? styleSpacing?.Before,
                direct.After ?? styleSpacing?.After,
                direct.LineSpacingPercent ?? styleSpacing?.LineSpacingPercent);
        }

        public void AddChart(ChartPart chartPart)
        {
            Charts.TryAdd(chartPart.Uri.OriginalString, chartPart);
        }

        public DocumentImage AddImage(ImagePart imagePart, OpenXmlPartContainer partContainer, string relationshipId)
        {
            using var stream = imagePart.GetStream();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            var bytes = memory.ToArray();
            var id = $"image-{Convert.ToHexString(SHA256.HashData(bytes)[..8]).ToLowerInvariant()}";
            if (!Images.TryGetValue(id, out var image))
            {
                image = new DocumentImage(
                    id,
                    NormalizeImageContentType(imagePart.ContentType),
                    bytes,
                    ImageOrder(partContainer, relationshipId));
                Images[id] = image;
            }

            return image;
        }

        private int ImageOrder(OpenXmlPartContainer partContainer, string relationshipId)
        {
            if (!ReferenceEquals(partContainer, MainPart))
            {
                return int.MaxValue / 2 + _fallbackImageOrder++;
            }

            var relationshipIds = MainPart.Parts
                .Select(part => part.RelationshipId)
                .ToList();
            var index = relationshipIds.FindIndex(id => string.Equals(id, relationshipId, StringComparison.Ordinal));
            return index < 0 ? int.MaxValue / 2 + _fallbackImageOrder++ : relationshipIds.Count - index;
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

    private sealed record DocumentImage(string Id, string ContentType, byte[] Bytes, int Order);

    private sealed record HyperlinkTarget(string Uri, bool IsExternal, string Action);

    private sealed record ReviewMarkData(string Id, int Type, string Author, string Initials, string CreatedAt);

    private sealed record ParagraphNumberingData(string ParagraphId, string NumId, int Level);

    private sealed record ParagraphSpacingData(int? Before, int? After, int? LineSpacingPercent)
    {
        public ParagraphSpacingData WithFallback(ParagraphSpacingData fallback)
        {
            return new ParagraphSpacingData(
                Before ?? fallback.Before,
                After ?? fallback.After,
                LineSpacingPercent ?? fallback.LineSpacingPercent);
        }
    }

    private sealed record ChartSeriesData(
        string Id,
        string Name,
        IReadOnlyList<string> Categories,
        IReadOnlyList<double> Values,
        OpenXmlElement Element);

    private sealed record PageMetrics(
        long WidthTwips,
        long HeightTwips,
        long? ExplicitWidthTwips,
        long? ExplicitHeightTwips,
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

        public long ContentHeightTwips => Math.Max(0, HeightTwips - TopMarginTwips - BottomMarginTwips);

        public static PageMetrics From(W.Body body)
        {
            var section = body.ChildElements
                .Select(child => child is W.Paragraph paragraph
                    ? paragraph.ParagraphProperties?.GetFirstChild<W.SectionProperties>()
                    : child as W.SectionProperties)
                .FirstOrDefault(item => item is not null) ??
                body.Elements<W.SectionProperties>().LastOrDefault() ??
                body.Descendants<W.SectionProperties>().LastOrDefault();
            return FromSection(section, new PageMetrics(
                12_240,
                15_840,
                null,
                null,
                1_440,
                1_440,
                1_440,
                1_440,
                720,
                720,
                0,
                720));
        }

        public static PageMetrics FromSection(W.SectionProperties? section, PageMetrics fallback)
        {
            var pageSize = section?.GetFirstChild<W.PageSize>();
            var margin = section?.GetFirstChild<W.PageMargin>();
            var columns = section?.GetFirstChild<W.Columns>();
            var explicitWidth = LongFromString(pageSize?.Width?.InnerText);
            var explicitHeight = LongFromString(pageSize?.Height?.InnerText);
            return new PageMetrics(
                explicitWidth ?? fallback.WidthTwips,
                explicitHeight ?? fallback.HeightTwips,
                explicitWidth ?? fallback.ExplicitWidthTwips,
                explicitHeight ?? fallback.ExplicitHeightTwips,
                IntFromString(margin?.Top?.InnerText) ?? fallback.TopMarginTwips,
                IntFromString(margin?.Bottom?.InnerText) ?? fallback.BottomMarginTwips,
                IntFromString(margin?.Left?.InnerText) ?? fallback.LeftMarginTwips,
                IntFromString(margin?.Right?.InnerText) ?? fallback.RightMarginTwips,
                IntFromString(margin?.Header?.InnerText) ?? fallback.HeaderTwips,
                IntFromString(margin?.Footer?.InnerText) ?? fallback.FooterTwips,
                IntFromString(margin?.Gutter?.InnerText) ?? fallback.GutterTwips,
                IntFromString(columns?.Space?.InnerText) ?? fallback.ColumnSpaceTwips);
        }
    }
}
