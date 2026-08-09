import type {
  GlyphBatchKey,
  LoadedFont,
  ParagraphBatchTarget,
  ParagraphBatchTargetUpdate,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '@pmndrs/text';
import { defineRasterTechnique } from '@pmndrs/text';
import { bitmap, type BitmapPageData } from '@pmndrs/text/three/bitmap';
import {
  bitmapShader,
  FontLoader,
  registerThreeRasterProgram,
  Text,
  type ThreeRasterTargetOwner,
} from '@pmndrs/text/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

declare global {
  interface Window {
    targetV1ComposeReady: Promise<TargetV1ComposeResult>;
  }
}

interface TargetV1ComposeResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly drawCount: number;
  readonly glyphCount: number;
  readonly litPixels: number;
  readonly redPixels: number;
  readonly greenPixels: number;
  readonly canonicalLitPixels: number;
  readonly canonicalGreenPixels: number;
}

/**
 * A third-party technique is only a distinct program key here: every portable operation stays the first-party Bitmap
 * implementation, so any rendering difference this proof observes comes from the composed shader alone.
 */
const composedBitmap = defineRasterTechnique({ ...bitmap, id: 'benchmarks.composed-bitmap' });

/**
 * The composed program keeps the canonical position and coverage and tints only the resolved colour. Preserving the
 * canonical glyph footprint while changing the paint is what proves it reuses the exported technique shader.
 */
registerThreeRasterProgram(composedBitmap, (owner) => new ComposedBitmapTarget(owner));

window.targetV1ComposeReady = render();

async function render(): Promise<TargetV1ComposeResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('target-v1 compose proof canvas is missing');
  const forceWebGL = new URLSearchParams(location.search).get('backend') === 'webgl2';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const loader = new FontLoader();
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  target.texture.colorSpace = THREE.NoColorSpace;
  let canonicalText: Text<typeof bitmap> | undefined;
  let composedText: Text<typeof composedBitmap> | undefined;
  let canonicalFont: LoadedFont<typeof bitmap> | undefined;
  let composedFont: LoadedFont<typeof composedBitmap> | undefined;
  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    await renderer.init();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
    camera.position.z = 1;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);

    canonicalFont = await loader.loadAsync({
      input: { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
      raster: { technique: bitmap, options: { strikes: [16] } },
    });
    canonicalText = new Text({
      font: canonicalFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28 },
      paint: { color: '#ffffff' },
    });
    canonicalText.position.set(-112, 24, 0);
    scene.add(canonicalText);
    await renderer.renderAsync(scene, camera);
    const canonical = await countPixels(renderer, target);
    canonicalText.removeFromParent();
    canonicalText.dispose();
    canonicalText = undefined;

    composedFont = await loader.loadAsync({
      input: { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
      raster: { technique: composedBitmap, options: { strikes: [16] } },
    });
    composedText = new Text({
      font: composedFont,
      text: 'Target v1 Bitmap',
      style: { fontSize: 28 },
      paint: { color: '#ffffff' },
    });
    composedText.position.set(-112, 24, 0);
    scene.add(composedText);
    await renderer.renderAsync(scene, camera);
    const composed = await countPixels(renderer, target);

    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      drawCount: composedText.children.filter((child) => child instanceof THREE.Mesh).length,
      glyphCount: composedText.measureLayout()?.glyphCount ?? 0,
      litPixels: composed.lit,
      redPixels: composed.red,
      greenPixels: composed.green,
      canonicalLitPixels: canonical.lit,
      canonicalGreenPixels: canonical.green,
    };
  } finally {
    canonicalText?.removeFromParent();
    canonicalText?.dispose();
    composedText?.removeFromParent();
    composedText?.dispose();
    canonicalFont?.dispose();
    composedFont?.dispose();
    loader.dispose();
    target.dispose();
    renderer.dispose();
  }
}

interface PixelCounts {
  readonly lit: number;
  readonly red: number;
  readonly green: number;
}

async function countPixels(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget): Promise<PixelCounts> {
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
  let lit = 0;
  let red = 0;
  let green = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) lit += 1;
    if (pixels[offset]! > 8) red += 1;
    if (pixels[offset + 1]! > 8) green += 1;
  }
  return { lit, red, green };
}

interface ComposedRevision {
  readonly sourceRevision: number;
  dispose(): void;
}

interface ComposedResource {
  readonly material: THREE.MeshBasicNodeMaterial;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

/**
 * A deliberately minimal third-party Three program: it owns its own attributes, geometry, and material, and rebuilds
 * them on every revision. Only the node graph is shared, and it comes from the exported canonical Bitmap shader.
 */
class ComposedBitmapTarget implements ParagraphBatchTarget<typeof composedBitmap, never, ComposedRevision> {
  readonly technique: typeof composedBitmap = composedBitmap;
  readonly #owner: ThreeRasterTargetOwner;
  readonly #textures = new Map<string, THREE.DataTexture>();

  constructor(owner: ThreeRasterTargetOwner) {
    this.#owner = owner;
  }

  stage(
    _previous: ComposedRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof composedBitmap, never>,
  ): ParagraphBatchTargetUpdate<ComposedRevision> {
    const resources = new Map<GlyphBatchKey, ComposedResource>();
    for (const batch of next.glyphBatches) resources.set(batch.key, this.#createResource(batch));
    const draws: THREE.Mesh[] = [];
    const parents: ParagraphId[] = [];
    for (let index = 0; index < next.glyphRuns.length; index += 1) {
      const run = next.glyphRuns[index]!;
      const resource = resources.get(run.batch);
      if (resource === undefined) throw new Error('composed run references an unknown physical batch');
      const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
      mesh.userData.pmndrsTextRunStart = run.start;
      mesh.frustumCulled = false;
      mesh.renderOrder = this.#owner.renderOrderBase + index;
      draws.push(mesh);
      parents.push(run.paragraph);
    }
    const dispose = (): void => {
      for (const draw of draws) {
        draw.removeFromParent();
        draw.geometry.dispose();
      }
      for (const resource of resources.values()) resource.dispose();
    };
    let finished = false;
    return {
      status: 'ready',
      stage: {
        sourceRevision: next.revision,
        commit: () => {
          if (finished) throw new Error('composed stage is no longer active');
          finished = true;
          for (let index = 0; index < draws.length; index += 1)
            this.#owner.objectForParagraph(parents[index]!).add(draws[index]!);
          return { sourceRevision: next.revision, dispose };
        },
        abort: () => {
          if (finished) return;
          finished = true;
          dispose();
        },
      },
    };
  }

  dispose(): void {
    for (const texture of this.#textures.values()) texture.dispose();
    this.#textures.clear();
  }

  #createResource(batch: PreparedGlyphBatch<typeof composedBitmap>): ComposedResource {
    const page = batch.font.data.strikes[batch.binding.strike]?.pages[batch.binding.page];
    if (page === undefined) throw new TypeError('composed binding references a missing decoded page');
    const storage = batch.storage;
    const origins = storageAttribute(storage.origins, 2);
    const sizes = storageAttribute(storage.sizes, 2);
    const uvOrigins = storageAttribute(storage.uvOrigins, 2);
    const uvSizes = storageAttribute(storage.uvSizes, 2);
    const colors = storageAttribute(storage.colors, 4);
    const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
      ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
    );
    const instance = TSL.instanceIndex.add(runStart);
    const shader = bitmapShader(
      {
        origin: TSL.storage(origins, 'vec2', origins.count).setPBO(true).element(instance),
        size: TSL.storage(sizes, 'vec2', sizes.count).setPBO(true).element(instance),
        uvOrigin: TSL.storage(uvOrigins, 'vec2', uvOrigins.count).setPBO(true).element(instance),
        uvSize: TSL.storage(uvSizes, 'vec2', uvSizes.count).setPBO(true).element(instance),
        color: TSL.storage(colors, 'vec4', colors.count).setPBO(true).element(instance),
      },
      { page: this.#texture(page) },
    );
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.positionNode = shader.position;
    material.vertexNode = shader.clipPosition;
    material.colorNode = shader.color.mul(TSL.vec3(1, 0, 0));
    material.opacityNode = shader.opacity;
    return {
      material,
      geometry(count) {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        geometry.instanceCount = count;
        geometry.setAttribute('_composedOrigins', origins);
        geometry.setAttribute('_composedSizes', sizes);
        geometry.setAttribute('_composedUvOrigins', uvOrigins);
        geometry.setAttribute('_composedUvSizes', uvSizes);
        geometry.setAttribute('_composedColors', colors);
        return geometry;
      },
      dispose() {
        material.dispose();
      },
    };
  }

  #texture(page: BitmapPageData): THREE.DataTexture {
    let texture = this.#textures.get(page.resource);
    if (texture !== undefined) return texture;
    texture = new THREE.DataTexture(page.bytes, page.width, page.height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    this.#textures.set(page.resource, texture);
    return texture;
  }
}

function storageAttribute(array: Float32Array, itemSize: number): THREE.StorageInstancedBufferAttribute {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(array), itemSize);
  attribute.setUsage(THREE.DynamicDrawUsage);
  attribute.needsUpdate = true;
  return attribute;
}
