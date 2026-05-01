using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using A = DocumentFormat.OpenXml.Drawing;
using P = DocumentFormat.OpenXml.Presentation;

namespace Routa.OfficeWasmReader;

internal static class PptxPresentationProtoReader
{
    private const int ElementTypeText = 1;
    private const int ElementTypeImage = 3;
    private const int ElementTypeShape = 5;
    private const int FillTypeSolid = 1;
    private const int ColorTypeRgb = 1;
    private const int ColorTypeScheme = 2;
    private const int ColorTypeSystem = 3;
    private const int LineStyleSolid = 1;

    public static byte[] Read(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var document = PresentationDocument.Open(stream, false);
        var presentationPart = document.PresentationPart;
        var slideSize = presentationPart?.Presentation.SlideSize;
        var widthEmu = ToLong(slideSize?.Cx) ?? 12_192_000L;
        var heightEmu = ToLong(slideSize?.Cy) ?? 6_858_000L;
        var slideIds = presentationPart?.Presentation.SlideIdList?.Elements<P.SlideId>() ?? Enumerable.Empty<P.SlideId>();

        return Message(output =>
        {
            var slideIndex = 1;
            foreach (var slideId in slideIds)
            {
                if (slideIndex > OpenXmlReaderLimits.MaxSlides)
                {
                    break;
                }

                var relationshipId = slideId.RelationshipId?.Value;
                if (presentationPart is null || string.IsNullOrEmpty(relationshipId))
                {
                    continue;
                }

                if (presentationPart.GetPartById(relationshipId) is not SlidePart slidePart)
                {
                    continue;
                }

                WriteMessage(output, 1, WriteSlide(slidePart, slideIndex, widthEmu, heightEmu));
                slideIndex++;
            }
        });
    }

    private static byte[] WriteSlide(SlidePart slidePart, int slideIndex, long widthEmu, long heightEmu)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, slideIndex);
            var layoutId = slidePart.SlideLayoutPart?.Uri.OriginalString;
            WriteString(output, 2, layoutId);

            var elementIndex = 0;
            var shapeTree = slidePart.Slide.CommonSlideData?.ShapeTree;
            if (shapeTree is not null)
            {
                foreach (var child in shapeTree.ChildElements)
                {
                    var element = child switch
                    {
                        P.Shape shape => WriteShapeElement(shape, elementIndex),
                        P.Picture picture => WritePictureElement(slidePart, picture, elementIndex),
                        P.GraphicFrame graphicFrame => WriteGraphicFrameElement(graphicFrame, elementIndex),
                        _ => null,
                    };

                    if (element is not null)
                    {
                        WriteMessage(output, 3, element);
                        elementIndex++;
                    }
                }
            }

            WriteInt64(output, 5, widthEmu);
            WriteInt64(output, 6, heightEmu);
            var background = SolidFillFromBackground(slidePart.Slide.CommonSlideData?.Background);
            if (background is not null)
            {
                WriteMessage(output, 10, WriteBackground(background));
            }

            WriteString(output, 11, slidePart.Uri.OriginalString);
        });
    }

    private static byte[]? WriteShapeElement(P.Shape shape, int elementIndex)
    {
        var nonVisual = shape.NonVisualShapeProperties?.NonVisualDrawingProperties;
        var shapeProperties = shape.ShapeProperties;
        var bbox = shapeProperties?.Transform2D;
        var paragraphs = ExtractParagraphs(shape.TextBody).ToList();
        var hasText = paragraphs.Count > 0;

        return Message(output =>
        {
            if (bbox is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(bbox));
            }

            var fill = SolidFillFromProperties(shapeProperties);
            var line = OutlineFromProperties(shapeProperties);
            var shapeProto = WriteShape(shapeProperties, fill, line);
            WriteMessage(output, 4, shapeProto);

            foreach (var paragraph in paragraphs)
            {
                WriteMessage(output, 6, paragraph);
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Shape {elementIndex}");
            WriteInt32(output, 11, hasText ? ElementTypeText : ElementTypeShape);
            if (fill is not null)
            {
                WriteMessage(output, 19, WriteFill(fill));
            }

            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (elementIndex + 1).ToString());
            if (line is not null)
            {
                WriteMessage(output, 30, WriteLine(line));
            }
        });
    }

    private static byte[]? WritePictureElement(SlidePart slidePart, P.Picture picture, int elementIndex)
    {
        var nonVisual = picture.NonVisualPictureProperties?.NonVisualDrawingProperties;
        var transform = picture.ShapeProperties?.Transform2D;
        var blip = picture.BlipFill?.Blip;
        var relationshipId = blip?.Embed?.Value;
        ImagePart? imagePart = null;
        if (!string.IsNullOrEmpty(relationshipId))
        {
            imagePart = slidePart.GetPartById(relationshipId) as ImagePart;
        }

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            if (imagePart is not null)
            {
                WriteMessage(output, 5, WriteImage(imagePart, nonVisual?.Description?.Value ?? ""));
            }

            if (!string.IsNullOrEmpty(relationshipId))
            {
                WriteMessage(output, 3, WriteImageReference(relationshipId));
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Picture {elementIndex}");
            WriteInt32(output, 11, imagePart is null ? ElementTypeShape : ElementTypeImage);
            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (elementIndex + 1).ToString());
        });
    }

    private static byte[]? WriteGraphicFrameElement(P.GraphicFrame graphicFrame, int elementIndex)
    {
        var nonVisual = graphicFrame.NonVisualGraphicFrameProperties?.NonVisualDrawingProperties;
        var transform = graphicFrame.Transform;
        var table = graphicFrame.Descendants<A.Table>().FirstOrDefault();
        if (transform is null && table is null)
        {
            return null;
        }

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            if (table is not null)
            {
                WriteMessage(output, 21, WriteTable(table));
                WriteInt32(output, 11, 9);
            }
            else
            {
                WriteInt32(output, 11, ElementTypeShape);
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Graphic Frame {elementIndex}");
            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (elementIndex + 1).ToString());
        });
    }

    private static IEnumerable<byte[]> ExtractParagraphs(OpenXmlElement? textBody)
    {
        if (textBody is null)
        {
            yield break;
        }

        var paragraphIndex = 0;
        foreach (var paragraph in textBody.Elements<A.Paragraph>())
        {
            var runs = ExtractRuns(paragraph).ToList();
            if (runs.Count == 0)
            {
                continue;
            }

            yield return Message(output =>
            {
                foreach (var run in runs)
                {
                    WriteMessage(output, 1, run);
                }

                WriteString(output, 9, $"p{paragraphIndex}");
            });
            paragraphIndex++;
        }
    }

    private static IEnumerable<byte[]> ExtractRuns(A.Paragraph paragraph)
    {
        var runIndex = 0;
        foreach (var run in paragraph.Elements<A.Run>())
        {
            var text = TextNormalization.Clean(run.Text?.Text ?? "");
            if (text.Length == 0)
            {
                continue;
            }

            var runProperties = run.RunProperties;
            yield return Message(output =>
            {
                WriteString(output, 1, text);
                if (runProperties is not null)
                {
                    WriteMessage(output, 2, WriteTextStyle(runProperties));
                }

                WriteString(output, 4, $"r{runIndex}");
            });
            runIndex++;
        }
    }

    private static byte[] WriteBoundingBox(A.Transform2D transform)
    {
        return Message(output =>
        {
            WriteInt64(output, 1, ToLong(transform.Offset?.X));
            WriteInt64(output, 2, ToLong(transform.Offset?.Y));
            WriteInt64(output, 3, ToLong(transform.Extents?.Cx));
            WriteInt64(output, 4, ToLong(transform.Extents?.Cy));
            WriteInt32(output, 5, transform.Rotation?.Value);
            WriteBool(output, 6, transform.HorizontalFlip?.Value);
            WriteBool(output, 7, transform.VerticalFlip?.Value);
        });
    }

    private static byte[] WriteBoundingBox(P.Transform transform)
    {
        return Message(output =>
        {
            WriteInt64(output, 1, ToLong(transform.Offset?.X));
            WriteInt64(output, 2, ToLong(transform.Offset?.Y));
            WriteInt64(output, 3, ToLong(transform.Extents?.Cx));
            WriteInt64(output, 4, ToLong(transform.Extents?.Cy));
        });
    }

    private static byte[] WriteShape(OpenXmlElement? properties, A.SolidFill? fill, A.Outline? line)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, GeometryCode(properties?.GetFirstChild<A.PresetGeometry>()));
            if (fill is not null)
            {
                WriteMessage(output, 5, WriteFill(fill));
            }

            if (line is not null)
            {
                WriteMessage(output, 6, WriteLine(line));
            }
        });
    }

    private static byte[] WriteBackground(A.SolidFill fill)
    {
        return Message(output =>
        {
            WriteMessage(output, 3, WriteFill(fill));
        });
    }

    private static byte[] WriteFill(A.SolidFill fill)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, FillTypeSolid);
            var color = ColorFromSolidFill(fill);
            if (color is not null)
            {
                WriteMessage(output, 2, WriteColor(color));
            }
        });
    }

    private static byte[] WriteLine(A.Outline line)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, LineStyleSolid);
            WriteInt32(output, 2, line.Width?.Value);
            var fill = line.GetFirstChild<A.SolidFill>();
            if (fill is not null)
            {
                WriteMessage(output, 3, WriteFill(fill));
            }
        });
    }

    private static byte[] WriteTextStyle(A.RunProperties runProperties)
    {
        return Message(output =>
        {
            WriteBool(output, 4, runProperties.Bold?.Value);
            WriteBool(output, 5, runProperties.Italic?.Value);
            WriteInt32(output, 6, runProperties.FontSize?.Value);
            var fill = runProperties.GetFirstChild<A.SolidFill>();
            if (fill is not null)
            {
                WriteMessage(output, 7, WriteFill(fill));
            }

            var underline = runProperties.Underline?.Value.ToString();
            if (!string.IsNullOrEmpty(underline) && underline != "None")
            {
                WriteString(output, 9, underline);
            }

            var typeface =
                runProperties.GetFirstChild<A.LatinFont>()?.Typeface?.Value ??
                runProperties.GetFirstChild<A.EastAsianFont>()?.Typeface?.Value ??
                runProperties.GetFirstChild<A.ComplexScriptFont>()?.Typeface?.Value;
            WriteString(output, 18, typeface);
        });
    }

    private static byte[] WriteImage(ImagePart imagePart, string alt)
    {
        return Message(output =>
        {
            WriteString(output, 1, imagePart.ContentType);
            using var stream = imagePart.GetStream();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            var bytes = memory.ToArray();
            if (bytes.Length <= OpenXmlReaderLimits.MaxImageBytes)
            {
                WriteBytes(output, 2, bytes);
            }

            WriteString(output, 4, alt);
        });
    }

    private static byte[] WriteImageReference(string relationshipId)
    {
        return Message(output =>
        {
            WriteString(output, 1, relationshipId);
        });
    }

    private static byte[] WriteTable(A.Table table)
    {
        return Message(output =>
        {
            foreach (var row in table.Elements<A.TableRow>().Take(OpenXmlReaderLimits.MaxRowsPerTable))
            {
                WriteMessage(output, 1, Message(rowOutput =>
                {
                    foreach (var cell in row.Elements<A.TableCell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
                    {
                        WriteMessage(rowOutput, 1, Message(cellOutput =>
                        {
                            foreach (var paragraph in ExtractParagraphs(cell.TextBody))
                            {
                                WriteMessage(cellOutput, 1, paragraph);
                            }
                        }));
                    }
                }));
            }
        });
    }

    private static A.SolidFill? SolidFillFromBackground(P.Background? background)
    {
        return background?.BackgroundProperties?.GetFirstChild<A.SolidFill>() ??
            background?.BackgroundProperties?.Descendants<A.SolidFill>().FirstOrDefault();
    }

    private static A.SolidFill? SolidFillFromProperties(OpenXmlElement? properties)
    {
        return properties?.GetFirstChild<A.SolidFill>();
    }

    private static A.Outline? OutlineFromProperties(OpenXmlElement? properties)
    {
        var outline = properties?.GetFirstChild<A.Outline>();
        if (outline is null || outline.GetFirstChild<A.NoFill>() is not null)
        {
            return null;
        }

        return outline.GetFirstChild<A.SolidFill>() is not null || outline.Width is not null ? outline : null;
    }

    private static ColorValue? ColorFromSolidFill(A.SolidFill fill)
    {
        var rgb = fill.GetFirstChild<A.RgbColorModelHex>();
        if (rgb?.Val?.Value is { Length: > 0 } value)
        {
            return new ColorValue(ColorTypeRgb, value, LastColor: null, Alpha: AlphaFrom(rgb));
        }

        var scheme = fill.GetFirstChild<A.SchemeColor>();
        if (scheme?.Val?.Value is not null)
        {
            return new ColorValue(ColorTypeScheme, scheme.Val.Value.ToString(), LastColor: null, Alpha: AlphaFrom(scheme));
        }

        var system = fill.GetFirstChild<A.SystemColor>();
        if (system?.Val?.Value is not null)
        {
            return new ColorValue(
                ColorTypeSystem,
                system.Val.Value.ToString(),
                system.LastColor?.Value,
                AlphaFrom(system));
        }

        return null;
    }

    private static byte[] WriteColor(ColorValue color)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, color.Type);
            WriteString(output, 2, color.Value);
            if (color.Alpha is not null)
            {
                WriteMessage(output, 3, Message(transformOutput =>
                {
                    WriteInt32(transformOutput, 6, color.Alpha.Value);
                }));
            }

            WriteString(output, 4, color.LastColor);
        });
    }

    private static int? AlphaFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.Alpha>()?.Val?.Value;
    }

    private static int GeometryCode(A.PresetGeometry? geometry)
    {
        var value = geometry?.Preset?.Value.ToString();
        return value switch
        {
            "rect" => 5,
            "roundRect" => 26,
            "ellipse" => 89,
            "line" => 1,
            "triangle" => 23,
            "diamond" => 30,
            "parallelogram" => 31,
            "trapezoid" => 32,
            "hexagon" => 39,
            "arc" => 91,
            "bracePair" => 111,
            "bracketPair" => 112,
            _ => 5,
        };
    }

    private static long? ToLong(Int64Value? value)
    {
        return value?.Value;
    }

    private static long? ToLong(Int32Value? value)
    {
        return value?.Value;
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

    private static void WriteInt64(CodedOutputStream output, int fieldNumber, long? value)
    {
        if (value is null or 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteInt64(value.Value);
    }

    private static void WriteBool(CodedOutputStream output, int fieldNumber, bool? value)
    {
        if (value != true)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteBool(true);
    }

    private sealed record ColorValue(int Type, string Value, string? LastColor, int? Alpha);
}
