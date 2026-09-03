import {
  registerThreeRasterProgram,
  threeCodecAbi,
  type ThreeRasterProgramBuffer,
  type ThreeRasterMaterialContext,
  type ThreeRootContext,
} from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExampleCodec, glyphExampleShaderContract } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader, glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';

declare module '@pmndrs/glyph/three' {
  interface ThreeTextMaterialContextMap {
    readonly 'studio.glyph-example': Readonly<{
      root: ThreeRootContext;
      kind: 'glyph';
      format: 'studio.glyph-example';
      outputs: ReadonlyMap<string, THREE.Node>;
      position: THREE.Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    }>;
  }
}

/** The external consumer's Three implementation of the portable glyph-example Codec. */
const externalGlyphExampleThreeProgram = {
  raster: glyphExampleCodec.raster,
  schema: glyphExampleCodec.schema,
  variant: {
    id: 'tsl',
    language: 'tsl',
    buffers: glyphExampleTslVariant.buffers,
    resources: glyphExampleTslVariant.resources,
    outputs: glyphExampleTslVariant.outputs,
    geometry: glyphExampleTslVariant.geometry,
    createMaterial(context: ThreeRasterMaterialContext) {
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
          root: context.root,
          kind: 'glyph',
          format: glyphExampleCodec.raster.id,
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
  registerThreeRasterProgram(externalGlyphExampleThreeProgram);
}

function floatBuffer(
  buffers: ReadonlyMap<string, ThreeRasterProgramBuffer>,
  name: string,
  vectorWidth: number,
): ThreeRasterProgramBuffer {
  const buffer = buffers.get(name);
  if (
    buffer === undefined ||
    buffer.scalarType !== threeCodecAbi.scalarTypes.f32 ||
    buffer.vectorWidth !== vectorWidth
  ) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} codec buffer "${name}"`);
  }
  return buffer;
}
