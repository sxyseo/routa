using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Google.Protobuf;
using System.Text;
using Xunit;
using P = DocumentFormat.OpenXml.Presentation;

namespace Routa.OfficeWasmReader.Tests;

/// <summary>
/// Focused behavior tests for PPTX protocol extraction paths that are hard to
/// exercise with coarse fixture-shell assertions.
/// </summary>
public class PptxProtoReaderBehaviorTests
{
    [Fact]
    public void Read_CustomGeometryEffectsAndChart_EmitsStructuredRecords()
    {
        var protoBytes = PptxPresentationProtoReader.Read(CustomGeometryEffectsAndChartPptx());
        var slides = MessagesForField(protoBytes, 1);
        var charts = MessagesForField(protoBytes, 9);

        Assert.Single(slides);
        Assert.Single(charts);

        var slideElements = MessagesForField(slides[0], 3);
        var customShape = Assert.Single(slideElements, element => StringField(element, 10) == "Custom Geometry");
        var customShapeFields = CountFields(customShape);
        var shape = Assert.Single(MessagesForField(customShape, 4));
        var shapePath = Assert.Single(MessagesForField(shape, 9));

        Assert.Equal(188, Int32Field(shape, 1)); // custom geometry
        Assert.Equal(4, customShapeFields[15]); // shadow, glow, reflection, soft edges
        Assert.Equal(5, CountFields(shapePath)[3]); // move, line, quad, cubic, close

        var chart = charts[0];
        var series = Assert.Single(MessagesForField(chart, 3));
        Assert.Equal("Quarterly Revenue", StringField(chart, 1));
        Assert.Contains("Q2", StringsForField(chart, 2));
        Assert.Equal("North", StringField(series, 1));
        Assert.Equal("series-00000000", StringField(series, 8));
        Assert.Equal(4, Int32Field(chart, 5)); // bar chart
    }

    private static byte[] CustomGeometryEffectsAndChartPptx()
    {
        using var ms = new MemoryStream();
        using (var document = PresentationDocument.Create(ms, PresentationDocumentType.Presentation))
        {
            var presentationPart = document.AddPresentationPart();
            presentationPart.Presentation = new P.Presentation(
                new P.SlideSize { Cx = 12_192_000, Cy = 6_858_000 },
                new P.SlideIdList());

            var slidePart = presentationPart.AddNewPart<SlidePart>("rIdSlide1");
            slidePart.Slide = new P.Slide();
            slidePart.Slide.InnerXml = SlideXml();

            var chartPart = slidePart.AddNewPart<ChartPart>("rIdChart1");
            using (var chartStream = new MemoryStream(Encoding.UTF8.GetBytes(ChartXml())))
            {
                chartPart.FeedData(chartStream);
            }

            presentationPart.Presentation.SlideIdList!.Append(new P.SlideId
            {
                Id = 256U,
                RelationshipId = "rIdSlide1"
            });
            presentationPart.Presentation.Save();
            slidePart.Slide.Save();
            document.Save();
        }

        return ms.ToArray();
    }

    private static string SlideXml()
    {
        return """
<p:cSld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Custom Geometry"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="2743200" cy="1371600"/></a:xfrm>
        <a:custGeom>
          <a:rect l="l" t="t" r="r" b="b"/>
          <a:pathLst>
            <a:path w="1000" h="1000" id="customPath">
              <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
              <a:lnTo><a:pt x="1000" y="0"/></a:lnTo>
              <a:quadBezTo><a:pt x="1000" y="500"/><a:pt x="500" y="750"/></a:quadBezTo>
              <a:cubicBezTo><a:pt x="250" y="800"/><a:pt x="100" y="900"/><a:pt x="0" y="1000"/></a:cubicBezTo>
              <a:arcTo wR="500" hR="250" stAng="0" swAng="5400000"/>
              <a:close/>
            </a:path>
          </a:pathLst>
        </a:custGeom>
        <a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>
        <a:effectLst>
          <a:outerShdw blurRad="19050" dist="38100" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw>
          <a:glow rad="25400"><a:srgbClr val="FFCC00"/></a:glow>
          <a:reflection blurRad="6350" stA="50000" stPos="0" endA="0" endPos="100000" dist="12700" dir="5400000" fadeDir="5400000" sx="100000" sy="100000" kx="0" ky="0" algn="b" rotWithShape="1"/>
          <a:softEdge rad="12700"/>
        </a:effectLst>
      </p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Custom</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:graphicFrame>
      <p:nvGraphicFramePr><p:cNvPr id="3" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <p:xfrm><a:off x="3657600" y="914400"/><a:ext cx="4572000" cy="2743200"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdChart1"/></a:graphicData></a:graphic>
    </p:graphicFrame>
  </p:spTree>
</p:cSld>
<p:clrMapOvr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:masterClrMapping/></p:clrMapOvr>
""";
    }

    private static string ChartXml()
    {
        return """
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Quarterly Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title>
    <c:plotArea>
      <c:barChart>
        <c:barDir val="bar"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>North</c:v></c:tx>
          <c:spPr><a:solidFill><a:srgbClr val="70AD47"/></a:solidFill></c:spPr>
          <c:cat><c:strRef><c:f>Sheet1!$A$1:$A$2</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt></c:strCache></c:strRef></c:cat>
          <c:val><c:numRef><c:f>Sheet1!$B$1:$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>18.5</c:v></c:pt></c:numCache></c:numRef></c:val>
        </c:ser>
      </c:barChart>
    </c:plotArea>
    <c:legend><c:legendPos val="r"/></c:legend>
  </c:chart>
</c:chartSpace>
""";
    }

    private static Dictionary<int, int> CountFields(byte[] bytes)
    {
        var counts = new Dictionary<int, int>();
        var input = new CodedInputStream(bytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            var fieldNumber = WireFormat.GetTagFieldNumber(tag);
            counts[fieldNumber] = counts.GetValueOrDefault(fieldNumber) + 1;
            input.SkipLastField();
        }

        return counts;
    }

    private static List<byte[]> MessagesForField(byte[] bytes, int targetField)
    {
        var messages = new List<byte[]>();
        var input = new CodedInputStream(bytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            if (WireFormat.GetTagFieldNumber(tag) == targetField && WireFormat.GetTagWireType(tag) == WireFormat.WireType.LengthDelimited)
            {
                messages.Add(input.ReadBytes().ToByteArray());
                continue;
            }

            input.SkipLastField();
        }

        return messages;
    }

    private static List<string> StringsForField(byte[] bytes, int targetField)
    {
        var values = new List<string>();
        var input = new CodedInputStream(bytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            if (WireFormat.GetTagFieldNumber(tag) == targetField && WireFormat.GetTagWireType(tag) == WireFormat.WireType.LengthDelimited)
            {
                values.Add(input.ReadString());
                continue;
            }

            input.SkipLastField();
        }

        return values;
    }

    private static string StringField(byte[] bytes, int targetField) =>
        StringsForField(bytes, targetField).FirstOrDefault() ?? "";

    private static int Int32Field(byte[] bytes, int targetField)
    {
        var input = new CodedInputStream(bytes);
        while (input.ReadTag() is var tag && tag != 0)
        {
            if (WireFormat.GetTagFieldNumber(tag) == targetField && WireFormat.GetTagWireType(tag) == WireFormat.WireType.Varint)
            {
                return input.ReadInt32();
            }

            input.SkipLastField();
        }

        return 0;
    }
}
