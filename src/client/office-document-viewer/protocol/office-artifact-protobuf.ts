import {
  emptyRoutaOfficeArtifact,
  type RoutaOfficeArtifact,
  type RoutaOfficeCell,
  type RoutaOfficeChart,
  type RoutaOfficeConditionalFormat,
  type RoutaOfficeDataValidation,
  type RoutaOfficeDiagnostic,
  type RoutaOfficeImageAsset,
  type RoutaOfficeMergedRange,
  type RoutaOfficeRow,
  type RoutaOfficeSheet,
  type RoutaOfficeSheetTable,
  type RoutaOfficeSlide,
  type RoutaOfficeTable,
  type RoutaOfficeTextBlock,
} from "./office-artifact-types";

const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;
const textDecoder = new TextDecoder();

class ProtoReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  readTag(): { fieldNumber: number; wireType: number } {
    const tag = this.readVarint();
    return {
      fieldNumber: Math.floor(tag / 8),
      wireType: tag % 8,
    };
  }

  readVarint(): number {
    let result = 0;
    let shift = 0;

    while (shift <= 49) {
      const byte = this.readByte();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7;
    }

    throw new Error("Invalid protobuf varint");
  }

  readString(): string {
    return textDecoder.decode(this.readBytes());
  }

  readBytes(): Uint8Array {
    const length = this.readVarint();
    this.ensureAvailable(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(wireType: number): void {
    if (wireType === WIRE_VARINT) {
      this.readVarint();
      return;
    }

    if (wireType === WIRE_LENGTH_DELIMITED) {
      this.readBytes();
      return;
    }

    throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }

  private readByte(): number {
    this.ensureAvailable(1);
    return this.bytes[this.offset++];
  }

  private ensureAvailable(length: number): void {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of protobuf payload");
    }
  }
}

export function decodeRoutaOfficeArtifact(bytes: Uint8Array): RoutaOfficeArtifact {
  const reader = new ProtoReader(bytes);
  const artifact = emptyRoutaOfficeArtifact();

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    switch (fieldNumber) {
      case 1:
        artifact.sourceKind = readStringField(reader, wireType);
        break;
      case 2:
        artifact.title = readStringField(reader, wireType);
        break;
      case 3:
        artifact.textBlocks.push(decodeTextBlock(readMessageField(reader, wireType)));
        break;
      case 4:
        artifact.sheets.push(decodeSheet(readMessageField(reader, wireType)));
        break;
      case 5:
        artifact.slides.push(decodeSlide(readMessageField(reader, wireType)));
        break;
      case 6:
        artifact.diagnostics.push(decodeDiagnostic(readMessageField(reader, wireType)));
        break;
      case 7: {
        const [key, value] = decodeMetadata(readMessageField(reader, wireType));
        if (key) artifact.metadata[key] = value;
        break;
      }
      case 8:
        artifact.images.push(decodeImage(readMessageField(reader, wireType)));
        break;
      case 9:
        artifact.tables.push(decodeTable(readMessageField(reader, wireType)));
        break;
      case 10:
        artifact.charts.push(decodeChart(readMessageField(reader, wireType)));
        break;
      default:
        reader.skip(wireType);
    }
  }

  return artifact;
}

function decodeTextBlock(bytes: Uint8Array): RoutaOfficeTextBlock {
  const reader = new ProtoReader(bytes);
  const block: RoutaOfficeTextBlock = { path: "", text: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) block.path = readStringField(reader, wireType);
    else if (fieldNumber === 2) block.text = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return block;
}

function decodeSheet(bytes: Uint8Array): RoutaOfficeSheet {
  const reader = new ProtoReader(bytes);
  const sheet: RoutaOfficeSheet = {
    conditionalFormats: [],
    dataValidations: [],
    mergedRanges: [],
    name: "",
    rows: [],
    tables: [],
  };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) sheet.name = readStringField(reader, wireType);
    else if (fieldNumber === 2) sheet.rows.push(decodeRow(readMessageField(reader, wireType)));
    else if (fieldNumber === 3) sheet.mergedRanges.push(decodeMergedRange(readMessageField(reader, wireType)));
    else if (fieldNumber === 4) sheet.tables.push(decodeSheetTable(readMessageField(reader, wireType)));
    else if (fieldNumber === 5) sheet.dataValidations.push(decodeDataValidation(readMessageField(reader, wireType)));
    else if (fieldNumber === 6) sheet.conditionalFormats.push(decodeConditionalFormat(readMessageField(reader, wireType)));
    else reader.skip(wireType);
  }

  return sheet;
}

function decodeTable(bytes: Uint8Array): RoutaOfficeTable {
  const reader = new ProtoReader(bytes);
  const table: RoutaOfficeTable = { path: "", rows: [] };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) table.path = readStringField(reader, wireType);
    else if (fieldNumber === 2) table.rows.push(decodeRow(readMessageField(reader, wireType)));
    else reader.skip(wireType);
  }

  return table;
}

function decodeRow(bytes: Uint8Array): RoutaOfficeRow {
  const reader = new ProtoReader(bytes);
  const row: RoutaOfficeRow = { cells: [] };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) row.cells.push(decodeCell(readMessageField(reader, wireType)));
    else reader.skip(wireType);
  }

  return row;
}

function decodeCell(bytes: Uint8Array): RoutaOfficeCell {
  const reader = new ProtoReader(bytes);
  const cell: RoutaOfficeCell = { address: "", formula: "", text: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) cell.address = readStringField(reader, wireType);
    else if (fieldNumber === 2) cell.text = readStringField(reader, wireType);
    else if (fieldNumber === 3) cell.formula = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return cell;
}

function decodeSlide(bytes: Uint8Array): RoutaOfficeSlide {
  const reader = new ProtoReader(bytes);
  const slide: RoutaOfficeSlide = { index: 0, textBlocks: [], title: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) slide.index = readUInt32Field(reader, wireType);
    else if (fieldNumber === 2) slide.title = readStringField(reader, wireType);
    else if (fieldNumber === 3) slide.textBlocks.push(decodeTextBlock(readMessageField(reader, wireType)));
    else reader.skip(wireType);
  }

  return slide;
}

function decodeDiagnostic(bytes: Uint8Array): RoutaOfficeDiagnostic {
  const reader = new ProtoReader(bytes);
  const diagnostic: RoutaOfficeDiagnostic = { level: "", message: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) diagnostic.level = readStringField(reader, wireType);
    else if (fieldNumber === 2) diagnostic.message = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return diagnostic;
}

function decodeMetadata(bytes: Uint8Array): [string, string] {
  const reader = new ProtoReader(bytes);
  let key = "";
  let value = "";

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) key = readStringField(reader, wireType);
    else if (fieldNumber === 2) value = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return [key, value];
}

function decodeImage(bytes: Uint8Array): RoutaOfficeImageAsset {
  const reader = new ProtoReader(bytes);
  const image: RoutaOfficeImageAsset = { bytes: new Uint8Array(), contentType: "", id: "", path: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) image.id = readStringField(reader, wireType);
    else if (fieldNumber === 2) image.path = readStringField(reader, wireType);
    else if (fieldNumber === 3) image.contentType = readStringField(reader, wireType);
    else if (fieldNumber === 4) image.bytes = readMessageField(reader, wireType);
    else reader.skip(wireType);
  }

  return image;
}

function decodeChart(bytes: Uint8Array): RoutaOfficeChart {
  const reader = new ProtoReader(bytes);
  const chart: RoutaOfficeChart = { chartType: "", id: "", path: "", title: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) chart.id = readStringField(reader, wireType);
    else if (fieldNumber === 2) chart.path = readStringField(reader, wireType);
    else if (fieldNumber === 3) chart.title = readStringField(reader, wireType);
    else if (fieldNumber === 4) chart.chartType = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return chart;
}

function decodeMergedRange(bytes: Uint8Array): RoutaOfficeMergedRange {
  const reader = new ProtoReader(bytes);
  const range: RoutaOfficeMergedRange = { reference: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) range.reference = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return range;
}

function decodeSheetTable(bytes: Uint8Array): RoutaOfficeSheetTable {
  const reader = new ProtoReader(bytes);
  const table: RoutaOfficeSheetTable = { name: "", reference: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) table.name = readStringField(reader, wireType);
    else if (fieldNumber === 2) table.reference = readStringField(reader, wireType);
    else reader.skip(wireType);
  }

  return table;
}

function decodeDataValidation(bytes: Uint8Array): RoutaOfficeDataValidation {
  const reader = new ProtoReader(bytes);
  const validation: RoutaOfficeDataValidation = {
    formula1: "",
    formula2: "",
    operator: "",
    ranges: [],
    type: "",
  };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) validation.type = readStringField(reader, wireType);
    else if (fieldNumber === 2) validation.operator = readStringField(reader, wireType);
    else if (fieldNumber === 3) validation.formula1 = readStringField(reader, wireType);
    else if (fieldNumber === 4) validation.formula2 = readStringField(reader, wireType);
    else if (fieldNumber === 5) validation.ranges.push(readStringField(reader, wireType));
    else reader.skip(wireType);
  }

  return validation;
}

function decodeConditionalFormat(bytes: Uint8Array): RoutaOfficeConditionalFormat {
  const reader = new ProtoReader(bytes);
  const format: RoutaOfficeConditionalFormat = { priority: 0, ranges: [], type: "" };

  while (!reader.done) {
    const { fieldNumber, wireType } = reader.readTag();
    if (fieldNumber === 1) format.type = readStringField(reader, wireType);
    else if (fieldNumber === 2) format.priority = readUInt32Field(reader, wireType);
    else if (fieldNumber === 3) format.ranges.push(readStringField(reader, wireType));
    else reader.skip(wireType);
  }

  return format;
}

function readStringField(reader: ProtoReader, wireType: number): string {
  expectWireType(wireType, WIRE_LENGTH_DELIMITED);
  return reader.readString();
}

function readMessageField(reader: ProtoReader, wireType: number): Uint8Array {
  expectWireType(wireType, WIRE_LENGTH_DELIMITED);
  return reader.readBytes();
}

function readUInt32Field(reader: ProtoReader, wireType: number): number {
  expectWireType(wireType, WIRE_VARINT);
  return reader.readVarint();
}

function expectWireType(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Invalid protobuf wire type: expected ${expected}, got ${actual}`);
  }
}
