using DocumentFormat.OpenXml.Packaging;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;

namespace Routa.OfficeWasmReader;

internal static class OpenXmlChartReader
{
    public static ChartModel? Read(OpenXmlPartContainer container, ChartPart chartPart, string path)
    {
        var relationshipId = container.GetIdOfPart(chartPart);
        if (string.IsNullOrEmpty(relationshipId))
        {
            return null;
        }

        var chartSpace = chartPart.ChartSpace;
        if (chartSpace is null)
        {
            return new ChartModel(relationshipId, path, "", "unknown");
        }

        var title = TextNormalization.Clean(string.Concat(
            chartSpace.Descendants<C.Title>().FirstOrDefault()?.Descendants<A.Text>().Select(item => item.Text) ??
            Enumerable.Empty<string>()));

        return new ChartModel(relationshipId, path, title, DetectChartType(chartSpace));
    }

    private static string DetectChartType(C.ChartSpace chartSpace)
    {
        if (chartSpace.Descendants<C.BarChart>().Any()) return "bar";
        if (chartSpace.Descendants<C.LineChart>().Any()) return "line";
        if (chartSpace.Descendants<C.PieChart>().Any()) return "pie";
        if (chartSpace.Descendants<C.AreaChart>().Any()) return "area";
        if (chartSpace.Descendants<C.ScatterChart>().Any()) return "scatter";
        if (chartSpace.Descendants<C.BubbleChart>().Any()) return "bubble";
        if (chartSpace.Descendants<C.DoughnutChart>().Any()) return "doughnut";
        if (chartSpace.Descendants<C.RadarChart>().Any()) return "radar";
        if (chartSpace.Descendants<C.SurfaceChart>().Any()) return "surface";
        return "unknown";
    }
}
