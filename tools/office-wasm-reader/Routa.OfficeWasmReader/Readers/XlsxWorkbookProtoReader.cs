using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using S = DocumentFormat.OpenXml.Spreadsheet;

namespace Routa.OfficeWasmReader;

internal static class XlsxWorkbookProtoReader
{
    public static byte[] Read(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        using var document = SpreadsheetDocument.Open(stream, false);
        var workbookPart = document.WorkbookPart;
        if (workbookPart?.Workbook.Sheets is null)
        {
            return Message(_ => { });
        }

        var sharedStrings = workbookPart.SharedStringTablePart?.SharedStringTable;
        var stylesheet = workbookPart.WorkbookStylesPart?.Stylesheet;
        var sheetIndex = 0;

        return Message(output =>
        {
            foreach (var sheetElement in workbookPart.Workbook.Sheets.Elements<S.Sheet>())
            {
                var relationshipId = sheetElement.Id?.Value;
                if (string.IsNullOrEmpty(relationshipId))
                {
                    continue;
                }

                if (workbookPart.GetPartById(relationshipId) is not WorksheetPart worksheetPart)
                {
                    continue;
                }

                WriteMessage(output, 1, WriteSheet(worksheetPart, sheetElement, sharedStrings, stylesheet, sheetIndex));
                sheetIndex += 1;
                if (sheetIndex >= OpenXmlReaderLimits.MaxSheets)
                {
                    break;
                }
            }

            WriteMessage(output, 2, WriteStyles(stylesheet));
        });
    }

    private static byte[] WriteSheet(
        WorksheetPart worksheetPart,
        S.Sheet sheetElement,
        S.SharedStringTable? sharedStrings,
        S.Stylesheet? stylesheet,
        int sheetIndex)
    {
        var name = TextNormalization.Clean(sheetElement.Name?.Value);
        return Message(output =>
        {
            WriteInt32(output, 1, sheetIndex);
            WriteString(output, 2, name.Length > 0 ? name : $"Sheet {sheetIndex + 1}");

            foreach (var row in worksheetPart.Worksheet.Descendants<S.Row>().Take(OpenXmlReaderLimits.MaxRowsPerSheet))
            {
                WriteMessage(output, 3, WriteRow(row, sharedStrings));
            }

            foreach (var column in worksheetPart.Worksheet.Elements<S.Columns>().SelectMany(columns => columns.Elements<S.Column>()))
            {
                WriteMessage(output, 6, WriteColumn(column));
            }

            var format = worksheetPart.Worksheet.SheetFormatProperties;
            WriteFloat(output, 7, (float)(format?.DefaultRowHeight?.Value ?? 0));
            WriteFloat(output, 9, (float)(format?.DefaultColumnWidth?.Value ?? 0));

            foreach (var mergeCell in worksheetPart.Worksheet.Descendants<S.MergeCell>())
            {
                var range = WriteRangeTarget(name, mergeCell.Reference?.Value ?? "");
                if (range.Length > 0)
                {
                    WriteMessage(output, 12, range);
                }
            }

            foreach (var formatting in worksheetPart.Worksheet.Descendants<S.ConditionalFormatting>())
            {
                WriteMessage(output, 13, WriteConditionalFormatting(name, formatting));
            }

            foreach (var tablePart in worksheetPart.TableDefinitionParts)
            {
                WriteMessage(output, 15, WriteTable(tablePart.Table));
            }
        });
    }

    private static byte[] WriteRow(S.Row row, S.SharedStringTable? sharedStrings)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(row.RowIndex?.Value ?? 0));
            foreach (var cell in row.Elements<S.Cell>().Take(OpenXmlReaderLimits.MaxCellsPerRow))
            {
                WriteMessage(output, 2, WriteCell(cell, sharedStrings));
            }

            WriteFloat(output, 3, (float)(row.Height?.Value ?? 0));
            WriteBool(output, 4, row.CustomHeight?.Value ?? false);
            if (row.StyleIndex?.Value is { } styleIndex)
            {
                WriteInt32(output, 5, (int)styleIndex);
            }

            WriteBool(output, 6, row.Hidden?.Value ?? false);
        });
    }

    private static byte[] WriteCell(S.Cell cell, S.SharedStringTable? sharedStrings)
    {
        return Message(output =>
        {
            var address = cell.CellReference?.Value ?? "";
            var text = ReadCellText(cell, sharedStrings);
            WriteString(output, 1, address);
            WriteString(output, 2, text);
            WriteString(output, 3, TextNormalization.Clean(cell.CellFormula?.Text));
            WriteInt32(output, 4, CellDataType(cell, text));
            if (cell.StyleIndex?.Value is { } styleIndex)
            {
                WriteInt32(output, 5, (int)styleIndex);
            }
        });
    }

    private static byte[] WriteColumn(S.Column column)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(column.Min?.Value ?? 0));
            WriteInt32(output, 2, (int)(column.Max?.Value ?? 0));
            WriteFloat(output, 3, (float)(column.Width?.Value ?? 0));
            WriteBool(output, 4, column.CustomWidth?.Value ?? false);
            if (column.Style?.Value is { } styleIndex)
            {
                WriteInt32(output, 5, (int)styleIndex);
            }

            WriteBool(output, 6, column.Hidden?.Value ?? false);
        });
    }

    private static byte[] WriteTable(S.Table? table)
    {
        return Message(output =>
        {
            if (table is null)
            {
                return;
            }

            WriteInt32(output, 1, (int)(table.Id?.Value ?? 0));
            WriteString(output, 2, table.Name?.Value ?? table.DisplayName?.Value ?? "");
            WriteString(output, 3, table.DisplayName?.Value ?? table.Name?.Value ?? "");
            WriteString(output, 4, table.Reference?.Value ?? "");
            foreach (var column in table.TableColumns?.Elements<S.TableColumn>() ?? [])
            {
                WriteMessage(output, 5, WriteTableColumn(column));
            }

            WriteMessage(output, 6, WriteTableStyle(table.TableStyleInfo));
            if (table.TotalsRowShown?.Value is { } totalsRowShown)
            {
                WriteBool(output, 7, totalsRowShown);
            }

            if (table.HeaderRowCount?.Value is { } headerRowCount)
            {
                WriteInt32(output, 8, (int)headerRowCount);
            }

            if (table.TotalsRowCount?.Value is { } totalsRowCount)
            {
                WriteInt32(output, 9, (int)totalsRowCount);
            }

            if (table.AutoFilter is not null)
            {
                WriteMessage(output, 10, WriteAutoFilter(table.AutoFilter));
            }
        });
    }

    private static byte[] WriteTableColumn(S.TableColumn column)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(column.Id?.Value ?? 0));
            WriteString(output, 2, column.Name?.Value ?? "");
        });
    }

    private static byte[] WriteTableStyle(S.TableStyleInfo? style)
    {
        return Message(output =>
        {
            if (style is null)
            {
                return;
            }

            WriteString(output, 1, style.Name?.Value ?? "");
            if (style.ShowFirstColumn?.Value is { } showFirstColumn)
            {
                WriteBool(output, 2, showFirstColumn);
            }

            if (style.ShowLastColumn?.Value is { } showLastColumn)
            {
                WriteBool(output, 3, showLastColumn);
            }

            if (style.ShowRowStripes?.Value is { } showRowStripes)
            {
                WriteBool(output, 4, showRowStripes);
            }

            if (style.ShowColumnStripes?.Value is { } showColumnStripes)
            {
                WriteBool(output, 5, showColumnStripes);
            }
        });
    }

    private static byte[] WriteAutoFilter(S.AutoFilter autoFilter)
    {
        return Message(output =>
        {
            WriteString(output, 1, autoFilter.Reference?.Value ?? "");
            foreach (var column in autoFilter.Elements<S.FilterColumn>())
            {
                WriteMessage(output, 2, WriteFilterColumn(column));
            }
        });
    }

    private static byte[] WriteFilterColumn(S.FilterColumn column)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(column.ColumnId?.Value ?? 0));
            WriteString(output, 2, column.LocalName);
        });
    }

    private static byte[] WriteConditionalFormatting(string sheetName, S.ConditionalFormatting formatting)
    {
        var ranges = SplitReferences(formatting.GetAttribute("sqref", "").Value ?? "");
        return Message(output =>
        {
            foreach (var range in ranges)
            {
                WriteMessage(output, 1, WriteRangeTarget(sheetName, range));
            }

            foreach (var rule in formatting.Elements<S.ConditionalFormattingRule>())
            {
                WriteMessage(output, 2, WriteConditionalRule(rule));
            }
        });
    }

    private static byte[] WriteConditionalRule(S.ConditionalFormattingRule rule)
    {
        return Message(output =>
        {
            WriteString(output, 1, EnumText(rule.Type));
            WriteInt32(output, 2, (int)(rule.Priority?.Value ?? 0));
            if (rule.FormatId?.Value is { } formatId)
            {
                WriteInt32(output, 3, (int)formatId);
            }

            WriteString(output, 4, EnumText(rule.Operator));
            foreach (var formula in rule.Elements<S.Formula>())
            {
                WriteString(output, 5, TextNormalization.Clean(formula.Text));
            }

            if (rule.StopIfTrue?.Value is { } stopIfTrue)
            {
                WriteBool(output, 6, stopIfTrue);
            }

            if (rule.Percent?.Value is { } percent)
            {
                WriteBool(output, 8, percent);
            }

            var colorScale = rule.Elements<S.ColorScale>().FirstOrDefault();
            if (colorScale is not null)
            {
                WriteMessage(output, 10, WriteColorScale(colorScale));
            }

            var dataBar = rule.Elements<S.DataBar>().FirstOrDefault();
            if (dataBar is not null)
            {
                WriteMessage(output, 11, WriteDataBar(dataBar));
            }

            var iconSet = rule.Elements<S.IconSet>().FirstOrDefault();
            if (iconSet is not null)
            {
                WriteMessage(output, 12, WriteIconSet(iconSet));
            }

            WriteString(output, 13, rule.Text?.Value ?? "");
        });
    }

    private static byte[] WriteColorScale(S.ColorScale colorScale)
    {
        return Message(output =>
        {
            foreach (var threshold in colorScale.Elements<S.ConditionalFormatValueObject>())
            {
                WriteMessage(output, 1, WriteCfvo(threshold));
            }

            foreach (var color in colorScale.Elements<S.Color>())
            {
                WriteMessage(output, 2, WriteColor(color));
            }
        });
    }

    private static byte[] WriteDataBar(S.DataBar dataBar)
    {
        return Message(output =>
        {
            foreach (var threshold in dataBar.Elements<S.ConditionalFormatValueObject>())
            {
                WriteMessage(output, 1, WriteCfvo(threshold));
            }

            WriteMessage(output, 2, WriteColor(dataBar.Elements<S.Color>().FirstOrDefault()));
            WriteBool(output, 3, true);
            if (dataBar.ShowValue?.Value is { } showValue)
            {
                WriteBool(output, 6, showValue);
            }
        });
    }

    private static byte[] WriteIconSet(S.IconSet iconSet)
    {
        return Message(output =>
        {
            WriteString(output, 1, EnumText(iconSet.IconSetValue));
            if (iconSet.ShowValue?.Value is { } showValue)
            {
                WriteBool(output, 2, showValue);
            }

            if (iconSet.Reverse?.Value is { } reverse)
            {
                WriteBool(output, 3, reverse);
            }

            foreach (var threshold in iconSet.Elements<S.ConditionalFormatValueObject>())
            {
                WriteMessage(output, 5, WriteCfvo(threshold));
            }

            if (iconSet.Percent?.Value is { } percent)
            {
                WriteBool(output, 6, percent);
            }
        });
    }

    private static byte[] WriteCfvo(S.ConditionalFormatValueObject threshold)
    {
        return Message(output =>
        {
            WriteString(output, 1, EnumText(threshold.Type));
            WriteString(output, 2, threshold.Val?.Value ?? "");
            if (threshold.GreaterThanOrEqual?.Value is { } gte)
            {
                WriteBool(output, 3, gte);
            }
        });
    }

    private static byte[] WriteRangeTarget(string sheetName, string reference)
    {
        var (startAddress, endAddress) = SplitCellRange(reference);
        if (startAddress.Length == 0)
        {
            return [];
        }

        return Message(output =>
        {
            WriteString(output, 1, sheetName);
            WriteString(output, 3, startAddress);
            WriteString(output, 4, endAddress);
        });
    }

    private static byte[] WriteStyles(S.Stylesheet? stylesheet)
    {
        return Message(output =>
        {
            if (stylesheet is null)
            {
                return;
            }

            foreach (var format in stylesheet.CellFormats?.Elements<S.CellFormat>() ?? [])
            {
                WriteMessage(output, 3, WriteCellFormat(format));
            }

            foreach (var format in stylesheet.NumberingFormats?.Elements<S.NumberingFormat>() ?? [])
            {
                WriteMessage(output, 7, WriteNumberFormat(format));
            }

            foreach (var format in stylesheet.DifferentialFormats?.Elements<S.DifferentialFormat>() ?? [])
            {
                WriteMessage(output, 8, WriteDifferentialFormat(format));
            }
        });
    }

    private static byte[] WriteCellFormat(S.CellFormat format)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(format.NumberFormatId?.Value ?? 0));
            WriteInt32(output, 2, (int)(format.FontId?.Value ?? 0));
            WriteInt32(output, 3, (int)(format.FillId?.Value ?? 0));
            WriteInt32(output, 4, (int)(format.BorderId?.Value ?? 0));
            if (format.FormatId?.Value is { } formatId)
            {
                WriteInt32(output, 5, (int)formatId);
            }

            WriteString(output, 10, EnumText(format.Alignment?.Horizontal));
            WriteString(output, 11, EnumText(format.Alignment?.Vertical));
            if (format.Alignment?.WrapText?.Value is { } wrapText)
            {
                WriteBool(output, 14, wrapText);
            }
        });
    }

    private static byte[] WriteNumberFormat(S.NumberingFormat format)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, (int)(format.NumberFormatId?.Value ?? 0));
            WriteString(output, 2, format.FormatCode?.Value ?? "");
        });
    }

    private static byte[] WriteDifferentialFormat(S.DifferentialFormat format)
    {
        return Message(output =>
        {
            if (format.Fill is not null)
            {
                WriteMessage(output, 2, WriteFill(format.Fill));
            }
        });
    }

    private static byte[] WriteFill(S.Fill fill)
    {
        return Message(output =>
        {
            WriteInt32(output, 1, 3);
            WriteMessage(output, 2, WriteColor(fill.PatternFill?.ForegroundColor));
        });
    }

    private static byte[] WriteColor(OpenXmlElement? color)
    {
        var value = color?.GetAttribute("rgb", "").Value;
        return WriteColor(value);
    }

    private static byte[] WriteColor(string? value)
    {
        return Message(output =>
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? "" : value.Length == 8 ? value[2..] : value;
            WriteInt32(output, 1, 1);
            WriteString(output, 2, normalized);
        });
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

    private static int CellDataType(S.Cell cell, string text)
    {
        if (cell.DataType?.Value == S.CellValues.SharedString) return 3;
        if (cell.DataType?.Value == S.CellValues.InlineString) return 2;
        if (cell.DataType?.Value == S.CellValues.Boolean) return 4;
        if (cell.DataType?.Value == S.CellValues.Error) return 6;
        if (!string.IsNullOrEmpty(text) && double.TryParse(text, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out _)) return 5;
        return string.IsNullOrEmpty(text) ? 0 : 3;
    }

    private static (string StartAddress, string EndAddress) SplitCellRange(string reference)
    {
        var normalized = reference.Contains('!') ? reference[(reference.LastIndexOf('!') + 1)..] : reference;
        normalized = normalized.Replace("$", "", StringComparison.Ordinal).Trim();
        if (normalized.Length == 0)
        {
            return ("", "");
        }

        var parts = normalized.Split(':', 2, StringSplitOptions.TrimEntries);
        var startAddress = parts[0];
        var endAddress = parts.Length > 1 ? parts[1] : parts[0];
        return (startAddress, endAddress);
    }

    private static IReadOnlyList<string> SplitReferences(string value)
    {
        return value
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToArray();
    }

    private static string EnumText(OpenXmlSimpleType? value)
    {
        return value?.InnerText ?? "";
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

    private static void WriteInt32(CodedOutputStream output, int fieldNumber, int value)
    {
        if (value == 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteInt32(value);
    }

    private static void WriteFloat(CodedOutputStream output, int fieldNumber, float value)
    {
        if (value <= 0)
        {
            return;
        }

        output.WriteTag(fieldNumber, WireFormat.WireType.Fixed32);
        output.WriteFloat(value);
    }

    private static void WriteBool(CodedOutputStream output, int fieldNumber, bool value)
    {
        output.WriteTag(fieldNumber, WireFormat.WireType.Varint);
        output.WriteBool(value);
    }
}
