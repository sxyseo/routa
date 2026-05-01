using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using A = DocumentFormat.OpenXml.Drawing;
using P = DocumentFormat.OpenXml.Presentation;

namespace Routa.OfficeWasmReader;

internal static class PptxPresentationProtoReader
{
    private const int ElementTypeText = 1;
    private const int ElementTypeShape = 5;
    private const int ElementTypeImageReference = 7;
    private const int ElementTypeTable = 9;
    private const int FillTypeSolid = 1;
    private const int FillTypeGradient = 2;
    private const int FillTypePicture = 4;
    private const int ColorTypeRgb = 1;
    private const int ColorTypeScheme = 2;
    private const int ColorTypeSystem = 3;
    private const int GradientKindLinear = 1;
    private const int EffectTypeShadow = 1;
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
        var slideParts = ResolveSlideParts(presentationPart, slideIds).Take(OpenXmlReaderLimits.MaxSlides).ToList();
        var slideLayoutParts = DistinctByUri(slideParts.Select(part => part.SlideLayoutPart)).ToList();
        var slideMasterParts = DistinctByUri(slideLayoutParts.Select(part => part?.SlideMasterPart)).ToList();
        var themePart = slideMasterParts.Select(part => part.ThemePart).FirstOrDefault(part => part is not null);
        var imageParts = DistinctByUri(slideParts.SelectMany(part => part.ImageParts))
            .OrderBy(part => part.Uri.OriginalString, StringComparer.Ordinal)
            .ToList();

        return Message(output =>
        {
            var slideIndex = 1;
            foreach (var slidePart in slideParts)
            {
                WriteMessage(output, 1, WriteSlide(slidePart, slideIndex, widthEmu, heightEmu));
                slideIndex++;
            }

            var theme = WriteTheme(themePart);
            if (theme is not null)
            {
                WriteMessage(output, 2, theme);
            }

            foreach (var slideMasterPart in slideMasterParts)
            {
                WriteMessage(output, 3, WriteSlideMasterLayout(slideMasterPart));
            }

            foreach (var slideLayoutPart in slideLayoutParts)
            {
                WriteMessage(output, 3, WriteSlideLayout(slideLayoutPart));
            }

            foreach (var imagePart in imageParts)
            {
                WriteMessage(output, 4, WriteRootImage(imagePart));
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

            foreach (var element in ExtractElements(slidePart.Slide.CommonSlideData?.ShapeTree, slidePart))
            {
                WriteMessage(output, 3, element);
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

    private static byte[]? WriteTheme(ThemePart? themePart)
    {
        var themeElements = themePart?.Theme?.ThemeElements;
        if (themeElements is null)
        {
            return null;
        }

        return Message(output =>
        {
            var colorScheme = themeElements.ColorScheme;
            if (colorScheme is not null)
            {
                WriteMessage(output, 1, WriteColorScheme(colorScheme));
            }

            var formatScheme = themeElements.FormatScheme;
            foreach (var fill in formatScheme?.BackgroundFillStyleList?.ChildElements ?? Enumerable.Empty<OpenXmlElement>())
            {
                var fillProto = WriteFillFromElement(fill);
                if (fillProto is not null)
                {
                    WriteMessage(output, 2, fillProto);
                }
            }

            foreach (var line in formatScheme?.LineStyleList?.Elements<A.Outline>() ?? Enumerable.Empty<A.Outline>())
            {
                WriteMessage(output, 3, WriteLine(line));
            }

            foreach (var effectStyle in formatScheme?.EffectStyleList?.Elements<A.EffectStyle>() ?? Enumerable.Empty<A.EffectStyle>())
            {
                WriteMessage(output, 4, WriteEffectStyle(effectStyle));
            }
        });
    }

    private static byte[] WriteSlideMasterLayout(SlideMasterPart slideMasterPart)
    {
        return Message(output =>
        {
            WriteString(output, 1, slideMasterPart.Uri.OriginalString);
            WriteString(output, 9, "master");
            var colorMap = slideMasterPart.SlideMaster.ColorMap;
            if (colorMap is not null)
            {
                WriteMessage(output, 16, WriteColorMap(colorMap));
            }
        });
    }

    private static byte[] WriteSlideLayout(SlideLayoutPart slideLayoutPart)
    {
        return Message(output =>
        {
            WriteString(output, 1, slideLayoutPart.Uri.OriginalString);
            WriteString(output, 8, slideLayoutPart.SlideLayout.CommonSlideData?.Name?.Value);
            var background = SolidFillFromBackground(slideLayoutPart.SlideLayout.CommonSlideData?.Background);
            if (background is not null)
            {
                WriteMessage(output, 10, WriteBackground(background));
            }

            WriteString(output, 15, slideLayoutPart.SlideMasterPart?.Uri.OriginalString);
        });
    }

    private static IEnumerable<SlidePart> ResolveSlideParts(PresentationPart? presentationPart, IEnumerable<P.SlideId> slideIds)
    {
        if (presentationPart is null)
        {
            yield break;
        }

        foreach (var slideId in slideIds)
        {
            var relationshipId = slideId.RelationshipId?.Value;
            if (string.IsNullOrEmpty(relationshipId))
            {
                continue;
            }

            if (presentationPart.GetPartById(relationshipId) is SlidePart slidePart)
            {
                yield return slidePart;
            }
        }
    }

    private static IEnumerable<byte[]> ExtractElements(P.ShapeTree? shapeTree, SlidePart slidePart)
    {
        if (shapeTree is null)
        {
            yield break;
        }

        var elementIndex = 0;
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
                yield return element;
                elementIndex++;
            }
        }
    }

    private static IEnumerable<T> DistinctByUri<T>(IEnumerable<T?> parts)
        where T : OpenXmlPart
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            var uri = part?.Uri.OriginalString;
            if (part is not null && uri is not null && seen.Add(uri))
            {
                yield return part;
            }
        }
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

    private static byte[]? WritePictureElement(OpenXmlPartContainer partContainer, P.Picture picture, int elementIndex)
    {
        var nonVisual = picture.NonVisualPictureProperties?.NonVisualDrawingProperties;
        var transform = picture.ShapeProperties?.Transform2D;
        var blip = picture.BlipFill?.Blip;
        var relationshipId = blip?.Embed?.Value;
        ImagePart? imagePart = null;
        if (!string.IsNullOrEmpty(relationshipId))
        {
            imagePart = partContainer.GetPartById(relationshipId) as ImagePart;
        }
        var imageId = imagePart?.Uri.OriginalString;

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            if (!string.IsNullOrEmpty(imageId))
            {
                WriteMessage(output, 3, WriteImageReference(imageId));
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Picture {elementIndex}");
            WriteInt32(output, 11, imagePart is null ? ElementTypeShape : ElementTypeImageReference);
            if (!string.IsNullOrEmpty(relationshipId) && !string.IsNullOrEmpty(imageId))
            {
                WriteMessage(output, 19, WritePictureFill(relationshipId, imageId));
            }
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
                WriteInt32(output, 11, ElementTypeTable);
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

    private static byte[] WriteColorScheme(A.ColorScheme colorScheme)
    {
        return Message(output =>
        {
            WriteString(output, 1, colorScheme.Name?.Value);
            foreach (var child in colorScheme.ChildElements)
            {
                var color = ColorFromElement(child);
                if (color is not null)
                {
                    WriteMessage(output, 2, WriteThemeColor(child.LocalName, color));
                }
            }
        });
    }

    private static byte[] WriteThemeColor(string name, ColorValue color)
    {
        return Message(output =>
        {
            WriteString(output, 1, name);
            WriteMessage(output, 2, WriteColor(color));
        });
    }

    private static byte[] WriteColorMap(P.ColorMap colorMap)
    {
        return Message(output =>
        {
            WriteString(output, 1, colorMap.Accent1?.Value.ToString());
            WriteString(output, 2, colorMap.Accent2?.Value.ToString());
            WriteString(output, 3, colorMap.Accent3?.Value.ToString());
            WriteString(output, 4, colorMap.Accent4?.Value.ToString());
            WriteString(output, 5, colorMap.Accent5?.Value.ToString());
            WriteString(output, 6, colorMap.Accent6?.Value.ToString());
            WriteString(output, 7, colorMap.Background1?.Value.ToString());
            WriteString(output, 8, colorMap.Background2?.Value.ToString());
            WriteString(output, 9, colorMap.Text1?.Value.ToString());
            WriteString(output, 10, colorMap.Text2?.Value.ToString());
            WriteString(output, 11, colorMap.Hyperlink?.Value.ToString());
            WriteString(output, 12, colorMap.FollowedHyperlink?.Value.ToString());
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

    private static byte[]? WriteFillFromElement(OpenXmlElement fill)
    {
        return fill switch
        {
            A.SolidFill solidFill => WriteFill(solidFill),
            A.GradientFill gradientFill => WriteGradientFill(gradientFill),
            _ => null,
        };
    }

    private static byte[] WriteGradientFill(A.GradientFill fill)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, FillTypeGradient);
            foreach (var stop in fill.GradientStopList?.Elements<A.GradientStop>() ?? Enumerable.Empty<A.GradientStop>())
            {
                var color = ColorFromElement(stop);
                if (color is null)
                {
                    continue;
                }

                WriteMessage(output, 3, Message(stopOutput =>
                {
                    WriteInt32(stopOutput, 1, stop.Position?.Value);
                    WriteMessage(stopOutput, 2, WriteColor(color));
                }));
            }

            var linear = fill.GetFirstChild<A.LinearGradientFill>();
            if (linear is not null)
            {
                WriteInt32(output, 5, GradientKindLinear);
                if (linear.Angle?.Value is { } angle)
                {
                    WriteDouble(output, 6, angle / 60000d);
                }
            }
        });
    }

    private static byte[] WritePictureFill(string relationshipId, string imageId)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, FillTypePicture);
            WriteString(output, 4, relationshipId);
            WriteMessage(output, 11, WriteImageReference(imageId));
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

    private static byte[] WriteEffectStyle(A.EffectStyle effectStyle)
    {
        return Message(output =>
        {
            foreach (var shadow in effectStyle.Descendants<A.OuterShadow>())
            {
                WriteMessage(output, 1, Message(effectOutput =>
                {
                    WriteInt32(effectOutput, 1, EffectTypeShadow);
                    WriteMessage(effectOutput, 2, Message(shadowOutput =>
                    {
                        var color = ColorFromElement(shadow);
                        if (color is not null)
                        {
                            WriteMessage(shadowOutput, 2, WriteColor(color));
                        }

                        WriteInt32(shadowOutput, 3, ToInt32(shadow.BlurRadius));
                        WriteInt32(shadowOutput, 4, ToInt32(shadow.Distance));
                        WriteInt32(shadowOutput, 5, shadow.Direction?.Value);
                        WriteString(shadowOutput, 6, shadow.Alignment?.Value.ToString());
                        WriteBool(shadowOutput, 7, shadow.RotateWithShape?.Value);
                    }));
                }));
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
            WriteString(output, 1, NormalizeImageContentType(imagePart.ContentType));
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

    private static byte[] WriteRootImage(ImagePart imagePart)
    {
        return Message(output =>
        {
            WriteString(output, 1, NormalizeImageContentType(imagePart.ContentType));
            using var stream = imagePart.GetStream();
            using var memory = new MemoryStream();
            stream.CopyTo(memory);
            var bytes = memory.ToArray();
            if (bytes.Length <= OpenXmlReaderLimits.MaxImageBytes)
            {
                WriteBytes(output, 2, bytes);
            }

            WriteString(output, 3, imagePart.Uri.OriginalString);
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
        return ColorFromElement(fill);
    }

    private static ColorValue? ColorFromElement(OpenXmlElement element)
    {
        var rgb = element.GetFirstChild<A.RgbColorModelHex>() ?? element.Descendants<A.RgbColorModelHex>().FirstOrDefault();
        if (rgb?.Val?.Value is { Length: > 0 } value)
        {
            return ColorValueFromElement(ColorTypeRgb, value, rgb, LastColor: null);
        }

        var scheme = element.GetFirstChild<A.SchemeColor>() ?? element.Descendants<A.SchemeColor>().FirstOrDefault();
        if (scheme?.Val?.Value is not null)
        {
            return ColorValueFromElement(ColorTypeScheme, scheme.Val.Value.ToString(), scheme, LastColor: null);
        }

        var system = element.GetFirstChild<A.SystemColor>() ?? element.Descendants<A.SystemColor>().FirstOrDefault();
        if (system?.Val?.Value is not null)
        {
            return ColorValueFromElement(
                ColorTypeSystem,
                system.Val.Value.ToString(),
                system,
                system.LastColor?.Value);
        }

        return null;
    }

    private static ColorValue ColorValueFromElement(int type, string value, OpenXmlElement element, string? LastColor)
    {
        return new ColorValue(
            type,
            value,
            LastColor,
            TintFrom(element),
            ShadeFrom(element),
            LuminanceModulationFrom(element),
            LuminanceOffsetFrom(element),
            SaturationModulationFrom(element),
            AlphaFrom(element));
    }

    private static byte[] WriteColor(ColorValue color)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, color.Type);
            WriteString(output, 2, color.Value);
            if (color.HasTransform)
            {
                WriteMessage(output, 3, Message(transformOutput =>
                {
                    WriteInt32(transformOutput, 1, color.Tint);
                    WriteInt32(transformOutput, 2, color.Shade);
                    WriteInt32(transformOutput, 3, color.LuminanceModulation);
                    WriteInt32(transformOutput, 4, color.LuminanceOffset);
                    WriteInt32(transformOutput, 5, color.SaturationModulation);
                    WriteInt32(transformOutput, 6, color.Alpha);
                }));
            }

            WriteString(output, 4, color.LastColor);
        });
    }

    private static int? AlphaFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.Alpha>()?.Val?.Value;
    }

    private static int? TintFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.Tint>()?.Val?.Value;
    }

    private static int? ShadeFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.Shade>()?.Val?.Value;
    }

    private static int? LuminanceModulationFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.LuminanceModulation>()?.Val?.Value;
    }

    private static int? LuminanceOffsetFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.LuminanceOffset>()?.Val?.Value;
    }

    private static int? SaturationModulationFrom(OpenXmlElement element)
    {
        return element.GetFirstChild<A.SaturationModulation>()?.Val?.Value;
    }

    private static string NormalizeImageContentType(string contentType)
    {
        return string.Equals(contentType, "image/jpeg", StringComparison.OrdinalIgnoreCase) ? "image/jpg" : contentType;
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

    private static int? ToInt32(Int64Value? value)
    {
        if (value is null)
        {
            return null;
        }

        return (int)Math.Max(int.MinValue, Math.Min(int.MaxValue, value.Value));
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

    private static void WriteDouble(CodedOutputStream output, int fieldNumber, double? value)
    {
        if (value is null or 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Fixed64);
        output.WriteDouble(value.Value);
    }

    private sealed record ColorValue(
        int Type,
        string Value,
        string? LastColor,
        int? Tint,
        int? Shade,
        int? LuminanceModulation,
        int? LuminanceOffset,
        int? SaturationModulation,
        int? Alpha)
    {
        public bool HasTransform =>
            Tint is not null ||
            Shade is not null ||
            LuminanceModulation is not null ||
            LuminanceOffset is not null ||
            SaturationModulation is not null ||
            Alpha is not null;
    }
}
