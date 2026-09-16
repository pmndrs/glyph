import { msdf } from '@pmndrs/glyph/raster/msdf';
import { msdfShader as nativeMsdfShader } from '@pmndrs/glyph/shaders/tsl/msdf';
import { defineTextMaterial, type Text } from '@pmndrs/glyph/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

const msdfShader =
  new URLSearchParams(location.search).get('shaders') === 'typegpu'
    ? (await import('@pmndrs/glyph/three/typegpu')).msdfShader
    : nativeMsdfShader;

/** Independent constant atlas samples prove channel choice, sign, layer selection, and screen-space units. */
async function proveDistanceSamples(renderer: THREE.WebGPURenderer): Promise<number> {
  const bytes = new Uint8Array(4 * 4 * 4 * 2);
  const colors = [
    [32, 192, 64, 224],
    [192, 32, 224, 64],
  ] as const;
  for (let layer = 0; layer < colors.length; layer += 1) {
    for (let texel = 0; texel < 16; texel += 1) bytes.set(colors[layer]!, (layer * 16 + texel) * 4);
  }
  const previousTarget = renderer.getRenderTarget();
  let atlas: THREE.DataArrayTexture | undefined;
  let target: THREE.RenderTarget | undefined;
  let geometry: THREE.PlaneGeometry | undefined;
  let samples = 0;
  try {
    atlas = new THREE.DataArrayTexture(bytes, 4, 4, 2);
    target = new THREE.RenderTarget(64, 64, { format: THREE.RGBAFormat, type: THREE.FloatType });
    geometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    atlas.needsUpdate = true;
    target.texture.colorSpace = THREE.NoColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;
    renderer.setRenderTarget(target);
    for (const layer of [0, 1]) {
      for (const scale of [1, 0.5]) {
        const shader = msdfShader(
          {
            origin: TSL.vec2(-scale / 2),
            size: TSL.vec2(scale),
            uvOrigin: TSL.vec2(0),
            uvSize: TSL.vec2(1),
            uvBounds: TSL.vec4(0, 0, 1, 1),
            fillColor: TSL.vec4(1),
            effectColor: TSL.uvec2(0),
            shadowOffset: TSL.vec2(0),
            outlineWidth: TSL.float(0),
            pageIndex: TSL.float(layer),
          },
          { atlas, atlasWidth: 4, atlasHeight: 4, pixelRange: 8 },
        );
        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, blending: THREE.NoBlending });
        material.positionNode = shader.position;
        material.outputNode = TSL.vec4(shader.fillDistance, shader.trueDistance, shader.pixelRange, 1);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.z = scale === 0.5 ? Math.PI / 4 : 0;
        scene.add(mesh);
        try {
          await renderer.renderAsync(scene, camera);
          const pixel = await renderer.readRenderTargetPixelsAsync(target, 32, 32, 1, 1);
          // A 64*scale screen-pixel quad spans four atlas texels with an eight-texel full distance range.
          const expected = [(layer === 0 ? 64 : 192) / 255 - 0.5, (layer === 0 ? 224 : 64) / 255 - 0.5, 128 * scale];
          for (let channel = 0; channel < expected.length; channel += 1) {
            // Raster interpolation and reciprocal-square-root precision allow 0.1% range error after rotation.
            const tolerance = channel === 2 ? expected[channel]! * 0.001 : 0.00001;
            if (!Number.isFinite(pixel[channel]) || Math.abs(pixel[channel]! - expected[channel]!) > tolerance) {
              throw new Error(
                `MSDF distance layer=${layer} scale=${scale} channel=${channel}: ${pixel[channel]} != ${expected[channel]}`,
              );
            }
          }
          samples += 1;
        } finally {
          mesh.removeFromParent();
          material.dispose();
        }
      }
    }
    return samples;
  } finally {
    renderer.setRenderTarget(previousTarget);
    geometry?.dispose();
    target?.dispose();
    atlas?.dispose();
  }
}

export interface MsdfDistanceProof {
  readonly distanceSamples: number;
  readonly distanceCoverageMatches: boolean;
  readonly glowPixelsOutsideCoverage: number;
}

/** A real font material reproduces canonical fill, then uses the unclamped field to light pixels outside it. */
export async function proveMsdfDistanceMaterial(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.RenderTarget,
  text: Text<typeof msdf>,
): Promise<MsdfDistanceProof> {
  const distanceSamples = await proveDistanceSamples(renderer);
  const previousMaterial = text.material;
  const baseline = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
  try {
    text.material = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      if (context.kind === 'glyph' && context.format === msdf.id) {
        material.opacityNode = TSL.clamp(context.shader.fillDistance.mul(context.shader.pixelRange).add(0.5), 0, 1);
      }
      return material;
    });
    await renderer.renderAsync(scene, camera);
    if (text.error !== undefined) throw text.error;
    const reconstructed = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    const distanceCoverageMatches = reconstructed.every((value, index) => value === baseline[index]);
    if (!distanceCoverageMatches) throw new Error('MSDF distance reconstruction changed canonical fill pixels');

    text.material = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      if (context.kind === 'glyph' && context.format === msdf.id) {
        const pixels = context.shader.trueDistance.mul(context.shader.pixelRange);
        material.colorNode = TSL.vec3(1, 0, 0);
        material.opacityNode = TSL.max(context.shader.opacity, TSL.smoothstep(-1.5, 0, pixels).mul(0.5));
      }
      return material;
    });
    await renderer.renderAsync(scene, camera);
    if (text.error !== undefined) throw text.error;
    const glow = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
    let glowPixelsOutsideCoverage = 0;
    for (let offset = 0; offset < glow.length; offset += 4) {
      if (baseline[offset] === 0 && baseline[offset + 1] === 0 && baseline[offset + 2] === 0 && glow[offset]! > 8) {
        glowPixelsOutsideCoverage += 1;
      }
    }
    if (glowPixelsOutsideCoverage === 0) throw new Error('MSDF glow did not extend beyond canonical coverage');
    return { distanceSamples, distanceCoverageMatches, glowPixelsOutsideCoverage };
  } finally {
    text.material = previousMaterial;
  }
}
