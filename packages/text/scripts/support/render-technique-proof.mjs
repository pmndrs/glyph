import { fontBindingBytes, renderPolicyBytesFromPrograms } from '../../tests/support/engine-abi.mjs';

const ABSENT_PAGE = 0xffff;
const MISSING_RESOURCE = 0xffff_ffff;
const TECHNIQUE_ID = 1;

export function techniqueProof(abi, name, raster, allocation = 'ordered') {
  if (name === 'bitmap') return bitmapProof(abi, raster, allocation);
  if (name === 'mtsdf') return mtsdfProof(abi, raster, allocation);
  if (name === 'slug') return slugProof(abi, raster, allocation);
  throw new RangeError(`unknown render technique ${name}`);
}

function bitmapProof(abi, raster, allocation) {
  const strike = raster.strikes[0];
  const view = recordView(strike.records);
  const binding = {
    width: Math.max(...strike.pages.map((page) => page.width)),
    height: Math.max(...strike.pages.map((page) => page.height)),
  };
  const fields = denseAtlasFields(view, raster.glyphCount, strike.planeUnitsPerEm, strike.pages, binding);
  return proof(abi, bitmapProgram(abi, 'strike'), allocation, {
    glyphCount: raster.glyphCount,
    strikes: [strike.ppem],
    resources: [resource(undefined, 0)],
    resourceIndices: pageIndices(view, raster.glyphCount, true),
    strikeF32: fields,
    strikeU32: [field(raster.glyphCount, (record) => view.getUint16(record + 16, true))],
  });
}

function mtsdfProof(abi, raster, allocation) {
  const extension = raster.document.extensions.PMNDRS_font_distance_field;
  const view = recordView(raster.records);
  const binding = {
    width: Math.max(...raster.pages.map((page) => page.width)),
    height: Math.max(...raster.pages.map((page) => page.height)),
  };
  const fields = denseAtlasFields(view, raster.glyphCount, extension.planeUnitsPerEm, raster.pages, binding);
  fields.push(
    field(raster.glyphCount, (record) => {
      const page = view.getUint16(record + 16, true);
      if (page === ABSENT_PAGE) return 0;
      return view.getUint16(record + 12, true) / binding.width;
    }),
    field(raster.glyphCount, (record) => {
      const page = view.getUint16(record + 16, true);
      if (page === ABSENT_PAGE) return 0;
      return view.getUint16(record + 14, true) / binding.height;
    }),
  );
  return proof(abi, mtsdfProgram(abi), allocation, {
    glyphCount: raster.glyphCount,
    strikes: [0],
    resources: [{ id: 1, generation: 1, kind: 1, reference: 1 }],
    resourceIndices: pageIndices(view, raster.glyphCount, true),
    glyphF32: fields,
    glyphU32: [field(raster.glyphCount, (record) => view.getUint16(record + 16, true))],
  });
}

function slugProof(abi, raster, allocation) {
  const extension = raster.document.extensions.PMNDRS_font_slug;
  const view = recordView(raster.records);
  const units = extension.planeUnitsPerEm;
  const normalized = (offset) => field(raster.glyphCount, (record) => view.getInt16(record + offset, true) / units, 40);
  const left = normalized(0);
  const bottom = normalized(2);
  const right = normalized(4);
  const top = normalized(6);
  const width = left.map((value, index) => right[index] - value);
  const height = bottom.map((value, index) => top[index] - value);
  const horizontalBands = field(raster.glyphCount, (record) => view.getUint16(record + 10, true), 40);
  const verticalBands = field(raster.glyphCount, (record) => view.getUint16(record + 12, true), 40);
  const bandScaleX = width.map((value, index) => (value === 0 ? 0 : verticalBands[index] / value));
  const bandScaleY = height.map((value, index) => (value === 0 ? 0 : horizontalBands[index] / value));
  const fields = [
    left,
    top,
    width,
    height,
    bandScaleX,
    bandScaleY,
    left.map((value, index) => -value * bandScaleX[index]),
    bottom.map((value, index) => -value * bandScaleY[index]),
  ];
  const integers = [
    field(raster.glyphCount, (record) => view.getUint32(record + 16, true), 40),
    field(raster.glyphCount, (record) => view.getUint32(record + 24, true), 40),
    field(raster.glyphCount, (record) => view.getUint32(record + 28, true), 40),
    field(raster.glyphCount, (record) => view.getUint32(record + 32, true), 40),
    horizontalBands,
    verticalBands,
  ];
  return proof(abi, slugProgram(abi), allocation, {
    glyphCount: raster.glyphCount,
    strikes: [0],
    resources: raster.pages.map(resource),
    resourceIndices: field(
      raster.glyphCount,
      (record) => {
        const page = view.getUint16(record + 8, true);
        return page === ABSENT_PAGE ? MISSING_RESOURCE : page;
      },
      40,
    ),
    glyphF32: fields,
    glyphU32: integers,
  });
}

function proof(abi, descriptor, allocation, binding) {
  const allocationStrategy =
    allocation === 'stable'
      ? abi.policy.allocationStrategies.stableIndirect
      : abi.policy.allocationStrategies.orderedDirect;
  const selected = { ...descriptor, allocationStrategy };
  return {
    policyBytes: renderPolicyBytesFromPrograms(abi, [selected]),
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
  loadF32(15);
  loadU32(29, 0);
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
  return program(context, [...floatBuffers(abi, [2, 2, 2, 2, 4]), ...uintBuffers(abi, [1], 6)]);
}

function mtsdfProgram(abi) {
  const context = programContext(abi, 'glyph', 10, 1);
  const { operations: ops, loadF32, loadU32, binary, constantF32, storeF32 } = context;
  loadF32(17);
  loadU32(17, 0);
  binary('multiplyF32', 18, 7, 2);
  binary('addF32', 19, 0, 18);
  binary('multiplyF32', 20, 8, 2);
  binary('subtractF32', 21, 1, 20);
  binary('multiplyF32', 22, 9, 2);
  binary('multiplyF32', 23, 10, 2);
  ops.push({ opcode: abi.policy.opcodes.convertU32ToF32, target: 24, operand0: 17 });
  constantF32(25, 0);
  stores(storeF32, [
    [1, [19, 21, 22, 23]],
    [2, [11, 12, 13, 14]],
    [3, [11, 12, 15, 16]],
    [4, [3, 4, 5, 6]],
    [5, [25, 25, 25, 25]],
    [6, [25, 25, 25, 25]],
    [7, [25, 25, 25, 24]],
  ]);
  return program(context, floatBuffers(abi, [4, 4, 4, 4, 4, 4, 4]));
}

function slugProgram(abi) {
  const context = programContext(abi, 'glyph', 8, 6, true);
  const { loadF32, loadU32, binary, constantF32, constantU32, storeF32, storeU32 } = context;
  loadF32(16);
  for (let fieldIndex = 0; fieldIndex < 6; fieldIndex += 1) loadU32(21 + fieldIndex, fieldIndex);
  binary('multiplyF32', 16, 8, 2);
  binary('addF32', 17, 0, 16);
  binary('multiplyF32', 18, 9, 2);
  binary('subtractF32', 19, 1, 18);
  binary('multiplyF32', 20, 10, 2);
  binary('multiplyF32', 27, 11, 2);
  constantF32(28, 0);
  constantU32(29, 0);
  stores(storeF32, [
    [1, [17, 19, 20, 27]],
    [2, [8, 9, 10, 11]],
    [3, [12, 13, 14, 15]],
    [4, [3, 4, 5, 6]],
    [5, [7, 28, 28, 28]],
  ]);
  stores(storeU32, [
    [6, [21, 22, 23, 24]],
    [7, [25, 26, 29, 29]],
  ]);
  return program(context, [...floatBuffers(abi, [4, 4, 4, 4, 4]), ...uintBuffers(abi, [4, 4], 6)]);
}

function programContext(abi, bindingScope, bindingF32Count, bindingU32Count, inverseFontSize = false) {
  const operations = [];
  const semantic = abi.engine.semanticF32Fields;
  const inputs = [
    { scope: 'semantic', field: semantic.inlineOrigin },
    { scope: 'semantic', field: semantic.blockOrigin },
    { scope: 'semantic', field: semantic.fontSize },
    { scope: 'semantic', field: semantic.foregroundRed },
    { scope: 'semantic', field: semantic.foregroundGreen },
    { scope: 'semantic', field: semantic.foregroundBlue },
    { scope: 'semantic', field: semantic.foregroundAlpha },
    ...(inverseFontSize ? [{ scope: 'semantic', field: semantic.inverseFontSize }] : []),
    ...Array.from({ length: bindingF32Count }, (_, fieldIndex) => ({ scope: bindingScope, field: fieldIndex })),
    ...Array.from({ length: bindingU32Count }, (_, fieldIndex) => ({ scope: bindingScope, field: fieldIndex })),
  ];
  const f32InputCount = 7 + (inverseFontSize ? 1 : 0) + bindingF32Count;
  return {
    inputs,
    operations,
    loadF32(count) {
      for (let fieldIndex = 0; fieldIndex < count; fieldIndex += 1) {
        operations.push({ opcode: abi.policy.opcodes.loadF32, target: fieldIndex, operand0: fieldIndex });
      }
    },
    loadU32(target, fieldIndex) {
      operations.push({ opcode: abi.policy.opcodes.loadU32, target, operand0: fieldIndex });
    },
    binary(name, target, left, right) {
      operations.push({ opcode: abi.policy.opcodes[name], target, operand0: left, operand1: right });
    },
    constantF32(target, value) {
      operations.push({ opcode: abi.policy.opcodes.constantF32, target, immediate0: f32Bits(value) });
    },
    constantU32(target, value) {
      operations.push({ opcode: abi.policy.opcodes.constantU32, target, immediate0: value });
    },
    storeF32(buffer, lane, register) {
      operations.push({
        opcode: abi.policy.opcodes.storeF32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
    storeU32(buffer, lane, register) {
      operations.push({
        opcode: abi.policy.opcodes.storeU32,
        operand0: register,
        operand1: lane,
        immediate0: buffer,
      });
    },
    f32InputCount,
    u32InputCount: bindingU32Count,
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
  return widths.map((vectorWidth, index) => ({ id: index + 1, scalar: abi.policy.scalarTypes.f32, vectorWidth }));
}

function uintBuffers(abi, widths, firstId) {
  return widths.map((vectorWidth, index) => ({ id: firstId + index, scalar: abi.policy.scalarTypes.u32, vectorWidth }));
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
  return scalar === abi.policy.scalarTypes.u16 ? 2 : 4;
}

function f32Bits(value) {
  const bytes = new ArrayBuffer(4);
  new DataView(bytes).setFloat32(0, value, true);
  return new DataView(bytes).getUint32(0, true);
}
