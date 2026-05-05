using System.Globalization;
using ClosedXML.Excel;

namespace Routa.OfficeWasmReader;

internal sealed class ClosedXmlFormulaValueProvider : IDisposable
{
    private readonly XLWorkbook workbook;

    private ClosedXmlFormulaValueProvider(XLWorkbook workbook)
    {
        this.workbook = workbook;
    }

    public static ClosedXmlFormulaValueProvider? TryCreate(byte[] bytes)
    {
        try
        {
            return new ClosedXmlFormulaValueProvider(new XLWorkbook(new MemoryStream(bytes, writable: false)));
        }
        catch
        {
            return null;
        }
    }

    public bool TryGetFormulaValue(string sheetName, string address, out string value)
    {
        value = "";
        if (string.IsNullOrWhiteSpace(sheetName) || string.IsNullOrWhiteSpace(address))
        {
            return false;
        }

        try
        {
            if (!workbook.Worksheets.TryGetWorksheet(sheetName, out var worksheet))
            {
                return false;
            }

            var cell = worksheet.Cell(address);
            if (string.IsNullOrWhiteSpace(cell.FormulaA1))
            {
                return false;
            }

            value = FormulaValueToProtocolText(cell.Value);
            return true;
        }
        catch
        {
            value = "";
            return false;
        }
    }

    public void Dispose()
    {
        workbook.Dispose();
    }

    private static string FormulaValueToProtocolText(XLCellValue value)
    {
        if (value.IsBlank)
        {
            return "";
        }

        if (value.IsBoolean)
        {
            return value.GetBoolean() ? "TRUE" : "FALSE";
        }

        if (value.IsNumber)
        {
            return value.GetNumber().ToString("G15", CultureInfo.InvariantCulture);
        }

        if (value.IsDateTime)
        {
            return value.GetUnifiedNumber().ToString("G15", CultureInfo.InvariantCulture);
        }

        if (value.IsTimeSpan)
        {
            return value.GetUnifiedNumber().ToString("G15", CultureInfo.InvariantCulture);
        }

        if (value.IsError)
        {
            return value.GetError().ToString();
        }

        return value.GetText();
    }
}
