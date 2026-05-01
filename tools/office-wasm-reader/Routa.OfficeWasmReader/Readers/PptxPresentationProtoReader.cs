using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using P = DocumentFormat.OpenXml.Presentation;

namespace Routa.OfficeWasmReader;

internal static class PptxPresentationProtoReader
{
    private const int ElementTypeText = 1;
    private const int ElementTypeShape = 5;
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
    private const int FillTypeSolid = 1;
    private const int FillTypeGradient = 2;
    private const int FillTypePicture = 4;
    private const int ColorTypeRgb = 1;
    private const int ColorTypeScheme = 2;
    private const int ColorTypeSystem = 3;
    private const int GradientKindLinear = 1;
    private const int EffectTypeShadow = 1;
    private const int EffectTypeGlow = 3;
    private const int EffectTypeReflection = 4;
    private const int EffectTypeSoftEdges = 5;
    private const int LineStyleSolid = 1;
    private const int ConnectorLineCapFlat = 1;
    private const int ConnectorLineCapRound = 2;
    private const int ConnectorLineCapSquare = 3;
    private const int ConnectorLineJoinRound = 1;
    private const int ConnectorLineJoinBevel = 2;
    private const int ConnectorLineJoinMiter = 3;
    private const int ConnectorLineEndNone = 1;
    private const int ConnectorLineEndTriangle = 2;
    private const int ConnectorLineEndStealth = 3;
    private const int ConnectorLineEndDiamond = 4;
    private const int ConnectorLineEndOval = 5;
    private const int ConnectorLineEndArrow = 6;
    private const int ConnectorLineEndSmall = 1;
    private const int ConnectorLineEndMedium = 2;
    private const int ConnectorLineEndLarge = 3;

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
        var presentationParts = slideParts.Cast<OpenXmlPart>()
            .Concat(slideLayoutParts)
            .Concat(slideMasterParts)
            .ToList();
        var imageParts = DistinctByUri(presentationParts.SelectMany(ImagePartsFrom))
            .OrderBy(part => part.Uri.OriginalString, StringComparer.Ordinal)
            .ToList();
        var chartParts = DistinctByUri(presentationParts.SelectMany(ChartPartsFrom))
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

            foreach (var chartPart in chartParts)
            {
                WriteMessage(output, 9, WriteChart(chartPart));
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
            foreach (var element in ExtractElements(slideMasterPart.SlideMaster.CommonSlideData?.ShapeTree, slideMasterPart))
            {
                WriteMessage(output, 11, element);
            }

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

            foreach (var element in ExtractElements(slideLayoutPart.SlideLayout.CommonSlideData?.ShapeTree, slideLayoutPart))
            {
                WriteMessage(output, 11, element);
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

    private static IEnumerable<byte[]> ExtractElements(P.ShapeTree? shapeTree, OpenXmlPartContainer partContainer)
    {
        if (shapeTree is null)
        {
            yield break;
        }

        foreach (var element in ExtractElements(shapeTree.ChildElements, partContainer))
        {
            yield return element;
        }
    }

    private static IEnumerable<byte[]> ExtractElements(IEnumerable<OpenXmlElement> childElements, OpenXmlPartContainer partContainer)
    {
        var zIndex = 0;
        foreach (var child in childElements)
        {
            var element = child switch
            {
                P.Shape shape => WriteShapeElement(shape, zIndex),
                P.Picture picture => WritePictureElement(partContainer, picture, zIndex),
                P.GraphicFrame graphicFrame => WriteGraphicFrameElement(partContainer, graphicFrame, zIndex),
                P.ConnectionShape connectionShape => WriteConnectionShapeElement(connectionShape, zIndex),
                P.GroupShape groupShape => WriteGroupShapeElement(partContainer, groupShape, zIndex),
                _ => null,
            };

            if (element is not null)
            {
                yield return element;
            }

            zIndex++;
        }
    }

    private static IEnumerable<ImagePart> ImagePartsFrom(OpenXmlPart part)
    {
        return part switch
        {
            SlidePart slidePart => slidePart.ImageParts,
            SlideLayoutPart slideLayoutPart => slideLayoutPart.ImageParts,
            SlideMasterPart slideMasterPart => slideMasterPart.ImageParts,
            _ => Enumerable.Empty<ImagePart>(),
        };
    }

    private static IEnumerable<ChartPart> ChartPartsFrom(OpenXmlPart part)
    {
        return part switch
        {
            SlidePart slidePart => slidePart.ChartParts,
            SlideLayoutPart slideLayoutPart => slideLayoutPart.ChartParts,
            SlideMasterPart slideMasterPart => slideMasterPart.ChartParts,
            _ => Enumerable.Empty<ChartPart>(),
        };
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

    private static byte[]? WriteShapeElement(P.Shape shape, int zIndex)
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

            WriteInt32Always(output, 2, zIndex);

            var fill = SolidFillFromProperties(shapeProperties);
            var line = OutlineFromProperties(shapeProperties);
            var shapeProto = WriteShape(shapeProperties, fill, line);
            WriteMessage(output, 4, shapeProto);

            foreach (var paragraph in paragraphs)
            {
                WriteMessage(output, 6, paragraph);
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Shape {zIndex}");
            WriteInt32(output, 11, hasText ? ElementTypeText : ElementTypeShape);
            if (fill is not null)
            {
                WriteMessage(output, 19, WriteFill(fill));
            }

            foreach (var effect in ExtractEffects(shapeProperties))
            {
                WriteMessage(output, 15, effect);
            }

            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (zIndex + 1).ToString());
            if (line is not null)
            {
                WriteMessage(output, 30, WriteLine(line));
            }
        });
    }

    private static byte[]? WritePictureElement(OpenXmlPartContainer partContainer, P.Picture picture, int zIndex)
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

            WriteInt32Always(output, 2, zIndex);

            if (!string.IsNullOrEmpty(imageId))
            {
                WriteMessage(output, 3, WriteImageReference(imageId));
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Picture {zIndex}");
            WriteInt32(output, 11, imagePart is null ? ElementTypeShape : ElementTypeImageReference);
            if (!string.IsNullOrEmpty(relationshipId) && !string.IsNullOrEmpty(imageId))
            {
                WriteMessage(output, 19, WritePictureFill(relationshipId, imageId));
            }

            foreach (var effect in ExtractEffects(picture.ShapeProperties))
            {
                WriteMessage(output, 15, effect);
            }

            var imageMask = WriteImageMask(picture);
            if (imageMask is not null)
            {
                WriteMessage(output, 33, imageMask);
            }

            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (zIndex + 1).ToString());
        });
    }

    private static byte[]? WriteGraphicFrameElement(OpenXmlPartContainer partContainer, P.GraphicFrame graphicFrame, int zIndex)
    {
        var nonVisual = graphicFrame.NonVisualGraphicFrameProperties?.NonVisualDrawingProperties;
        var transform = graphicFrame.Transform;
        var table = graphicFrame.Descendants<A.Table>().FirstOrDefault();
        var chartReference = graphicFrame.Descendants<C.ChartReference>().FirstOrDefault();
        if (transform is null && table is null && chartReference is null && !IsSmartArt(graphicFrame))
        {
            return null;
        }

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            WriteInt32Always(output, 2, zIndex);

            if (chartReference is not null)
            {
                var chartId = ResolveChartId(partContainer, chartReference);
                if (!string.IsNullOrEmpty(chartId))
                {
                    WriteMessage(output, 18, WriteChartReference(chartId));
                    WriteInt32(output, 11, ElementTypeChartReference);
                }
                else
                {
                    WriteInt32(output, 11, ElementTypeShape);
                }
            }
            else if (table is not null)
            {
                WriteMessage(output, 21, WriteTable(table));
                WriteInt32(output, 11, ElementTypeTable);
            }
            else if (IsSmartArt(graphicFrame))
            {
                foreach (var child in ExtractSmartArtChildren(partContainer, graphicFrame))
                {
                    WriteMessage(output, 17, child);
                }

                WriteInt32(output, 11, ElementTypeShape);
            }
            else
            {
                WriteInt32(output, 11, ElementTypeShape);
            }

            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Graphic Frame {zIndex}");
            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (zIndex + 1).ToString());
        });
    }

    private static byte[]? WriteConnectionShapeElement(P.ConnectionShape connectionShape, int zIndex)
    {
        var nonVisual = connectionShape.NonVisualConnectionShapeProperties?.NonVisualDrawingProperties;
        var properties = connectionShape.ShapeProperties;
        var transform = properties?.Transform2D;
        var line = OutlineFromProperties(properties);

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            WriteInt32Always(output, 2, zIndex);
            WriteMessage(output, 4, WriteShape(properties, null, line));
            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Connector {zIndex}");
            WriteInt32(output, 11, ElementTypeShape);
            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (zIndex + 1).ToString());
            WriteMessage(output, 28, WriteConnector(connectionShape, line));
            if (line is not null)
            {
                WriteMessage(output, 30, WriteLine(line));
            }
        });
    }

    private static byte[]? WriteGroupShapeElement(OpenXmlPartContainer partContainer, P.GroupShape groupShape, int zIndex)
    {
        var nonVisual = groupShape.NonVisualGroupShapeProperties?.NonVisualDrawingProperties;
        var transform = groupShape.GroupShapeProperties?.GetFirstChild<A.TransformGroup>();
        var children = ExtractElements(groupShape.ChildElements, partContainer).ToList();
        if (transform is null && children.Count == 0)
        {
            return null;
        }

        return Message(output =>
        {
            if (transform is not null)
            {
                WriteMessage(output, 1, WriteBoundingBox(transform));
            }

            WriteInt32Always(output, 2, zIndex);
            WriteString(output, 10, nonVisual?.Name?.Value ?? $"Group {zIndex}");
            WriteInt32(output, 11, ElementTypeShape);
            foreach (var child in children)
            {
                WriteMessage(output, 17, child);
            }

            WriteString(output, 27, nonVisual?.Id?.Value.ToString() ?? (zIndex + 1).ToString());
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

    private static byte[] WriteBoundingBox(A.TransformGroup transform)
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

    private static byte[]? WriteImageMask(P.Picture picture)
    {
        var sourceRectangle = picture.BlipFill?.SourceRectangle;
        var geometry = picture.ShapeProperties?.GetFirstChild<A.PresetGeometry>()?.Preset?.Value.ToString();
        var hasCrop =
            sourceRectangle?.Left is not null ||
            sourceRectangle?.Top is not null ||
            sourceRectangle?.Right is not null ||
            sourceRectangle?.Bottom is not null;
        if (!hasCrop && string.IsNullOrEmpty(geometry))
        {
            return null;
        }

        return Message(output =>
        {
            WriteString(output, 1, geometry);
            WriteInt32(output, 2, ToInt32(sourceRectangle?.Left));
            WriteInt32(output, 3, ToInt32(sourceRectangle?.Top));
            WriteInt32(output, 4, ToInt32(sourceRectangle?.Right));
            WriteInt32(output, 5, ToInt32(sourceRectangle?.Bottom));
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
            var rowIndex = 0;
            foreach (var row in table.Elements<A.TableRow>().Take(OpenXmlReaderLimits.MaxRowsPerTable))
            {
                WriteMessage(output, 1, WriteTableRow(row, rowIndex));
                rowIndex++;
            }

            foreach (var column in table.TableGrid?.Elements<A.GridColumn>() ?? Enumerable.Empty<A.GridColumn>())
            {
                if (column.Width?.Value is { } width)
                {
                    WriteInt32Always(output, 2, (int)Math.Min(int.MaxValue, width));
                }
            }

            var properties = WriteTableProperties(table);
            if (properties is not null)
            {
                WriteMessage(output, 3, properties);
            }
        });
    }

    private static byte[] WriteTableRow(A.TableRow row, int rowIndex)
    {
        return Message(rowOutput =>
        {
            var cellIndex = 0;
            foreach (var cell in row.Elements<A.TableCell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
            {
                WriteMessage(rowOutput, 1, WriteTableCell(cell, rowIndex, cellIndex));
                cellIndex++;
            }

            WriteInt32(rowOutput, 2, ToInt32(row.Height));
            WriteString(rowOutput, 3, $"table-row-{rowIndex:x8}");
        });
    }

    private static byte[] WriteTableCell(A.TableCell cell, int rowIndex, int cellIndex)
    {
        return Message(cellOutput =>
        {
            var text = TextNormalization.Clean(string.Join("\n", cell.TextBody?.Elements<A.Paragraph>().Select(ParagraphText) ?? []));
            WriteString(cellOutput, 1, text);
            foreach (var paragraph in ExtractParagraphs(cell.TextBody))
            {
                WriteMessage(cellOutput, 3, paragraph);
            }

            var fill = SolidFillFromProperties(cell.TableCellProperties);
            if (fill is not null)
            {
                WriteMessage(cellOutput, 5, WriteFill(fill));
            }

            var borders = WriteTableCellLines(cell.TableCellProperties);
            if (borders is not null)
            {
                WriteMessage(cellOutput, 6, borders);
            }

            WriteString(cellOutput, 7, $"table-cell-{rowIndex:x4}-{cellIndex:x4}");
            WriteInt32(cellOutput, 8, cell.GridSpan?.Value);
            WriteInt32(cellOutput, 9, cell.RowSpan?.Value);
            WriteBoolValue(cellOutput, 10, cell.HorizontalMerge?.Value);
            WriteBoolValue(cellOutput, 11, cell.VerticalMerge?.Value);
            WriteString(cellOutput, 12, cell.TableCellProperties?.Vertical?.Value.ToString());
            WriteInt32(cellOutput, 13, ToInt32(cell.TableCellProperties?.LeftMargin));
            WriteInt32(cellOutput, 14, ToInt32(cell.TableCellProperties?.RightMargin));
            WriteInt32(cellOutput, 15, ToInt32(cell.TableCellProperties?.TopMargin));
            WriteInt32(cellOutput, 16, ToInt32(cell.TableCellProperties?.BottomMargin));
            WriteString(cellOutput, 17, cell.TableCellProperties?.Anchor?.Value.ToString());
            WriteBoolValue(cellOutput, 18, cell.TableCellProperties?.AnchorCenter?.Value);
            WriteString(cellOutput, 19, cell.TableCellProperties?.HorizontalOverflow?.Value.ToString());
        });
    }

    private static byte[]? WriteTableProperties(A.Table table)
    {
        var properties = table.TableProperties;
        if (properties is null)
        {
            return null;
        }

        var fill = SolidFillFromProperties(properties);
        return Message(output =>
        {
            if (fill is not null)
            {
                WriteMessage(output, 1, WriteFill(fill));
            }

            WriteBoolValue(output, 2, properties.RightToLeft?.Value);
            WriteBoolValue(output, 3, properties.FirstRow?.Value);
            WriteBoolValue(output, 4, properties.FirstColumn?.Value);
            WriteBoolValue(output, 5, properties.LastRow?.Value);
            WriteBoolValue(output, 6, properties.LastColumn?.Value);
            WriteBoolValue(output, 7, properties.BandRow?.Value);
            WriteBoolValue(output, 8, properties.BandColumn?.Value);
            WriteString(output, 9, properties.GetFirstChild<A.TableStyleId>()?.Text);
            foreach (var effect in ExtractEffects(properties))
            {
                WriteMessage(output, 10, effect);
            }
        });
    }

    private static byte[]? WriteTableCellLines(A.TableCellProperties? properties)
    {
        if (properties is null)
        {
            return null;
        }

        var top = OutlineFromProperties(properties.GetFirstChild<A.TopBorderLineProperties>());
        var right = OutlineFromProperties(properties.GetFirstChild<A.RightBorderLineProperties>());
        var bottom = OutlineFromProperties(properties.GetFirstChild<A.BottomBorderLineProperties>());
        var left = OutlineFromProperties(properties.GetFirstChild<A.LeftBorderLineProperties>());
        var diagonalDown = OutlineFromProperties(properties.GetFirstChild<A.BottomLeftToTopRightBorderLineProperties>());
        var diagonalUp = OutlineFromProperties(properties.GetFirstChild<A.TopLeftToBottomRightBorderLineProperties>());
        if (top is null && right is null && bottom is null && left is null && diagonalDown is null && diagonalUp is null)
        {
            return null;
        }

        return Message(output =>
        {
            if (top is not null) WriteMessage(output, 1, WriteLine(top));
            if (right is not null) WriteMessage(output, 2, WriteLine(right));
            if (bottom is not null) WriteMessage(output, 3, WriteLine(bottom));
            if (left is not null) WriteMessage(output, 4, WriteLine(left));
            if (diagonalDown is not null) WriteMessage(output, 5, WriteLine(diagonalDown));
            if (diagonalUp is not null) WriteMessage(output, 6, WriteLine(diagonalUp));
        });
    }

    private static string ParagraphText(A.Paragraph paragraph)
    {
        return TextNormalization.Clean(string.Concat(paragraph.Descendants<A.Text>().Select(text => text.Text)));
    }

    private static string ResolveChartId(OpenXmlPartContainer partContainer, C.ChartReference chartReference)
    {
        var relationshipId = chartReference.Id?.Value;
        if (string.IsNullOrEmpty(relationshipId))
        {
            return "";
        }

        return partContainer.GetPartById(relationshipId) is ChartPart chartPart
            ? chartPart.Uri.OriginalString
            : relationshipId;
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
            WriteBoolValue(output, 11, chartSpace?.Descendants<C.Legend>().Any());
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

            var fill = series.Element.Descendants<A.SolidFill>().FirstOrDefault();
            if (fill is not null)
            {
                WriteMessage(output, 7, WriteFill(fill));
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

    private static byte[] WriteConnector(P.ConnectionShape connectionShape, A.Outline? line)
    {
        var connectorProperties =
            connectionShape.NonVisualConnectionShapeProperties?.NonVisualConnectorShapeDrawingProperties;

        return Message(output =>
        {
            var startConnection = connectorProperties?.StartConnection;
            var endConnection = connectorProperties?.EndConnection;
            WriteString(output, 1, startConnection?.Id?.Value.ToString());
            WriteInt32(output, 2, ToInt32(startConnection?.Index));
            WriteString(output, 3, endConnection?.Id?.Value.ToString());
            WriteInt32(output, 4, ToInt32(endConnection?.Index));
            var lineStyle = WriteConnectorLineStyle(line);
            if (lineStyle is not null)
            {
                WriteMessage(output, 5, lineStyle);
            }
        });
    }

    private static byte[]? WriteConnectorLineStyle(A.Outline? line)
    {
        if (line is null)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 5, ConnectorLineCap(line.CapType?.Value.ToString()));
            WriteInt32(output, 6, ConnectorLineJoin(line));
            var head = WriteConnectorLineEnd(line.GetFirstChild<A.HeadEnd>());
            if (head is not null)
            {
                WriteMessage(output, 7, head);
            }

            var tail = WriteConnectorLineEnd(line.GetFirstChild<A.TailEnd>());
            if (tail is not null)
            {
                WriteMessage(output, 8, tail);
            }
        });
    }

    private static byte[]? WriteConnectorLineEnd(A.HeadEnd? end)
    {
        if (end is null)
        {
            return null;
        }

        return WriteConnectorLineEnd(end.Type?.Value.ToString(), end.Width?.Value.ToString(), end.Length?.Value.ToString());
    }

    private static byte[]? WriteConnectorLineEnd(A.TailEnd? end)
    {
        if (end is null)
        {
            return null;
        }

        return WriteConnectorLineEnd(end.Type?.Value.ToString(), end.Width?.Value.ToString(), end.Length?.Value.ToString());
    }

    private static byte[]? WriteConnectorLineEnd(string? type, string? width, string? length)
    {
        var mappedType = ConnectorLineEndType(type);
        var mappedWidth = ConnectorLineEndSize(width);
        var mappedLength = ConnectorLineEndSize(length);
        if (mappedType == 0 && mappedWidth == 0 && mappedLength == 0)
        {
            return null;
        }

        return Message(output =>
        {
            WriteInt32(output, 1, mappedType);
            WriteInt32(output, 2, mappedWidth);
            WriteInt32(output, 3, mappedLength);
        });
    }

    private static int ConnectorLineCap(string? value)
    {
        return value switch
        {
            "flat" => ConnectorLineCapFlat,
            "round" => ConnectorLineCapRound,
            "square" => ConnectorLineCapSquare,
            _ => 0,
        };
    }

    private static int ConnectorLineJoin(A.Outline line)
    {
        if (line.GetFirstChild<A.Round>() is not null) return ConnectorLineJoinRound;
        if (line.GetFirstChild<A.Bevel>() is not null) return ConnectorLineJoinBevel;
        if (line.GetFirstChild<A.Miter>() is not null) return ConnectorLineJoinMiter;
        return 0;
    }

    private static int ConnectorLineEndType(string? value)
    {
        return value switch
        {
            "none" => ConnectorLineEndNone,
            "triangle" => ConnectorLineEndTriangle,
            "stealth" => ConnectorLineEndStealth,
            "diamond" => ConnectorLineEndDiamond,
            "oval" => ConnectorLineEndOval,
            "arrow" => ConnectorLineEndArrow,
            _ => 0,
        };
    }

    private static int ConnectorLineEndSize(string? value)
    {
        return value switch
        {
            "sm" => ConnectorLineEndSmall,
            "med" => ConnectorLineEndMedium,
            "lg" => ConnectorLineEndLarge,
            _ => 0,
        };
    }

    private static IEnumerable<byte[]> ExtractEffects(OpenXmlElement? element)
    {
        if (element is null)
        {
            yield break;
        }

        foreach (var shadow in element.Descendants<A.OuterShadow>())
        {
            yield return WriteShadowEffect(shadow);
        }

        foreach (var glow in element.Descendants<A.Glow>())
        {
            yield return WriteGlowEffect(glow);
        }

        foreach (var reflection in element.Descendants<A.Reflection>())
        {
            yield return WriteReflectionEffect(reflection);
        }

        foreach (var softEdges in element.Descendants<A.SoftEdge>())
        {
            yield return WriteSoftEdgesEffect(softEdges);
        }
    }

    private static byte[] WriteShadowEffect(A.OuterShadow shadow)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, EffectTypeShadow);
            WriteMessage(output, 2, Message(shadowOutput =>
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
                WriteBoolValue(shadowOutput, 7, shadow.RotateWithShape?.Value);
            }));
        });
    }

    private static byte[] WriteGlowEffect(A.Glow glow)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, EffectTypeGlow);
            WriteMessage(output, 3, Message(glowOutput =>
            {
                var color = ColorFromElement(glow);
                if (color is not null)
                {
                    WriteMessage(glowOutput, 1, WriteColor(color));
                }

                WriteInt64(glowOutput, 2, ToLong(glow.Radius));
            }));
        });
    }

    private static byte[] WriteReflectionEffect(A.Reflection reflection)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, EffectTypeReflection);
            WriteMessage(output, 4, Message(reflectionOutput =>
            {
                WriteInt64(reflectionOutput, 1, ToLong(reflection.BlurRadius));
                WriteInt32(reflectionOutput, 2, reflection.StartOpacity?.Value);
                WriteInt32(reflectionOutput, 3, reflection.StartPosition?.Value);
                WriteInt32(reflectionOutput, 4, reflection.EndAlpha?.Value);
                WriteInt32(reflectionOutput, 5, reflection.EndPosition?.Value);
                WriteInt64(reflectionOutput, 6, ToLong(reflection.Distance));
                WriteInt32(reflectionOutput, 7, reflection.Direction?.Value);
                WriteInt32(reflectionOutput, 8, reflection.FadeDirection?.Value);
                WriteInt32(reflectionOutput, 9, reflection.HorizontalRatio?.Value);
                WriteInt32(reflectionOutput, 10, reflection.VerticalRatio?.Value);
                WriteInt32(reflectionOutput, 11, reflection.HorizontalSkew?.Value);
                WriteInt32(reflectionOutput, 12, reflection.VerticalSkew?.Value);
                WriteString(reflectionOutput, 13, reflection.Alignment?.Value.ToString());
                WriteBoolValue(reflectionOutput, 14, reflection.RotateWithShape?.Value);
            }));
        });
    }

    private static byte[] WriteSoftEdgesEffect(A.SoftEdge softEdges)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, EffectTypeSoftEdges);
            WriteMessage(output, 5, Message(softEdgesOutput =>
            {
                WriteInt64(softEdgesOutput, 1, ToLong(softEdges.Radius));
            }));
        });
    }

    private static bool IsSmartArt(P.GraphicFrame graphicFrame)
    {
        return graphicFrame.Descendants<A.GraphicData>()
            .Any(data => data.Uri?.Value?.Contains("/diagram", StringComparison.OrdinalIgnoreCase) == true);
    }

    private static IEnumerable<byte[]> ExtractSmartArtChildren(OpenXmlPartContainer partContainer, P.GraphicFrame graphicFrame)
    {
        var relationshipIds = graphicFrame.Descendants<A.GraphicData>()
            .Where(data => data.Uri?.Value?.Contains("/diagram", StringComparison.OrdinalIgnoreCase) == true)
            .SelectMany(data => data.Descendants())
            .SelectMany(element => element.GetAttributes())
            .Where(attribute => string.Equals(attribute.LocalName, "dm", StringComparison.OrdinalIgnoreCase))
            .Select(attribute => attribute.Value)
            .Where(value => !string.IsNullOrEmpty(value))
            .Select(value => value!);
        var childIndex = 0;
        foreach (var relationshipId in relationshipIds)
        {
            if (partContainer.GetPartById(relationshipId) is not OpenXmlPart diagramPart)
            {
                continue;
            }

            foreach (var paragraph in diagramPart.RootElement?.Descendants<A.Paragraph>() ?? Enumerable.Empty<A.Paragraph>())
            {
                var paragraphProto = Message(output =>
                {
                    WriteMessage(output, 1, Message(runOutput =>
                    {
                        WriteString(runOutput, 1, ParagraphText(paragraph));
                        WriteString(runOutput, 4, $"smart-art-run-{childIndex:x8}");
                    }));
                    WriteString(output, 9, $"smart-art-paragraph-{childIndex:x8}");
                });

                yield return Message(output =>
                {
                    WriteMessage(output, 6, paragraphProto);
                    WriteString(output, 10, $"SmartArt Text {childIndex + 1}");
                    WriteInt32(output, 11, ElementTypeText);
                    WriteString(output, 27, $"smart-art-{childIndex:x8}");
                });
                childIndex++;
            }
        }
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

    private static int? ToInt32(Int32Value? value)
    {
        return value?.Value;
    }

    private static int? ToInt32(UInt32Value? value)
    {
        if (value is null)
        {
            return null;
        }

        return value.Value > int.MaxValue ? int.MaxValue : (int)value.Value;
    }

    private static double ParseDouble(string? value)
    {
        return double.TryParse(value, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : double.NaN;
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

    private static void WriteBool(CodedOutputStream output, int fieldNumber, bool? value)
    {
        if (value != true)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteBool(true);
    }

    private static void WriteBoolValue(CodedOutputStream output, int fieldNumber, bool? value)
    {
        if (value is null)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteBool(value.Value);
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

    private sealed record ChartSeriesData(
        string Id,
        string Name,
        IReadOnlyList<string> Categories,
        IReadOnlyList<double> Values,
        OpenXmlElement Element);
}
