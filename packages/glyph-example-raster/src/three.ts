import { registerThreeRasterPlanProgram, threePolicyAbi, type ThreePlanProgramBuffer } from '@pmndrs/text/three';
import { add, min, mul, positionLocal, step, storage, sub, uv, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExample, type GlyphExampleData } from './raster.js';

const opcodes = threePolicyAbi.opcodes;
const scalar = threePolicyAbi.scalarTypes;
const semantic = threePolicyAbi.semanticF32Fields;
const semanticU32 = threePolicyAbi.semanticU32Fields;
const batch = threePolicyAbi.batchFields;

registerThreeRasterPlanProgram({
  technique: glyphExample,
  policy: {
    f32InputCount: 12,
    u32InputCount: 1,
    inputs: [
      { scope: 'semantic', field: semantic.inlineStart },
      { scope: 'semantic', field: semantic.blockStart },
      { scope: 'semantic', field: semantic.fontSize },
      { scope: 'semantic', field: semantic.foregroundRed },
      { scope: 'semantic', field: semantic.foregroundGreen },
      { scope: 'semantic', field: semantic.foregroundBlue },
      { scope: 'semantic', field: semantic.foregroundAlpha },
      ...Array.from({ length: 5 }, (_, field) => ({ scope: 'glyph' as const, field })),
      { scope: 'semantic', field: semanticU32.transformIndex },
    ],
    buffers: [
      { id: 1, scalar: scalar.f32, vectorWidth: 2 },
      { id: 2, scalar: scalar.f32, vectorWidth: 2 },
      { id: 3, scalar: scalar.f32, vectorWidth: 4 },
      { id: threePolicyAbi.transformBufferId, scalar: scalar.u32, vectorWidth: 1 },
    ],
    operations: glyphExampleOperations(),
    storageKeyMask: batch.technique | batch.program | batch.resource,
    drawKeyMask:
      batch.technique | batch.program | batch.resource | batch.material | batch.clip | batch.depth | batch.order,
  },
  compileFont(compiler) {
    const data = compiler.font.data as GlyphExampleData;
    const { resources } = compiler.resources([data.resource]);
    compiler.retain(data.resource, data);
    compiler.compile({
      techniqueId: compiler.techniqueId,
      programVariant: 0,
      glyphCount: compiler.font.font.glyphCount,
      strikes: [0],
      resources,
      resourceIndex: () => 0,
      glyphF32: {
        rows: data.glyphCount,
        fields: [
          () => data.binding.inset,
          (row) => data.colors[row * 4]! / 255,
          (row) => data.colors[row * 4 + 1]! / 255,
          (row) => data.colors[row * 4 + 2]! / 255,
          (row) => data.colors[row * 4 + 3]! / 255,
        ],
      },
      glyphU32: compiler.emptyTable(data.glyphCount),
      strikeF32: compiler.emptyTable(data.glyphCount),
      strikeU32: compiler.emptyTable(data.glyphCount),
      resourceF32: compiler.emptyTable(resources.length),
      resourceU32: compiler.emptyTable(resources.length),
    });
  },
  createMaterial(context) {
    if (context.materialId !== 0) {
      throw new TypeError('glyph-example does not implement custom text materials');
    }
    const origins = floatBuffer(context.buffers, 1, 2);
    const sizes = floatBuffer(context.buffers, 2, 2);
    const colors = floatBuffer(context.buffers, 3, 4);
    const origin = storage(origins.attribute, 'vec2', origins.attribute.count).setPBO(true).element(context.instance);
    const size = storage(sizes.attribute, 'vec2', sizes.attribute.count).setPBO(true).element(context.instance);
    const color = storage(colors.attribute, 'vec4', colors.attribute.count).setPBO(true).element(context.instance);
    const unit = uv();
    const edgeDistance = min(min(unit.x, sub(1, unit.x)), min(unit.y, sub(1, unit.y)));
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.positionNode = context.transformPosition(
      vec3(add(origin.x, mul(positionLocal.x, size.x)), add(origin.y, mul(positionLocal.y, size.y)).negate(), 0),
    );
    material.colorNode = color.rgb;
    material.opacityNode = mul(color.a, sub(1, step(0.08, edgeDistance)));
    return material;
  },
});

function glyphExampleOperations() {
  const operations: Array<{
    opcode: number;
    target?: number;
    operand0?: number;
    operand1?: number;
    immediate0?: number;
  }> = [];
  for (let field = 0; field < 12; field += 1) {
    operations.push({ opcode: opcodes.loadF32, target: field, operand0: field });
  }
  operations.push({ opcode: opcodes.loadU32, target: 31, operand0: 0 });
  operations.push({ opcode: opcodes.multiplyF32, target: 12, operand0: 7, operand1: 2 });
  operations.push({ opcode: opcodes.addF32, target: 13, operand0: 0, operand1: 12 });
  operations.push({ opcode: opcodes.constantF32, target: 14, immediate0: f32Bits(0.8) });
  operations.push({ opcode: opcodes.multiplyF32, target: 15, operand0: 2, operand1: 14 });
  operations.push({ opcode: opcodes.subtractF32, target: 16, operand0: 1, operand1: 15 });
  operations.push({ opcode: opcodes.addF32, target: 17, operand0: 16, operand1: 12 });
  operations.push({ opcode: opcodes.constantF32, target: 18, immediate0: f32Bits(0.05) });
  operations.push({ opcode: opcodes.multiplyF32, target: 19, operand0: 2, operand1: 18 });
  operations.push({ opcode: opcodes.constantF32, target: 20, immediate0: f32Bits(0.65) });
  operations.push({ opcode: opcodes.multiplyF32, target: 21, operand0: 2, operand1: 20 });
  operations.push({ opcode: opcodes.constantF32, target: 22, immediate0: f32Bits(2) });
  operations.push({ opcode: opcodes.multiplyF32, target: 23, operand0: 12, operand1: 22 });
  operations.push({ opcode: opcodes.subtractF32, target: 24, operand0: 21, operand1: 23 });
  operations.push({ opcode: opcodes.lessThanF32, target: 25, operand0: 24, operand1: 19 });
  operations.push({ opcode: opcodes.selectF32, target: 26, operand0: 25, operand1: 19, immediate0: 24 });
  operations.push({ opcode: opcodes.subtractF32, target: 27, operand0: 2, operand1: 23 });
  operations.push({ opcode: opcodes.lessThanF32, target: 28, operand0: 27, operand1: 19 });
  operations.push({ opcode: opcodes.selectF32, target: 29, operand0: 28, operand1: 19, immediate0: 27 });
  storeF32(operations, 1, 0, 13);
  storeF32(operations, 1, 1, 17);
  storeF32(operations, 2, 0, 26);
  storeF32(operations, 2, 1, 29);
  for (let channel = 0; channel < 4; channel += 1) {
    operations.push({ opcode: opcodes.multiplyF32, target: 12, operand0: 3 + channel, operand1: 8 + channel });
    storeF32(operations, 3, channel, 12);
  }
  operations.push({
    opcode: opcodes.storeU32,
    operand0: 31,
    operand1: 0,
    immediate0: threePolicyAbi.transformBufferId,
  });
  return operations;
}

function storeF32(
  operations: Array<{ opcode: number; operand0?: number; operand1?: number; immediate0?: number }>,
  buffer: number,
  lane: number,
  register: number,
): void {
  operations.push({ opcode: opcodes.storeF32, operand0: register, operand1: lane, immediate0: buffer });
}

function floatBuffer(
  buffers: ReadonlyMap<number, ThreePlanProgramBuffer>,
  id: number,
  vectorWidth: number,
): ThreePlanProgramBuffer {
  const buffer = buffers.get(id);
  if (buffer === undefined || buffer.scalarType !== scalar.f32 || buffer.vectorWidth !== vectorWidth) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} policy buffer ${id}`);
  }
  return buffer;
}

function f32Bits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
