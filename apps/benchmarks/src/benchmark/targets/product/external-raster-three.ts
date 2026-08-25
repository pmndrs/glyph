import {
  registerThreeRasterPlanProgram,
  threePolicyAbi,
  type ThreePlanProgramBuffer,
  type ThreePlanProgramMaterialContext,
} from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExamplePlanProgram, glyphExampleShaderContract } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader, glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';

/** The external consumer's Three implementation of the portable glyph-example plan. */
const externalGlyphExampleThreeProgram = {
  technique: glyphExamplePlanProgram.technique,
  schema: glyphExamplePlanProgram.schema,
  variant: {
    id: 'tsl',
    language: 'tsl',
    buffers: glyphExampleTslVariant.buffers,
    resources: glyphExampleTslVariant.resources,
    outputs: glyphExampleTslVariant.outputs,
    geometry: glyphExampleTslVariant.geometry,
    createMaterial(context: ThreePlanProgramMaterialContext) {
      const origins = floatBuffer(
        context.namedBuffers,
        'origin',
        glyphExampleShaderContract.buffers.origin.vectorWidth,
      );
      const sizes = floatBuffer(context.namedBuffers, 'size', glyphExampleShaderContract.buffers.size.vectorWidth);
      const colors = floatBuffer(context.namedBuffers, 'color', glyphExampleShaderContract.buffers.color.vectorWidth);
      const shader = glyphExampleTslShader({
        origin: storage(origins.attribute, 'vec2', origins.attribute.count).setPBO(true).element(context.instance),
        size: storage(sizes.attribute, 'vec2', sizes.attribute.count).setPBO(true).element(context.instance),
        color: storage(colors.attribute, 'vec4', colors.attribute.count).setPBO(true).element(context.instance),
        quadPosition: positionLocal,
        quadUv: uv(),
        transformPosition: context.transformPosition,
      });
      const createDefaultMaterial = () => {
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
      };
      return (
        context.material?.create({
          technique: context.technique,
          outputs: new Map<string, THREE.Node>([
            ['position', shader.position],
            ['color', shader.color],
            ['opacity', shader.opacity],
          ]),
          position: shader.position,
          createDefaultMaterial,
        }) ?? createDefaultMaterial()
      );
    },
  },
};

export function registerExternalGlyphExampleThree(): void {
  registerThreeRasterPlanProgram(externalGlyphExampleThreeProgram);
}

function floatBuffer(
  buffers: ReadonlyMap<string, ThreePlanProgramBuffer>,
  name: string,
  vectorWidth: number,
): ThreePlanProgramBuffer {
  const buffer = buffers.get(name);
  if (
    buffer === undefined ||
    buffer.scalarType !== threePolicyAbi.scalarTypes.f32 ||
    buffer.vectorWidth !== vectorWidth
  ) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} policy buffer "${name}"`);
  }
  return buffer;
}
