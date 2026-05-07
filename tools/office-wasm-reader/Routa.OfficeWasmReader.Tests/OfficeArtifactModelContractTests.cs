using Google.Protobuf;
using Xunit;

namespace Routa.OfficeWasmReader.Tests;

public class OfficeArtifactModelContractTests
{
    private static readonly string FixtureDir =
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "fixtures"));

    [Fact]
    public void DocxArtifactReader_EmitsTextTablesImagesAndMetadata()
    {
        var artifact = DocxArtifactReader.Read(ReadFixture("dll_viewer_solution_test_document.docx"));
        var protoBytes = OfficeArtifactProtoWriter.Write(artifact);
        var fields = CountFields(protoBytes);

        Assert.Equal("docx", artifact.SourceKind);
        Assert.NotEmpty(artifact.TextBlocks);
        Assert.NotEmpty(artifact.Tables);
        Assert.NotEmpty(artifact.Images);
        Assert.Equal("routa-office-wasm-reader", artifact.Metadata["reader"]);
        Assert.Equal(artifact.TextBlocks.Count, fields[3]);
        Assert.Equal(artifact.Images.Count, fields[8]);
        Assert.Equal(artifact.Tables.Count, fields[9]);
    }

    [Fact]
    public void PptxArtifactReader_EmitsSlidesTablesAndMetadata()
    {
        var artifact = PptxArtifactReader.Read(ReadFixture("pptx_table_contract.pptx"));
        var protoBytes = OfficeArtifactProtoWriter.Write(artifact);
        var fields = CountFields(protoBytes);

        Assert.Equal("pptx", artifact.SourceKind);
        Assert.NotEmpty(artifact.Slides);
        Assert.NotEmpty(artifact.Tables);
        Assert.Equal("routa-office-wasm-reader", artifact.Metadata["reader"]);
        Assert.Equal(artifact.Slides.Count, fields[5]);
        Assert.Equal(artifact.Tables.Count, fields[9]);
    }

    [Fact]
    public void XlsxArtifactReader_EmitsSheetsChartsAndStyles()
    {
        var artifact = XlsxArtifactReader.Read(ReadFixture("complex_excel_renderer_test.xlsx"));
        var protoBytes = OfficeArtifactProtoWriter.Write(artifact);
        var fields = CountFields(protoBytes);

        Assert.Equal("xlsx", artifact.SourceKind);
        Assert.Equal(9, artifact.Sheets.Count);
        Assert.NotEmpty(artifact.Charts);
        Assert.NotEmpty(artifact.Styles.Fonts);
        Assert.Equal("routa-office-wasm-reader", artifact.Metadata["reader"]);
        Assert.Equal(artifact.Sheets.Count, fields[4]);
        Assert.Equal(artifact.Charts.Count, fields[10]);
        Assert.Equal(1, fields[11]);
    }

    private static byte[] ReadFixture(string name) =>
        File.ReadAllBytes(Path.Combine(FixtureDir, name));

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
}
