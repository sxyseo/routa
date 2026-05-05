using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using Xunit;
using S = DocumentFormat.OpenXml.Spreadsheet;

namespace Routa.OfficeWasmReader;

public sealed class XlsxFormulaValueTests
{
    [Fact]
    public void XlsxReaderCalculatesFormulaCellsWithoutCachedValues()
    {
        var workbookBytes = CreateFormulaWorkbookWithoutCachedValues();

        var protoBytes = XlsxWorkbookProtoReader.Read(workbookBytes);
        var values = DecodeCellValues(protoBytes);

        Assert.Equal("15", values["Calc!B1"]);
        Assert.Equal("ok", values["Calc!B2"]);
        Assert.Equal("20", values["Calc!B3"]);
        Assert.Equal("TRUE", values["Calc!B4"]);
    }

    private static byte[] CreateFormulaWorkbookWithoutCachedValues()
    {
        using var workbook = new XLWorkbook();
        var sheet = workbook.Worksheets.Add("Calc");
        sheet.Cell("A1").Value = 10;
        sheet.Cell("A2").Value = 5;
        sheet.Cell("B1").FormulaA1 = "SUM(A1:A2)";
        sheet.Cell("B2").FormulaA1 = "IF(B1>10,\"ok\",\"bad\")";
        sheet.Cell("B3").FormulaA1 = "VLOOKUP(\"b\",Lookup!A1:B1,2,FALSE)";
        sheet.Cell("B4").FormulaA1 = "B1=15";

        var lookup = workbook.Worksheets.Add("Lookup");
        lookup.Cell("A1").Value = "b";
        lookup.Cell("B1").Value = 20;

        using var saved = new MemoryStream();
        workbook.SaveAs(saved);
        saved.Position = 0;

        using var stripped = new MemoryStream(saved.ToArray());
        using (var document = SpreadsheetDocument.Open(stripped, true))
        {
            var worksheetParts = document.WorkbookPart?.WorksheetParts ?? [];
            foreach (var cell in worksheetParts
                         .SelectMany(part => part.Worksheet?.Descendants<S.Cell>() ?? []))
            {
                if (cell.CellFormula is null)
                {
                    continue;
                }

                cell.CellValue?.Remove();
                cell.DataType = null;
            }
        }

        return stripped.ToArray();
    }

    private static Dictionary<string, string> DecodeCellValues(byte[] protoBytes)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var input = new CodedInputStream(protoBytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            if (WireFormat.GetTagFieldNumber(tag) == 1)
            {
                DecodeSheet(input.ReadBytes().ToByteArray(), values);
            }
            else
            {
                input.SkipLastField();
            }
        }

        return values;
    }

    private static void DecodeSheet(byte[] sheetBytes, Dictionary<string, string> values)
    {
        var input = new CodedInputStream(sheetBytes);
        var sheetName = "";
        while (input.ReadTag() is var tag && tag != 0)
        {
            var fieldNumber = WireFormat.GetTagFieldNumber(tag);
            if (fieldNumber == 2)
            {
                sheetName = input.ReadString();
            }
            else if (fieldNumber == 3)
            {
                DecodeRow(input.ReadBytes().ToByteArray(), sheetName, values);
            }
            else
            {
                input.SkipLastField();
            }
        }
    }

    private static void DecodeRow(byte[] rowBytes, string sheetName, Dictionary<string, string> values)
    {
        var input = new CodedInputStream(rowBytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            if (WireFormat.GetTagFieldNumber(tag) == 2)
            {
                var cell = DecodeCell(input.ReadBytes().ToByteArray());
                if (cell.Address.Length > 0)
                {
                    values[$"{sheetName}!{cell.Address}"] = cell.Value;
                }
            }
            else
            {
                input.SkipLastField();
            }
        }
    }

    private static (string Address, string Value) DecodeCell(byte[] cellBytes)
    {
        var input = new CodedInputStream(cellBytes);
        var address = "";
        var value = "";
        while (input.ReadTag() is var tag && tag != 0)
        {
            switch (WireFormat.GetTagFieldNumber(tag))
            {
                case 1:
                    address = input.ReadString();
                    break;
                case 2:
                    value = input.ReadString();
                    break;
                default:
                    input.SkipLastField();
                    break;
            }
        }

        return (address, value);
    }
}
