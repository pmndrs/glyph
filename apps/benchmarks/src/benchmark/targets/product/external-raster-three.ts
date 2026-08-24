import { registerThreeRasterPlanProgram, threePolicyAbi, type ThreePlanProgramBuffer } from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader } from '@pmndrs/glyph-example-raster/tsl';

let registered = false;

/** The external consumer's Three implementation of the portable glyph-example plan. */
export function registerExternalGlyphExampleThree(): void {
  if (registered) return;
  registered = true;
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
      const shader = glyphExampleTslShader({
        origin,
        size,
        color,
        quadPosition: positionLocal,
        quadUv: uv(),
        transformPosition: context.transformPosition,
      });
      const material = new THREE.MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        transparent: true,
      });
      material.positionNode = shader.position;
      material.colorNode = shader.color;
      material.opacityNode = shader.opacity;
      return material;
    },
  });
}

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
