import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

export function assertFontGlb(bytes) {
  return inspectFontGlb(bytes).document;
}

export function inspectFontGlb(bytes) {
  assert(bytes.byteLength >= 28, "GLB has a header and JSON chunk");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), GLB_MAGIC, "GLB magic");
  assert.equal(view.getUint32(4, true), 2, "GLB version");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB declared length");

  const chunks = [];
  let cursor = 12;
  while (cursor < bytes.byteLength) {
    assert(cursor + 8 <= bytes.byteLength, "GLB chunk header is in range");
    const byteLength = view.getUint32(cursor, true);
    const type = view.getUint32(cursor + 4, true);
    const start = cursor + 8;
    const end = start + byteLength;
    assert.equal(byteLength % 4, 0, "GLB chunk length is four-byte aligned");
    assert(end <= bytes.byteLength, "GLB chunk payload is in range");
    chunks.push({ type, start, end, byteLength });
    cursor = end;
  }
  assert.equal(cursor, bytes.byteLength, "GLB chunks consume the declared length");
  assert.equal(chunks.length, 2, "font GLB has JSON and BIN chunks");
  assert.equal(chunks[0].type, JSON_CHUNK, "JSON is the first GLB chunk");
  assert.equal(chunks[1].type, BIN_CHUNK, "BIN is the second GLB chunk");

  const jsonBytes = bytes.subarray(chunks[0].start, chunks[0].end);
  const document = JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd());
  assert.equal(document.asset?.version, "2.0");
  assert(document.extensionsUsed?.includes("PMNDRS_font"));
  assert(document.extensionsRequired?.includes("PMNDRS_font"));

  assert.equal(document.buffers?.length, 1);
  const declaredBinLength = document.buffers[0].byteLength;
  assert(Number.isSafeInteger(declaredBinLength) && declaredBinLength >= 0);
  assert(declaredBinLength <= chunks[1].byteLength);
  assert(chunks[1].byteLength - declaredBinLength <= 3, "BIN has alignment padding only");

  const bufferViews = document.bufferViews;
  assert(Array.isArray(bufferViews) && bufferViews.length >= 3);
  for (const bufferView of bufferViews) {
    const offset = bufferView.byteOffset ?? 0;
    assert.equal(bufferView.buffer, 0);
    assert(Number.isSafeInteger(offset) && offset >= 0);
    assert(Number.isSafeInteger(bufferView.byteLength) && bufferView.byteLength >= 0);
    assert.equal(offset % 4, 0, "font buffer view is four-byte aligned");
    assert(offset + bufferView.byteLength <= declaredBinLength);
  }

  const extension = document.extensions?.PMNDRS_font;
  assert.equal(extension?.version, 0);
  assert.equal(extension?.shaping?.format, "opentype-sfnt-harfrust-v0");
  const shapingView = readBufferView(bufferViews, extension.shaping.bufferView);
  const extentsView = readBufferView(
    bufferViews,
    extension.shaping.fontFunctions.glyphExtentsBufferView,
  );
  const availabilityView = readBufferView(
    bufferViews,
    extension.shaping.fontFunctions.glyphExtentsAvailabilityBufferView,
  );
  assert.equal(extension.shaping.fontFunctions.glyphExtentsStride, 8);
  assert.equal(extentsView.byteLength, extension.metrics.glyphCount * 8);
  assert.equal(availabilityView.byteLength, Math.ceil(extension.metrics.glyphCount / 8));

  const bin = bytes.subarray(chunks[1].start, chunks[1].end);
  const shapingSfnt = sliceBufferView(bin, shapingView);
  const extents = sliceBufferView(bin, extentsView);
  const extentsAvailability = sliceBufferView(bin, availabilityView);
  const tables = assertShapingSfnt(shapingSfnt, extension.metrics);
  assertExtents(extents, extentsAvailability, extension.metrics.glyphCount);
  assert.equal(
    shapingHash(shapingSfnt, extents, extentsAvailability),
    extension.shaping.hash,
    "shaping identity covers the SFNT and both font-function views",
  );
  assertZeroGaps(bin, bufferViews, declaredBinLength);

  return { document, shapingSfnt, extents, extentsAvailability, tables };
}

function readBufferView(bufferViews, index) {
  assert(Number.isSafeInteger(index) && index >= 0 && index < bufferViews.length);
  return bufferViews[index];
}

function sliceBufferView(bin, bufferView) {
  const start = bufferView.byteOffset ?? 0;
  return bin.subarray(start, start + bufferView.byteLength);
}

function assertShapingSfnt(bytes, metrics) {
  assert(bytes.byteLength >= 12, "shaping SFNT contains an offset table");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scalerType = view.getUint32(0, false);
  assert(
    scalerType === 0x00010000 || scalerType === 0x4f54544f,
    "shaping payload is a TrueType or CFF OpenType SFNT",
  );
  const count = view.getUint16(4, false);
  const directoryBytes = 12 + count * 16;
  assert(directoryBytes <= bytes.byteLength, "SFNT directory is in range");
  const entrySelector = count === 0 ? 0 : Math.floor(Math.log2(count));
  const searchRange = count === 0 ? 0 : 16 * 2 ** entrySelector;
  assert.equal(view.getUint16(6, false), searchRange, "SFNT searchRange");
  assert.equal(view.getUint16(8, false), entrySelector, "SFNT entrySelector");
  assert.equal(view.getUint16(10, false), count * 16 - searchRange, "SFNT rangeShift");

  const allowed = new Set([
    "GDEF",
    "GPOS",
    "GSUB",
    "OS/2",
    "cmap",
    "head",
    "hhea",
    "hmtx",
    "kern",
    "maxp",
  ]);
  const required = ["OS/2", "cmap", "head", "hhea", "hmtx", "maxp"];
  const tables = new Map();
  const ranges = [];
  let previousTag = "";
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = new TextDecoder().decode(bytes.subarray(record, record + 4));
    const expectedChecksum = view.getUint32(record + 4, false);
    const offset = view.getUint32(record + 8, false);
    const byteLength = view.getUint32(record + 12, false);
    assert(allowed.has(tag), `SFNT table ${tag} belongs to the closed shaping profile`);
    assert(previousTag < tag, "SFNT table tags are unique and sorted");
    assert.equal(offset % 4, 0, `${tag} table is four-byte aligned`);
    assert(offset >= directoryBytes, `${tag} table begins after the directory`);
    assert(offset + byteLength <= bytes.byteLength, `${tag} table is in range`);
    const table = bytes.subarray(offset, offset + byteLength);
    const checksumInput = tag === "head" ? table.slice() : table;
    if (tag === "head") checksumInput.fill(0, 8, 12);
    assert.equal(checksum(checksumInput), expectedChecksum, `${tag} table checksum`);
    const paddedEnd = align4(offset + byteLength);
    assert(paddedEnd <= bytes.byteLength, `${tag} table padding is in range`);
    assert(
      bytes.subarray(offset + byteLength, paddedEnd).every((byte) => byte === 0),
      `${tag} table padding is zero`,
    );
    tables.set(tag, { offset, byteLength, bytes: table });
    ranges.push([offset, paddedEnd]);
    previousTag = tag;
  }
  for (const tag of required) assert(tables.has(tag), `SFNT contains required ${tag}`);
  ranges.sort((left, right) => left[0] - right[0]);
  let end = directoryBytes;
  for (const [start, nextEnd] of ranges) {
    assert(start >= end, "SFNT tables do not overlap");
    end = nextEnd;
  }
  assert.equal(end, bytes.byteLength, "SFNT has no unaccounted trailing bytes");
  assert.equal(checksum(bytes), 0xb1b0afba, "SFNT checkSumAdjustment");

  const head = tableView(tables, "head");
  const maxp = tableView(tables, "maxp");
  const hhea = tableView(tables, "hhea");
  const os2 = tableView(tables, "OS/2");
  assert.equal(head.getUint16(18, false), metrics.unitsPerEm);
  assert.equal(maxp.getUint16(4, false), metrics.glyphCount);
  assert.equal(metrics.glyphIdWidth, 16);
  const useTypoMetrics = (os2.getUint16(62, false) & 0x80) !== 0;
  assert.equal(
    metrics.ascender,
    useTypoMetrics ? os2.getInt16(68, false) : hhea.getInt16(4, false),
  );
  assert.equal(
    metrics.descender,
    useTypoMetrics ? os2.getInt16(70, false) : hhea.getInt16(6, false),
  );
  assert.equal(metrics.lineGap, useTypoMetrics ? os2.getInt16(72, false) : hhea.getInt16(8, false));
  return tables;
}

function assertExtents(extents, availability, glyphCount) {
  assert.equal(extents.byteLength, glyphCount * 8);
  assert.equal(availability.byteLength, Math.ceil(glyphCount / 8));
  const usedBits = glyphCount & 7;
  if (usedBits !== 0) {
    const unusedMask = 0xff << usedBits;
    assert.equal(availability.at(-1) & unusedMask, 0, "unused availability bits are zero");
  }
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const present = (availability[glyphId >> 3] & (1 << (glyphId & 7))) !== 0;
    if (!present) {
      assert(
        extents.subarray(glyphId * 8, glyphId * 8 + 8).every((byte) => byte === 0),
        `absent glyph ${glyphId} has zero extents`,
      );
    }
  }
}

function assertZeroGaps(bin, bufferViews, declaredByteLength) {
  const ranges = bufferViews
    .map((bufferView) => [
      bufferView.byteOffset ?? 0,
      (bufferView.byteOffset ?? 0) + bufferView.byteLength,
    ])
    .sort((left, right) => left[0] - right[0]);
  let end = 0;
  for (const [start, nextEnd] of ranges) {
    assert(start >= end, "font buffer views do not overlap");
    assert(
      bin.subarray(end, start).every((byte) => byte === 0),
      "buffer-view alignment gaps are zero",
    );
    end = nextEnd;
  }
  assert(
    bin.subarray(end, declaredByteLength).every((byte) => byte === 0),
    "declared BIN trailing bytes are zero",
  );
}

function tableView(tables, tag) {
  const table = tables.get(tag);
  assert(table !== undefined);
  return new DataView(table.bytes.buffer, table.bytes.byteOffset, table.bytes.byteLength);
}

function shapingHash(sfnt, extents, availability) {
  const hash = createHash("sha256").update(new TextEncoder().encode("PMNDRS_font\0v0\0"));
  for (const value of [sfnt, extents, availability]) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, value.byteLength, true);
    hash.update(length);
    hash.update(value);
  }
  return hash.digest("hex");
}

function checksum(bytes) {
  let sum = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const word =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function align4(value) {
  return (value + 3) & ~3;
}
