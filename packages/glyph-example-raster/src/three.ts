import { registerThreeRasterPlanProgram, threePolicyAbi, type ThreePlanProgramBuffer } from '@pmndrs/glyph/three';
import { add, min, mul, positionLocal, step, storage, sub, uv, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExamplePlanProgram } from './portable.js';

registerThreeRasterPlanProgram({
  technique: glyphExamplePlanProgram.technique,
  realizeResource: (resource) => resource,
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

function floatBuffer(
  buffers: ReadonlyMap<number, ThreePlanProgramBuffer>,
  id: number,
  vectorWidth: number,
): ThreePlanProgramBuffer {
  const buffer = buffers.get(id);
  if (
    buffer === undefined ||
    buffer.scalarType !== threePolicyAbi.scalarTypes.f32 ||
    buffer.vectorWidth !== vectorWidth
  ) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} policy buffer ${id}`);
  }
  return buffer;
}
