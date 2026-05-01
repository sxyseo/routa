using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml;
using S = DocumentFormat.OpenXml.Spreadsheet;

namespace Routa.OfficeWasmReader;

internal static class XlsxArtifactReader
{
    public static OfficeArtifactModel Read(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var document = SpreadsheetDocument.Open(stream, false);

        var artifact = new OfficeArtifactModel
        {
            SourceKind = "xlsx",
            Title = TextNormalization.Clean(document.PackageProperties.Title),
        };
        artifact.Metadata["reader"] = "routa-office-wasm-reader";

        var workbookPart = document.WorkbookPart;
        if (workbookPart?.Workbook.Sheets is null)
        {
            artifact.Diagnostics.Add(new DiagnosticModel("warning", "XLSX has no workbook sheets."));
            return artifact;
        }

        var sharedStrings = workbookPart.SharedStringTablePart?.SharedStringTable;
        foreach (var sheetElement in workbookPart.Workbook.Sheets.Elements<S.Sheet>())
        {
            if (artifact.Sheets.Count >= OpenXmlReaderLimits.MaxSheets)
            {
                artifact.Diagnostics.Add(new DiagnosticModel("warning", "XLSX sheet limit reached."));
                break;
            }

            var relationshipId = sheetElement.Id?.Value;
            if (string.IsNullOrEmpty(relationshipId))
            {
                continue;
            }

            if (workbookPart.GetPartById(relationshipId) is not WorksheetPart worksheetPart)
            {
                continue;
            }

            var sheet = new SheetModel
            {
                Name = TextNormalization.Clean(sheetElement.Name?.Value) is { Length: > 0 } name ? name : $"Sheet {artifact.Sheets.Count + 1}",
            };
            artifact.Title = FirstNonEmpty(artifact.Title, sheet.Name);

            foreach (var rowElement in worksheetPart.Worksheet.Descendants<S.Row>().Take(OpenXmlReaderLimits.MaxRowsPerSheet))
            {
                var row = new RowModel();
                foreach (var cellElement in rowElement.Elements<S.Cell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
                {
                    row.Cells.Add(new CellModel(
                        cellElement.CellReference?.Value ?? "",
                        ReadCellText(cellElement, sharedStrings),
                        TextNormalization.Clean(cellElement.CellFormula?.Text)));
                }

                if (row.Cells.Count > 0)
                {
                    sheet.Rows.Add(row);
                }
            }

            ExtractSheetFeatures(worksheetPart, sheet);
            artifact.Sheets.Add(sheet);
        }

        ExtractImages(workbookPart, artifact);
        ExtractCharts(workbookPart, artifact);

        artifact.Metadata["sheetCount"] = artifact.Sheets.Count.ToString();
        artifact.Metadata["imageCount"] = artifact.Images.Count.ToString();
        artifact.Metadata["chartCount"] = artifact.Charts.Count.ToString();
        return artifact;
    }

    private static string ReadCellText(S.Cell cell, S.SharedStringTable? sharedStrings)
    {
        var raw = cell.CellValue?.Text ?? cell.InnerText;
        if (string.IsNullOrEmpty(raw))
        {
            return "";
        }

        if (cell.DataType?.Value == S.CellValues.SharedString && int.TryParse(raw, out var sharedStringIndex))
        {
            return TextNormalization.Clean(sharedStrings?.Elements<S.SharedStringItem>().ElementAtOrDefault(sharedStringIndex)?.InnerText);
        }

        if (cell.DataType?.Value == S.CellValues.Boolean)
        {
            return raw == "1" ? "TRUE" : "FALSE";
        }

        return TextNormalization.Clean(raw);
    }

    private static void ExtractImages(WorkbookPart workbookPart, OfficeArtifactModel artifact)
    {
        foreach (var worksheetPart in workbookPart.WorksheetParts)
        {
            var drawingPart = worksheetPart.DrawingsPart;
            if (drawingPart is null)
            {
                continue;
            }

            foreach (var imagePart in drawingPart.ImageParts)
            {
                if (artifact.Images.Count >= OpenXmlReaderLimits.MaxImages)
                {
                    artifact.Diagnostics.Add(new DiagnosticModel("warning", "XLSX image limit reached."));
                    return;
                }

                var image = OpenXmlImageReader.Read(drawingPart, imagePart, $"worksheets.image[{artifact.Images.Count}]");
                if (image is not null)
                {
                    artifact.Images.Add(image);
                }
            }
        }
    }

    private static void ExtractCharts(WorkbookPart workbookPart, OfficeArtifactModel artifact)
    {
        foreach (var drawingPart in workbookPart.WorksheetParts.Select(part => part.DrawingsPart).Where(part => part is not null))
        {
            foreach (var chartPart in drawingPart!.ChartParts)
            {
                var chart = OpenXmlChartReader.Read(drawingPart, chartPart, $"worksheets.chart[{artifact.Charts.Count}]");
                if (chart is not null)
                {
                    artifact.Charts.Add(chart);
                }
            }
        }
    }

    private static void ExtractSheetFeatures(WorksheetPart worksheetPart, SheetModel sheet)
    {
        foreach (var mergeCell in worksheetPart.Worksheet.Descendants<S.MergeCell>())
        {
            var reference = mergeCell.Reference?.Value;
            if (!string.IsNullOrWhiteSpace(reference))
            {
                sheet.MergedRanges.Add(new MergedRangeModel(reference));
            }
        }

        foreach (var tablePart in worksheetPart.TableDefinitionParts)
        {
            var table = tablePart.Table;
            sheet.Tables.Add(new SheetTableModel(
                table?.Name?.Value ?? table?.DisplayName?.Value ?? "",
                table?.Reference?.Value ?? ""));
        }

        foreach (var validation in worksheetPart.Worksheet.Descendants<S.DataValidation>())
        {
            sheet.DataValidations.Add(new DataValidationModel(
                validation.Type?.Value.ToString() ?? "",
                validation.Operator?.Value.ToString() ?? "",
                TextNormalization.Clean(validation.Formula1?.Text),
                TextNormalization.Clean(validation.Formula2?.Text),
                SplitReferences(validation.GetAttribute("sqref", "").Value ?? "")));
        }

        foreach (var formatting in worksheetPart.Worksheet.Descendants<S.ConditionalFormatting>())
        {
            var ranges = SplitReferences(formatting.GetAttribute("sqref", "").Value ?? "");
            foreach (var rule in formatting.Elements<S.ConditionalFormattingRule>())
            {
                sheet.ConditionalFormats.Add(new ConditionalFormatModel(
                    rule.Type?.Value.ToString() ?? "",
                    (uint)(rule.Priority?.Value ?? 0),
                    ranges));
            }
        }
    }

    private static IReadOnlyList<string> SplitReferences(string value)
    {
        return value
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToArray();
    }

    private static string FirstNonEmpty(string current, string candidate)
    {
        return string.IsNullOrWhiteSpace(current) ? candidate : current;
    }
}
