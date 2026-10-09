import { bitmap, glyph, span, txt, type FontFace, type TextLiteral, type TextSpanFragment } from '@pmndrs/glyph';
import type { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from './three-root';

declare global {
  interface Window {
    retainedUploadReady: Promise<RetainedUploadResult>;
  }
}

interface UploadSnapshot {
  readonly attributeCreateBytes: number;
  readonly attributeCreateCalls: number;
  readonly attributeUpdateBytes: number;
  readonly attributeUpdateCalls: number;
  readonly pboTextureCreateBytes: number;
  readonly pboTextureCreateCalls: number;
  readonly pboTextureUpdateBytes: number;
  readonly pboTextureUpdateCalls: number;
}

interface PhaseResult {
  readonly publicationMs: number;
  readonly schedulingMs: number;
  readonly pixelHash: string;
  readonly litPixels: number;
  readonly draws: number;
  readonly instances: number;
  readonly uploads: UploadSnapshot;
}

interface StorageSummary {
  readonly attributes: number;
  readonly bytes: number;
  readonly usage: readonly number[];
  readonly versions: readonly number[];
}

interface ShaderSummary {
  readonly language: 'wgsl' | 'glsl';
  readonly vertexBytes: number;
  readonly fragmentBytes: number;
  readonly vertexHash: string;
  readonly fragmentHash: string;
  readonly storageResourceDeclarations: number;
}

export interface RetainedUploadResult {
  readonly backend: 'webgpu' | 'webgl2';
  readonly expectedUsage: 'dynamic' | 'stream';
  readonly initial: PhaseResult;
  readonly changedContents: PhaseResult;
  readonly changedCount: PhaseResult;
  readonly resized: PhaseResult;
  readonly drawReplacement: PhaseResult;
  readonly transform: PhaseResult;
  readonly idle: Readonly<{
    frames: number;
    medianCpuMs: number;
    p95CpuMs: number;
    totalCpuMs: number;
    uploads: UploadSnapshot;
    versionsUnchanged: boolean;
  }>;
  readonly storage: StorageSummary;
  readonly shader: ShaderSummary;
}

interface StorageAttributeFlags {
  readonly isStorageBufferAttribute?: boolean;
  readonly isStorageInstancedBufferAttribute?: boolean;
}

interface AttributeState {
  version?: number;
}

interface ObservableAttributes {
  get(attribute: THREE.BufferAttribute): AttributeState;
  update(attribute: THREE.BufferAttribute, type: number): void;
}

interface TextureState {
  initialized?: boolean;
  version?: number;
}

interface PboTexture extends THREE.Texture {
  readonly isPBOTexture?: boolean;
  readonly image: Readonly<{ readonly data?: ArrayBufferView }>;
}

interface ObservableTextures {
  get(texture: THREE.Texture): TextureState;
  updateTexture(texture: THREE.Texture, options?: object): void;
}

interface ObservableRenderer extends THREE.WebGPURenderer {
  readonly _attributes: ObservableAttributes;
  readonly _textures: ObservableTextures;
}

const PALETTE = ['#f97316', '#facc15', '#22d3ee', '#a78bfa', '#f8fafc', '#34d399'] as const;
const RUN_LENGTH = 12;
const IDLE_FRAMES = 30;

window.retainedUploadReady = renderProof();

async function renderProof(): Promise<RetainedUploadResult> {
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
  if (canvas === null) throw new Error('retained upload proof canvas is missing');
  const query = new URLSearchParams(location.search);
  const forceWebGL = query.get('backend') === 'webgl2';
  const expectedUsage = query.get('usage') === 'dynamic' ? 'dynamic' : 'stream';
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  const target = new THREE.RenderTarget(512, 512, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const root = createBenchmarkThreeRoot('retained-upload', { capacity: { size: 512, policy: 'grow' } });
  let text: Text<typeof bitmap> | undefined;
  let fontFace: FontFace<ReturnType<typeof bitmap>> | undefined;
  try {
    renderer.setSize(512, 512, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    target.texture.colorSpace = THREE.NoColorSpace;
    await renderer.init();
    const uploads = instrumentUploads(renderer as ObservableRenderer);
    fontFace = glyph.fontFace('/fixtures/rendering/inter-bitmap-16.font.glb', {
      format: bitmap({ strikes: [16] }),
    });
    await fontFace.load();
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-256, 256, 256, -256, 0.1, 10);
    camera.position.z = 1;
    const group = root.createTextGroup({ batching: 'group' });
    text = root.createText({
      font: fontFace,
      text: asciiFrame(240, 0),
      constraints: { width: { mode: 'exact', size: 480 } },
      layout: { align: 'start', wrap: 'none' },
      style: { color: '#ffffff', fontSize: 8, lineHeight: 1 },
    });
    text.position.set(-240, 240, 0);
    group.add(text);
    scene.add(group);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);

    const initial = await phase(renderer, target, scene, camera, root, uploads, () => {});
    const initialStorage = storageAttributes(rootDraws(scene));
    const expectedThreeUsage = expectedUsage === 'stream' ? THREE.StreamDrawUsage : THREE.DynamicDrawUsage;
    const versionDriven = initialStorage.filter(({ usage }) => usage === expectedThreeUsage);
    const oppositeUsage = expectedUsage === 'stream' ? THREE.DynamicDrawUsage : THREE.StreamDrawUsage;
    if (versionDriven.length === 0 || initialStorage.some(({ usage }) => usage === oppositeUsage)) {
      throw new Error(`retained attributes do not use expected ${expectedUsage} usage`);
    }
    const shader = emittedShader(renderer, rootDraws(scene)[0]!, scene, camera);

    const idleVersions = initialStorage.map(({ version }) => version);
    uploads.reset();
    const idleSamples: number[] = [];
    for (let frame = 0; frame < IDLE_FRAMES; frame += 1) {
      const started = performance.now();
      renderer.render(scene, camera);
      idleSamples.push(performance.now() - started);
    }
    await renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1);
    const idleUploads = uploads.snapshot();
    const idleVersionsAfter = initialStorage.map(({ version }) => version);
    const versionsUnchanged = idleVersions.every((version, index) => version === idleVersionsAfter[index]);
    if (!versionsUnchanged) throw new Error('an idle render advanced retained attribute versions');
    const idleUploadCalls =
      idleUploads.attributeUpdateCalls +
      idleUploads.attributeCreateCalls +
      idleUploads.pboTextureUpdateCalls +
      idleUploads.pboTextureCreateCalls;
    if (expectedUsage === 'stream' && idleUploadCalls !== 0) {
      throw new Error(`idle StreamDrawUsage rendered ${String(idleUploadCalls)} retained uploads`);
    }
    if (expectedUsage === 'dynamic' && !forceWebGL && idleUploads.attributeUpdateCalls === 0) {
      throw new Error('idle DynamicDrawUsage did not reproduce Three retained uploads');
    }

    const changedContents = await phase(renderer, target, scene, camera, root, uploads, () => {
      text!.set({ text: asciiFrame(240, 1) });
    });
    if (text.commitState().status !== 'committed') {
      throw new Error(`changed contents stayed ${text.commitState().status}`);
    }
    assertChangedUpload('changed contents', changedContents);
    const changedCount = await phase(renderer, target, scene, camera, root, uploads, () => {
      text!.set({ text: asciiFrame(120, 2) });
    });
    assertChangedUpload('changed count', changedCount);
    const resized = await phase(renderer, target, scene, camera, root, uploads, () => {
      text!.set({ text: asciiFrame(480, 3) });
    });
    if (resized.uploads.attributeCreateCalls + resized.uploads.pboTextureCreateCalls === 0) {
      throw new Error('capacity growth did not create replacement storage');
    }
    const drawsBeforeReplacement = rootDraws(scene);
    const drawReplacement = await phase(renderer, target, scene, camera, root, uploads, () => {
      text!.set({
        style: {
          color: '#ffffff',
          fontSize: 8,
          lineHeight: 1,
          decoration: { underline: true, color: '#38bdf8' },
        },
      });
    });
    if (rootDraws(scene).every((draw) => drawsBeforeReplacement.includes(draw))) {
      throw new Error('decoration topology did not replace a draw');
    }
    const transform = await phase(renderer, target, scene, camera, root, uploads, () => {
      text!.position.x += 7;
    });
    assertChangedUpload('transform', transform);

    const finalStorage = storageAttributes(rootDraws(scene));
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      expectedUsage,
      initial,
      changedContents,
      changedCount,
      resized,
      drawReplacement,
      transform,
      idle: {
        frames: IDLE_FRAMES,
        medianCpuMs: percentile(idleSamples, 0.5),
        p95CpuMs: percentile(idleSamples, 0.95),
        totalCpuMs: idleSamples.reduce((sum, sample) => sum + sample, 0),
        uploads: idleUploads,
        versionsUnchanged,
      },
      storage: {
        attributes: finalStorage.length,
        bytes: finalStorage.reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0),
        usage: finalStorage.map(({ usage }) => usage),
        versions: finalStorage.map(({ version }) => version),
      },
      shader,
    };
  } finally {
    text?.removeFromParent();
    text?.dispose();
    fontFace?.dispose();
    disposeBenchmarkThreeRoot(root);
    target.dispose();
    renderer.dispose();
  }
}

function instrumentUploads(renderer: ObservableRenderer): Readonly<{
  reset(): void;
  snapshot(): UploadSnapshot;
}> {
  let totals = emptyUploads();
  const attributes = renderer['_attributes'];
  const update = attributes.update.bind(attributes);
  attributes.update = (attribute, type): void => {
    const storage = attribute as THREE.BufferAttribute & StorageAttributeFlags;
    const retained = storage.isStorageBufferAttribute === true || storage.isStorageInstancedBufferAttribute === true;
    if (retained) {
      const state = attributes.get(attribute);
      if (state.version === undefined) {
        totals.attributeCreateCalls += 1;
        totals.attributeCreateBytes += attribute.array.byteLength;
      } else if (state.version < attribute.version || attribute.usage === THREE.DynamicDrawUsage) {
        totals.attributeUpdateCalls += attribute.updateRanges.length === 0 ? 1 : attribute.updateRanges.length;
        totals.attributeUpdateBytes +=
          attribute.updateRanges.length === 0
            ? attribute.array.byteLength
            : attribute.updateRanges.reduce(
                (bytes, range) => bytes + range.count * attribute.array.BYTES_PER_ELEMENT,
                0,
              );
      }
    }
    update(attribute, type);
  };
  const textures = renderer['_textures'];
  const updateTexture = textures.updateTexture.bind(textures);
  textures.updateTexture = (texture, options): void => {
    const pbo = texture as PboTexture;
    const state = textures.get(texture);
    const uploadsTexture =
      pbo.isPBOTexture === true && !(state.initialized === true && state.version === texture.version);
    if (uploadsTexture) {
      const byteLength = pbo.image.data?.byteLength ?? 0;
      if (state.initialized === true) {
        totals.pboTextureUpdateCalls += 1;
        totals.pboTextureUpdateBytes += byteLength;
      } else {
        totals.pboTextureCreateCalls += 1;
        totals.pboTextureCreateBytes += byteLength;
      }
    }
    updateTexture(texture, options);
  };
  return {
    reset() {
      totals = emptyUploads();
    },
    snapshot() {
      return { ...totals };
    },
  };
}

function emptyUploads(): {
  attributeCreateBytes: number;
  attributeCreateCalls: number;
  attributeUpdateBytes: number;
  attributeUpdateCalls: number;
  pboTextureCreateBytes: number;
  pboTextureCreateCalls: number;
  pboTextureUpdateBytes: number;
  pboTextureUpdateCalls: number;
} {
  return {
    attributeCreateBytes: 0,
    attributeCreateCalls: 0,
    attributeUpdateBytes: 0,
    attributeUpdateCalls: 0,
    pboTextureCreateBytes: 0,
    pboTextureCreateCalls: 0,
    pboTextureUpdateBytes: 0,
    pboTextureUpdateCalls: 0,
  };
}

async function phase(
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
  root: ReturnType<typeof createBenchmarkThreeRoot>,
  uploads: Readonly<{ reset(): void; snapshot(): UploadSnapshot }>,
  schedule: () => void,
): Promise<PhaseResult> {
  uploads.reset();
  const scheduleStarted = performance.now();
  schedule();
  const schedulingMs = performance.now() - scheduleStarted;
  const publicationStarted = performance.now();
  scene.updateMatrixWorld(true);
  const publicationMs = performance.now() - publicationStarted;
  renderer.render(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 512, 512);
  const draws = rootDraws(scene);
  return {
    publicationMs,
    schedulingMs,
    pixelHash: hashBytes(pixels),
    litPixels: litPixelCount(pixels),
    draws: draws.length,
    instances: draws.reduce(
      (count, draw) =>
        count + (draw.geometry instanceof THREE.InstancedBufferGeometry ? draw.geometry.instanceCount : 0),
      0,
    ),
    uploads: uploads.snapshot(),
  };
}

function asciiFrame(runCount: number, palettePhase: number): TextLiteral<never> {
  const values: Array<string | TextSpanFragment<never>> = [];
  const characters = '.:+*#%@';
  for (let run = 0; run < runCount; run += 1) {
    let source = '';
    for (let index = 0; index < RUN_LENGTH; index += 1) {
      source += characters[(run * 5 + index + palettePhase) % characters.length];
    }
    values.push(span({ color: PALETTE[(run + palettePhase) % PALETTE.length]! })`${source}`);
    if ((run + 1) % 4 === 0) values.push('\n');
  }
  const strings = Array.from({ length: values.length + 1 }, () => '') as string[] & { raw?: readonly string[] };
  strings.raw = strings;
  return txt(strings as unknown as TemplateStringsArray, ...values);
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return (
    scene.getObjectByName('@pmndrs/glyph:retained-upload')?.children.filter((child) => child instanceof THREE.Mesh) ??
    []
  );
}

function storageAttributes(draws: readonly THREE.Mesh[]): THREE.StorageInstancedBufferAttribute[] {
  const attributes = new Set<THREE.StorageInstancedBufferAttribute>();
  for (const draw of draws) {
    for (const attribute of Object.values(draw.geometry.attributes)) {
      if (attribute instanceof THREE.StorageInstancedBufferAttribute) attributes.add(attribute);
    }
  }
  return [...attributes];
}

function emittedShader(
  renderer: THREE.WebGPURenderer,
  draw: THREE.Mesh,
  scene: THREE.Scene,
  camera: THREE.Camera,
): ShaderSummary {
  const language = renderer.backend instanceof THREE.WebGLBackend ? 'glsl' : 'wgsl';
  // Three 0.185.1 ships narrower NodeBuilder declarations than its runtime surface.
  const Builder = (language === 'glsl' ? THREE.GLSLNodeBuilder : THREE.WGSLNodeBuilder) as unknown as new (
    object: THREE.Object3D,
    renderer: THREE.WebGPURenderer,
  ) => {
    scene: THREE.Scene;
    camera: THREE.Camera;
    material: THREE.Material;
    geometry: THREE.BufferGeometry;
    vertexShader: string;
    fragmentShader: string;
    build(): void;
  };
  const builder = new Builder(draw, renderer);
  builder.scene = scene;
  builder.camera = camera;
  builder.material = draw.material as THREE.NodeMaterial;
  builder.geometry = draw.geometry;
  builder.build();
  const vertex = builder.vertexShader;
  const fragment = builder.fragmentShader;
  return {
    language,
    vertexBytes: new TextEncoder().encode(vertex).byteLength,
    fragmentBytes: new TextEncoder().encode(fragment).byteLength,
    vertexHash: hashString(vertex),
    fragmentHash: hashString(fragment),
    storageResourceDeclarations:
      language === 'wgsl'
        ? [...vertex.matchAll(/var<storage/gu), ...fragment.matchAll(/var<storage/gu)].length
        : [...vertex.matchAll(/uniform highp [iu]?sampler2D/gu), ...fragment.matchAll(/uniform highp [iu]?sampler2D/gu)]
            .length,
  };
}

function assertChangedUpload(label: string, result: PhaseResult): void {
  const uploadCalls =
    result.uploads.attributeUpdateCalls +
    result.uploads.attributeCreateCalls +
    result.uploads.pboTextureUpdateCalls +
    result.uploads.pboTextureCreateCalls;
  if (uploadCalls === 0) {
    throw new Error(`${label} did not upload retained storage`);
  }
  if (result.litPixels === 0) throw new Error(`${label} rendered no visible pixels`);
}

function litPixelCount(pixels: ArrayLike<number>): number {
  let count = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset]! > 8 || pixels[offset + 1]! > 8 || pixels[offset + 2]! > 8) count += 1;
  }
  return count;
}

function hashString(value: string): string {
  return hashBytes(new TextEncoder().encode(value));
}

function hashBytes(bytes: ArrayLike<number>): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}
