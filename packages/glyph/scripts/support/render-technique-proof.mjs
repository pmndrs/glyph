import { fontBindingBytes, renderCodecBytesFromPrograms } from '../../tests/support/engine-abi.mjs';

const ABSENT_PAGE = 0xffff;
const MISSING_RESOURCE = 0xffff_ffff;
const TECHNIQUE_ID = 1;

export function techniqueProof(abi, name, raster) {
  if (name === 'bitmap') return bitmapProof(abi, raster);
  if (name === 'mtsdf') return mtsdfProof(abi, raster);
  if (name === 'slug') return slugProof(abi, raster);
  throw new RangeError(`unknown render technique ${name}`);
}

function bitmapProof(abi, raster) {
  const strike = raster.strikes[0];
  const view = recordView(strike.records);
  const binding = {
    width: Math.max(...strike.pages.map((page) => page.width)),
    height: Math.max(...strike.pages.map((page) => page.height)),
  };
  const fields = denseAtlasFields(view, raster.glyphCount, strike.planeUnitsPerEm, strike.pages, binding);
  return proof(abi, bitmapProgram(abi, 'strike'), {
    glyphCount: raster.glyphCount,
    strikes: [strike.ppem],
    resources: [resource(undefined, 0)],
    resourceIndices: pageIndices(view, raster.glyphCount, true),
    strikeF32: fields,
    strikeU32: [field(raster.glyphCount, (record) => view.getUint16(record + 16, true))],
  });
}

function mtsdfProof(abi, raster) {
  const extension = raster.document.extensions.PMNDRS_font_distance_field;
  const view = recordView(raster.records);
  const binding = {
    width: Math.max(...raster.pages.map((page) => page.width)),
    height: Math.max(...raster.pages.map((page) => page.height)),
  };
  // The glyph's atlas cell lives in the font's glyph table; the binding carries plane metrics and the table row.
  const fields = denseAtlasFields(view, raster.glyphCount, extension.planeUnitsPerEm, raster.pages, binding).slice(
    0,
    4,
  );
  return proof(abi, mtsdfProgram(abi), {
    glyphCount: raster.glyphCount,
    strikes: [0],
    resources: [{ id: 1, generation: 1, kind: 1, reference: 1 }],
    resourceIndices: pageIndices(view, raster.glyphCount, true),
    glyphF32: fields,
    glyphU32: [field(raster.glyphCount, (record) => record / 20)],
  });
}

function slugProof(abi, raster) {
  const extension = raster.document.extensions.PMNDRS_font_slug;
  const view = recordView(raster.records);
  const units = extension.planeUnitsPerEm;
  const normalized = (offset) => field(raster.glyphCount, (record) => view.getInt16(record + offset, true) / units, 40);
  const left = normalized(0);
  const bottom = normalized(2);
  const right = normalized(4);
  const top = normalized(6);
  const pages = field(raster.glyphCount, (record) => view.getUint16(record + 8, true), 40);
  // Per-glyph constants live in each page's glyph table; the binding carries the glyph's page-local row.
  const used = new Map();
  const rows = pages.map((page) => {
    if (page === ABSENT_PAGE) return 0;
    const row = used.get(page) ?? 0;
    used.set(page, row + 1);
    return row;
  });
  return proof(abi, slugProgram(abi), {
    glyphCount: raster.glyphCount,
    strikes: [0],
    resources: raster.pages.map(resource),
    resourceIndices: pages.map((page) => (page === ABSENT_PAGE ? MISSING_RESOURCE : page)),
    glyphF32: [
      left,
      top,
      left.map((value, index) => right[index] - value),
      bottom.map((value, index) => top[index] - value),
    ],
    glyphU32: [rows],
  });
}

function proof(abi, descriptor, binding) {
  const selected = descriptor;
  return {
    codecBytes: renderCodecBytesFromPrograms(abi, [selected]),
    bindingBytes: fontBindingBytes(abi, { techniqueId: TECHNIQUE_ID, ...binding }),
    outputBytesPerGlyph: selected.buffers.reduce(
      (sum, buffer) => sum + buffer.vectorWidth * scalarBytes(abi, buffer.scalar),
      0,
    ),
  };
}

function bitmapProgram(abi, glyphScope) {
  const context = programContext(abi, glyphScope, 8, 1);
  const { loadF32, loadU32, binary, storeF32, storeU32 } = context;
  loadF32(context.f32InputCount);
  loadU32(28, context.placementU32Input);
  loadU32(29, context.bindingU32Start);
  binary('multiplyF32', 15, 7, 2);
  binary('addF32', 16, 0, 15);
  binary('multiplyF32', 17, 8, 2);
  binary('subtractF32', 18, 1, 17);
  binary('multiplyF32', 19, 9, 2);
  binary('multiplyF32', 20, 10, 2);
  stores(storeF32, [
    [1, [16, 18]],
    [2, [19, 20]],
    [3, [11, 12]],
    [4, [13, 14]],
    [5, [3, 4, 5, 6]],
  ]);
  storeU32(6, 0, 29);
  storeU32(7, 0, 28);
  return program(context, [...floatBuffers(abi, [2, 2, 2, 2, 4]), ...uintBuffers(abi, [1, 1], 6)]);
}

function mtsdfProgram(abi) {
  const semantic = abi.engine.semanticF32Fields;
  const semanticU32 = abi.engine.semanticU32Fields;
  const semanticFields = [
    semantic.inlineOrigin,
    semantic.blockOrigin,
    semantic.fontSize,
    semantic.foregroundRed,
    semantic.foregroundGreen,
    semantic.foregroundBlue,
    semantic.foregroundAlpha,
    semantic.outlineWidthEm,
    semantic.shadowOffsetXEm,
    semantic.shadowOffsetYEm,
  ];
  const operations = [];
  const loadF32 = (target, inputField) =>
    operations.push({ opcode: abi.codec.opcodes.loadF32, target, operand0: inputField });
  const loadU32 = (target, inputField) =>
    operations.push({ opcode: abi.codec.opcodes.loadU32, target, operand0: inputField });
  const binary = (name, target, left, right) =>
    operations.push({ opcode: abi.codec.opcodes[name], target, operand0: left, operand1: right });
  const storeF32 = (buffer, lane, register) =>
    operations.push({ opcode: abi.codec.opcodes.storeF32, operand0: register, operand1: lane, immediate0: buffer });
  const storeU32 = (buffer, lane, register) =>
    operations.push({ opcode: abi.codec.opcodes.storeU32, operand0: register, operand1: lane, immediate0: buffer });
  const copyF32 = (buffer, lane, inputField) => {
    loadF32(0, inputField);
    storeF32(buffer, lane, 0);
  };
  const scaled = (buffer, lane, left, right) => {
    loadF32(0, left);
    loadF32(1, right);
    binary('multiplyF32', 2, 0, 1);
    storeF32(buffer, lane, 2);
  };
  const transformed = (buffer, lane, origin, extent, operation) => {
    loadF32(0, origin);
    loadF32(1, extent);
    loadF32(2, 2);
    binary('multiplyF32', 3, 1, 2);
    binary(operation, 4, 0, 3);
    storeF32(buffer, lane, 4);
  };

  transformed(1, 0, 0, 10, 'addF32');
  transformed(1, 1, 1, 11, 'subtractF32');
  scaled(1, 2, 12, 2);
  scaled(1, 3, 13, 2);
  for (let lane = 0; lane < 4; lane += 1) copyF32(2, lane, 3 + lane);
  loadU32(0, 1);
  storeU32(3, 0, 0);
  loadU32(0, 2);
  storeU32(3, 1, 0);
  copyF32(4, 0, 8);
  copyF32(4, 1, 9);
  copyF32(4, 2, 7);
  loadU32(0, 3);
  operations.push({ opcode: abi.codec.opcodes.convertU32ToF32, target: 1, operand0: 0 });
  storeF32(4, 3, 1);
  loadU32(0, 0);
  storeU32(5, 0, 0);
  const context = {
    inputs: [
      ...semanticFields.map((inputField) => ({ scope: 'semantic', field: inputField })),
      ...Array.from({ length: 4 }, (_, fieldIndex) => ({ scope: 'glyph', field: fieldIndex })),
      { scope: 'semantic', field: semanticU32.placementSlot },
      { scope: 'semantic', field: semanticU32.outlineRgba },
      { scope: 'semantic', field: semanticU32.shadowRgba },
      { scope: 'glyph', field: 0 },
    ],
    operations,
    f32InputCount: 14,
    u32InputCount: 4,
  };
  return program(context, [
    ...floatBuffers(abi, [4, 4]),
    ...uintBuffers(abi, [2], 3),
    { id: 4, scalar: abi.codec.scalarTypes.f32, vectorWidth: 4 },
    { id: 5, scalar: abi.codec.scalarTypes.u32, vectorWidth: 1 },
  ]);
}

function slugProgram(abi) {
  const context = programContext(abi, 'glyph', 4, 1);
  const { loadF32, loadU32, binary, storeF32, storeU32 } = context;
  loadF32(context.f32InputCount);
  loadU32(18, context.placementU32Input);
  loadU32(19, context.bindingU32Start);
  binary('multiplyF32', 11, 7, 2);
  binary('addF32', 12, 0, 11);
  binary('multiplyF32', 13, 8, 2);
  binary('subtractF32', 14, 1, 13);
  binary('multiplyF32', 15, 9, 2);
  binary('multiplyF32', 16, 10, 2);
  stores(storeF32, [
    [1, [12, 14, 15, 16]],
    [2, [3, 4, 5, 6]],
  ]);
  // The host's placement slot rides in the glyph buffer's second lane.
  stores(storeU32, [[3, [19, 18]]]);
  return program(context, [...floatBuffers(abi, [4, 4]), ...uintBuffers(abi, [2], 3)]);
}

function programContext(abi, bindingScope, bindingF32Count, bindingU32Count) {
  const operations = [];
  const semantic = abi.engine.semanticF32Fields;
  const semanticU32 = abi.engine.semanticU32Fields;
  const f32InputCount = 7 + bindingF32Count;
  const inputs = [
    { scope: 'semantic', field: semantic.inlineOrigin },
    { scope: 'semantic', field: semantic.blockOrigin },
    { scope: 'semantic', field: semantic.fontSize },
    { scope: 'semantic', field: semantic.foregroundRed },
    { scope: 'semantic', field: semantic.foregroundGreen },
    { scope: 'semantic', field: semantic.foregroundBlue },
    { scope: 'semantic', field: semantic.foregroundAlpha },
    ...Array.from({ length: bindingF32Count }, (_, fieldIndex) => ({ scope: bindingScope, field: fieldIndex })),
    { scope: 'semantic', field: semanticU32.placementSlot },
    ...Array.from({ length: bindingU32Count }, (_, fieldIndex) => ({ scope: bindingScope, field: fieldIndex })),
  ];
  return {
    inputs,
    operations,
    loadF32(count) {
      for (let fieldIndex = 0; fieldIndex < count; fieldIndex += 1) {
        operations.push({ opcode: abi.codec.opcodes.loadF32, target: fieldIndex, operand0: fieldIndex });
      }
    },
    loadU32(target, fieldIndex) {
      operations.push({ opcode: abi.codec.opcodes.loadU32, target, operand0: fieldIndex });
    },
    binary(name, target, left, right) {
      operations.push({ opcode: abi.codec.opcodes[name], target, operand0: left, operand1: right });
    },
    storeF32(buffer, lane, register) {
      operations.push({
        opcode: abi.codec.opcodes.storeF32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
    storeU32(buffer, lane, register) {
      operations.push({
        opcode: abi.codec.opcodes.storeU32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
    f32InputCount,
    placementU32Input: 0,
    bindingU32Start: 1,
    u32InputCount: bindingU32Count + 1,
  };
}

function program(context, buffers) {
  return {
    techniqueId: TECHNIQUE_ID,
    programId: 1,
    f32InputCount: context.f32InputCount,
    u32InputCount: context.u32InputCount,
    inputs: context.inputs,
    buffers,
    operations: context.operations,
  };
}

function stores(write, groups) {
  for (const [buffer, registers] of groups) {
    for (const [lane, register] of registers.entries()) write(buffer, lane, register);
  }
}

function floatBuffers(abi, widths) {
  return widths.map((vectorWidth, index) => ({ id: index + 1, scalar: abi.codec.scalarTypes.f32, vectorWidth }));
}

function uintBuffers(abi, widths, firstId) {
  return widths.map((vectorWidth, index) => ({ id: firstId + index, scalar: abi.codec.scalarTypes.u32, vectorWidth }));
}

function denseAtlasFields(view, glyphCount, units, pages, binding) {
  return [
    field(glyphCount, (record) => view.getInt16(record, true) / units),
    field(glyphCount, (record) => view.getInt16(record + 6, true) / units),
    field(glyphCount, (record) => (view.getInt16(record + 4, true) - view.getInt16(record, true)) / units),
    field(glyphCount, (record) => (view.getInt16(record + 6, true) - view.getInt16(record + 2, true)) / units),
    field(glyphCount, (record) => atlasValue(view, record, pages, binding, 8, 'width')),
    field(glyphCount, (record) => atlasValue(view, record, pages, binding, 10, 'height')),
    field(glyphCount, (record) => atlasSpan(view, record, pages, binding, 8, 12, 'width')),
    field(glyphCount, (record) => atlasSpan(view, record, pages, binding, 10, 14, 'height')),
  ];
}

function atlasValue(view, record, pages, binding, offset, dimension) {
  const page = view.getUint16(record + 16, true);
  return page === ABSENT_PAGE
    ? 0
    : view.getUint16(record + offset, true) / (binding?.[dimension] ?? pages[page][dimension]);
}

function atlasSpan(view, record, pages, binding, start, end, dimension) {
  const page = view.getUint16(record + 16, true);
  return page === ABSENT_PAGE
    ? 0
    : (view.getUint16(record + end, true) - view.getUint16(record + start, true)) /
        (binding?.[dimension] ?? pages[page][dimension]);
}

function pageIndices(view, glyphCount, arrayResource = false, stride = 20) {
  return field(
    glyphCount,
    (record) => {
      const page = view.getUint16(record + 16, true);
      return page === ABSENT_PAGE ? MISSING_RESOURCE : arrayResource ? 0 : page;
    },
    stride,
  );
}

function field(glyphCount, read, stride = 20) {
  return Array.from({ length: glyphCount }, (_, glyph) => read(glyph * stride));
}

function recordView(records) {
  return new DataView(records.buffer, records.byteOffset, records.byteLength);
}

function resource(_, index) {
  return { id: index + 1, generation: 1, kind: 1, reference: index + 1 };
}

function scalarBytes(abi, scalar) {
  return scalar === abi.codec.scalarTypes.u16 ? 2 : 4;
}
