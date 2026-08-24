import {
  registerThreeRasterPlanProgram,
  threePolicyAbi,
  type ThreePlanProgramBuffer,
  type ThreePlanProgramMaterialContext,
} from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExamplePlanProgram } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader } from '@pmndrs/glyph-example-raster/tsl';

/** The external consumer's Three implementation of the portable glyph-example plan. */
const externalGlyphExampleThreeProgram = {
  technique: glyphExamplePlanProgram.technique,
  realizeResource: (resource: unknown) => resource,
  createMaterial(context: ThreePlanProgramMaterialContext<unknown>) {
    if (context.materialId !== 0) throw new TypeError('glyph-example does not implement custom text materials');
    const origins = floatBuffer(context.buffers, 1, 2);
    const sizes = floatBuffer(context.buffers, 2, 2);
    const colors = floatBuffer(context.buffers, 3, 4);
    const shader = glyphExampleTslShader({
      origin: storage(origins.attribute, 'vec2', origins.attribute.count).setPBO(true).element(context.instance),
      size: storage(sizes.attribute, 'vec2', sizes.attribute.count).setPBO(true).element(context.instance),
      color: storage(colors.attribute, 'vec4', colors.attribute.count).setPBO(true).element(context.instance),
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
};

export function registerExternalGlyphExampleThree(): void {
  registerThreeRasterPlanProgram(externalGlyphExampleThreeProgram);
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
