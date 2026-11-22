import { bitmap, glyph, msdf, slug } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig, type Text, type TextGroup, type ThreeRoot } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

import type { FrustumCullingReport, ParityCase, TimingSample, TimingWorkload } from './frustum-culling-contract';
import msdfManifest from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json' with { type: 'json' };
import slugManifest from '../fixtures/rendering/showcase-slug-fixtures-v0.json' with { type: 'json' };
import { fetchAuthenticatedGzipAsset } from './workloads/font-assets/authenticated-gzip';

declare global {
  interface Window {
    frustumCullingReady: Promise<FrustumCullingReport>;
  }
}

const WIDTH = 256;
const HEIGHT = 128;
const bitmapFontUrl = '/fixtures/rendering/inter-bitmap-16.font.glb';
const msdfFontUrl = '/fixtures/rendering/inter-mtsdf.font.glb.gz';
const slugFontUrl = '/fixtures/rendering/inter-slug.font.glb.gz';

type AnyText = Text<typeof bitmap> | Text<typeof msdf> | Text<typeof slug>;
type BitmapFace = ReturnType<typeof bitmapFace>;
type MsdfFace = ReturnType<typeof msdfFace>;
type SlugFace = ReturnType<typeof slugFace>;

const bitmapFace = () => glyph.fontFace(bitmapFontUrl, { format: bitmap({ strikes: [16] }) });
const msdfFace = (bytes: Uint8Array<ArrayBuffer>) =>
  glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), { format: msdf });
const slugFace = (bytes: Uint8Array<ArrayBuffer>) =>
  glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), { format: slug });

/** The labels every parity case moves: one per format in a batched group, a snapped Bitmap and a standalone Slug. */
interface LabelScene {
  readonly root: ThreeRoot;
  readonly bitmapFont: BitmapFace;
  readonly parent: THREE.Group;
  readonly group: TextGroup;
  readonly bitmap: Text<typeof bitmap>;
  readonly msdf: Text<typeof msdf>;
  readonly slug: Text<typeof slug>;
  readonly snapped: Text<typeof bitmap>;
  readonly standalone: Text<typeof slug>;
  readonly edgeLabels: readonly AnyText[];
}

/** Renders one scene state with culling on and off and keeps what each case reported. */
class CullingProof {
  readonly cases: ParityCase[] = [];
  camera: THREE.Camera;
  #culling = true;
  #culledDraws = 0;
  readonly #restore: () => void;

  constructor(
    readonly renderer: THREE.WebGPURenderer,
    readonly scene: THREE.Scene,
    readonly target: THREE.RenderTarget,
    camera: THREE.Camera,
  ) {
    this.camera = camera;
    // Off answers every frustum test "inside": exactly what the draws rendered before culling existed.
    const intersectsObject = THREE.Frustum.prototype.intersectsObject;
    const proof = this;
    THREE.Frustum.prototype.intersectsObject = function (object) {
      if (!proof.#culling) return true;
      const inside = intersectsObject.call(this, object);
      if (!inside) proof.#culledDraws += 1;
      return inside;
    };
    this.#restore = () => {
      THREE.Frustum.prototype.intersectsObject = intersectsObject;
    };
  }

  set culling(enabled: boolean) {
    this.#culling = enabled;
  }

  dispose(): void {
    this.#restore();
  }

  async frame(enabled: boolean, renderTarget = this.target) {
    this.#culling = enabled;
    this.#culledDraws = 0;
    this.renderer.setRenderTarget(renderTarget);
    // Info resets itself only inside Three's animation loop.
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    const calls = this.renderer.info.render.drawCalls;
    const culled = this.#culledDraws;
    const bytes = new Uint8Array(await this.renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, WIDTH, HEIGHT));
    return { calls, culled, bytes };
  }

  async parity(name: string, expect: 'visible' | 'empty' | 'any' = 'visible', reduction = false): Promise<void> {
    const unculled = await this.frame(false);
    const culled = await this.frame(true);
    const changed = countChanged(unculled.bytes, culled.bytes);
    const litChannels = countLit(culled.bytes);
    if (changed !== 0) throw new Error(`${name}: culling changed ${String(changed)} channels`);
    if (expect === 'visible' && litChannels === 0) throw new Error(`${name}: the on-screen control drew nothing`);
    if (expect === 'empty' && litChannels !== 0) throw new Error(`${name}: the off-screen control drew pixels`);
    if (reduction && culled.calls >= unculled.calls) {
      throw new Error(`${name}: culling removed no draw call (${String(culled.calls)} of ${String(unculled.calls)})`);
    }
    this.cases.push({
      name,
      litChannels,
      unculledCalls: unculled.calls,
      culledCalls: culled.calls,
      culledDraws: culled.culled,
    });
  }
}

window.frustumCullingReady = prove();

async function prove(): Promise<FrustumCullingReport> {
  await glyph.init();
  const query = new URLSearchParams(location.search);
  const transformMode = query.get('transforms') === 'direct' ? 'direct' : 'indexed';
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    forceWebGL: query.get('backend') === 'webgl2',
    trackTimestamp: true,
  });
  const target = createRenderTarget();
  const passTarget = createRenderTarget();
  const handle = glyph.handle('frustum-culling-proof', defineThreeConfig({ transformMode }));
  const fonts: { dispose(): void }[] = [];
  const scene = new THREE.Scene();
  const orthographic = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 0.1, 10);
  orthographic.position.z = 1;
  const proof = new CullingProof(renderer, scene, target, orthographic);
  try {
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    await renderer.init();
    const bitmapFont = bitmapFace();
    const msdfFont = msdfFace(await fixture(msdfFontUrl, msdfManifest.artifacts, 'MTSDF'));
    const slugFont = slugFace(await fixture(slugFontUrl, slugManifest.artifacts, 'Slug'));
    fonts.push(bitmapFont, msdfFont, slugFont);
    await Promise.all([bitmapFont.load(), msdfFont.load(), slugFont.load()]);
    const labels = createLabels(handle('proof'), scene, bitmapFont, msdfFont, slugFont);

    await edgeCases(proof, labels);
    await shearCases(proof, labels);
    await grazingCases(proof, labels);
    proof.camera = orthographic;
    await memberCases(proof, labels);
    await detachedCases(proof, labels);
    await secondPassCase(proof, labels, passTarget);
    const unculledCustomMaterial = await customMaterialCase(proof, labels);
    const negativeControlDetected = await negativeControl(proof, labels);
    for (const label of [...labels.edgeLabels, labels.standalone]) label.dispose();
    const timings = await measure(
      proof,
      labels,
      Number(query.get('labels') ?? 2_000),
      Number(query.get('samples') ?? 40),
    );
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      transformMode,
      threeRevision: THREE.REVISION,
      cases: proof.cases,
      negativeControlDetected,
      unculledCustomMaterial,
      timings,
    };
  } finally {
    proof.dispose();
    handle.dispose();
    for (const font of fonts) font.dispose();
    target.dispose();
    passTarget.dispose();
    renderer.dispose();
  }
}

function createLabels(
  root: ThreeRoot,
  scene: THREE.Scene,
  bitmapFont: BitmapFace,
  msdfFont: MsdfFace,
  slugFont: SlugFace,
): LabelScene {
  const parent = new THREE.Group();
  const group = root.createTextGroup({ batching: 'group' });
  parent.add(group);
  scene.add(parent);
  const decorated = { color: '#ffffff', decoration: { underline: true } } as const;
  const bitmapLabel = root.createText({
    font: bitmapFont,
    text: 'Bitmap glyphs',
    style: { ...decorated, fontSize: 16 },
  });
  const msdfLabel = root.createText({
    font: msdfFont,
    text: 'MSDF effects',
    style: {
      ...decorated,
      fontSize: 22,
      outline: { color: '#ff3030', width: 3 },
      shadow: { color: '#3080ff', offset: [5, -4] },
    },
  });
  const slugLabel = root.createText({ font: slugFont, text: 'Slug fringe', style: { ...decorated, fontSize: 22 } });
  group.add(bitmapLabel, msdfLabel, slugLabel);
  const standalone = root.createText({ font: slugFont, text: 'Standalone', style: { color: '#80ff80', fontSize: 18 } });
  // Snapping rounds projected corners to pixel edges; fractional placements make it move them.
  const snapped = root.createText({
    font: bitmapFont,
    text: 'Snapped bitmap',
    pixelSnapping: true,
    style: { color: '#ffd040', fontSize: 16 },
  });
  scene.add(standalone, snapped);
  return {
    root,
    bitmapFont,
    parent,
    group,
    bitmap: bitmapLabel,
    msdf: msdfLabel,
    slug: slugLabel,
    snapped,
    standalone,
    edgeLabels: [bitmapLabel, msdfLabel, slugLabel, snapped],
  };
}

function place(labels: LabelScene, x: number, y: number): void {
  labels.bitmap.position.set(x, y + 34, 0);
  labels.msdf.position.set(x, y, 0);
  labels.slug.position.set(x, y - 34, 0);
  labels.snapped.position.set(x + 0.37, y + 52.61, 0);
}

function inkWorld(scene: THREE.Scene, label: AnyText): THREE.Box3 {
  scene.updateMatrixWorld(true);
  return label.computeBoundingBox().clone().applyMatrix4(label.matrixWorld);
}

/** Each edge straddled, then ink a fraction of a pixel to a few pixels past it, upright and turned. */
async function edgeCases(proof: CullingProof, labels: LabelScene): Promise<void> {
  labels.standalone.position.set(-120, -40, 0);
  place(labels, -80, 20);
  await proof.parity('visible');
  for (const [x, y] of [
    [WIDTH / 2 - 30, 20],
    [-WIDTH / 2 - 60, 20],
    [-40, HEIGHT / 2 + 16],
    [-40, -HEIGHT / 2 + 30],
  ] as const) {
    place(labels, x, y);
    await proof.parity(`straddles ${String(x)},${String(y)}`);
  }
  // Quad padding, cells, fringes and shadows decide these. Turned glyphs reach furthest: Slug's coverage fringe spans
  // up to half a pixel times sqrt(2) past a diagonal edge.
  const gaps = [
    ...[0.05, 0.3, 0.5, 0.8, 1.2, 2, 4, 8].map((gap) => [0, gap] as const),
    ...[0.02, 0.08, 0.15, 0.25, 0.4].flatMap((gap) => [[0.35, gap] as const, [Math.PI / 4, gap] as const]),
  ];
  const sides = [
    ['right of', (label: AnyText, gap: number) => WIDTH / 2 + gap - inkWorld(proof.scene, label).min.x, 'x'],
    ['left of', (label: AnyText, gap: number) => -WIDTH / 2 - gap - inkWorld(proof.scene, label).max.x, 'x'],
    ['above', (label: AnyText, gap: number) => HEIGHT / 2 + gap - inkWorld(proof.scene, label).min.y, 'y'],
  ] as const;
  for (const [angle, gap] of gaps) {
    for (const [side, offset, axis] of sides) {
      place(labels, -60, 0);
      for (const label of labels.edgeLabels) {
        label.rotation.z = angle;
        label.position[axis] = 0;
        label.position[axis] = offset(label, gap);
      }
      await proof.parity(`ink ${String(gap)}px ${side} the view, turned ${angle.toFixed(2)}`, 'any');
    }
  }
  for (const label of labels.edgeLabels) label.rotation.z = 0;
  place(labels, 600, 0);
  labels.standalone.position.x = 600;
  await proof.parity('everything off-screen', 'empty', true);
}

/** A rotation inside a non-uniform scale, which `Sphere.applyMatrix4` underestimates. */
async function shearCases(proof: CullingProof, labels: LabelScene): Promise<void> {
  labels.parent.rotation.z = 0.35;
  labels.parent.scale.set(1.6, 0.6, 1);
  labels.group.rotation.z = -0.5;
  labels.group.scale.set(0.8, 1.3, 1);
  for (const x of [-150, -90, 60, 120]) {
    place(labels, x, 0);
    await proof.parity(`sheared at ${String(x)}`, 'any');
  }
  labels.parent.rotation.z = 0;
  labels.parent.scale.set(1, 1, 1);
  labels.group.rotation.z = 0;
  labels.group.scale.set(1, 1, 1);
}

/** Perspective, with the text plane turned nearly edge-on beside a side plane and the top plane. */
async function grazingCases(proof: CullingProof, labels: LabelScene): Promise<void> {
  const perspective = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 1, 2_000);
  perspective.position.z = 300;
  proof.camera = perspective;
  const halfWidth = Math.tan(THREE.MathUtils.degToRad(25)) * (WIDTH / HEIGHT) * 300;
  for (const angle of [70, 85, 88, 89.5]) {
    labels.group.rotation.y = THREE.MathUtils.degToRad(angle);
    for (const x of [halfWidth - 20, halfWidth - 4, halfWidth, halfWidth + 4, -halfWidth + 2]) {
      place(labels, x, 0);
      await proof.parity(`grazing ${String(angle)}deg at ${x.toFixed(1)}`, 'any');
    }
  }
  labels.group.rotation.y = 0;
  labels.group.rotation.x = THREE.MathUtils.degToRad(88);
  for (const y of [60, 110, 140]) {
    place(labels, -40, y);
    await proof.parity(`grazing top at ${String(y)}`, 'any');
  }
  labels.group.rotation.x = 0;
}

/** Batched members that move, change, leave and join. */
async function memberCases(proof: CullingProof, labels: LabelScene): Promise<void> {
  place(labels, -80, 20);
  labels.standalone.position.x = -120;
  await proof.parity('members return');
  labels.slug.position.x = 900;
  labels.msdf.text = 'MSDF effects edited off-screen';
  labels.msdf.position.x = 900;
  await proof.parity('two members leave, one edited');
  labels.msdf.position.x = -60;
  await proof.parity('edited member returns');
  labels.bitmap.text = `${'wide '.repeat(30)}label`;
  labels.bitmap.position.x = -700;
  await proof.parity('off-screen member grows into view');
  labels.msdf.removeFromParent();
  await proof.parity('one member removed');
  labels.group.add(labels.msdf);
  await proof.parity('member added back');
  const added = labels.root.createText({ font: labels.bitmapFont, text: 'Added late', style: { fontSize: 16 } });
  added.position.set(110, -10, 0);
  labels.group.add(added);
  await proof.parity('new member at the edge');
  added.dispose();
  labels.bitmap.text = 'Bitmap glyphs';
  place(labels, -80, 20);
  await proof.parity('members restored');
}

/** A detached split whose per-glyph matrices carry glyphs across the edge with no publication. */
async function detachedCases(proof: CullingProof, labels: LabelScene): Promise<void> {
  const [glyphs, decorations] = labels.msdf.split();
  decorations?.dispose();
  labels.msdf.visible = false;
  glyphs.position.copy(labels.msdf.position);
  labels.group.add(glyphs);
  const matrix = new THREE.Matrix4();
  for (const offset of [0, 180, 400]) {
    for (let index = 0; index < glyphs.count; index += 1) {
      glyphs.getMatrixAt(index, matrix);
      const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
      matrix.setPosition(origin.x + (index % 2 === 0 ? offset : -offset) / 4, origin.y + index, 0);
      glyphs.setMatrixAt(index, matrix);
    }
    await proof.parity(`detached glyphs scattered by ${String(offset)}`, 'any');
  }
  glyphs.position.x = 900;
  await proof.parity('detached copy off-screen');
  glyphs.dispose();
  labels.msdf.visible = true;
}

/** A second camera into a second target in the same frame, as a shadow or reflection pass would. */
async function secondPassCase(proof: CullingProof, labels: LabelScene, passTarget: THREE.RenderTarget): Promise<void> {
  const overhead = new THREE.OrthographicCamera(-WIDTH, WIDTH, HEIGHT, -HEIGHT, 0.1, 10);
  overhead.position.set(200, 0, 1);
  place(labels, -100, 0);
  const passes = async (enabled: boolean) => {
    const main = await proof.frame(enabled);
    const camera = proof.camera;
    proof.camera = overhead;
    const pass = await proof.frame(enabled, passTarget);
    proof.camera = camera;
    return { main, pass };
  };
  const unculled = await passes(false);
  const culled = await passes(true);
  if (
    countChanged(unculled.main.bytes, culled.main.bytes) !== 0 ||
    countChanged(unculled.pass.bytes, culled.pass.bytes) !== 0
  ) {
    throw new Error('a second camera pass changed pixels under culling');
  }
  proof.cases.push({
    name: 'second camera pass',
    litChannels: countLit(culled.pass.bytes),
    unculledCalls: unculled.pass.calls,
    culledCalls: culled.pass.calls,
    culledDraws: culled.pass.culled,
  });
}

/** A caller material that moves its glyphs 900 units: unboundable, so it is drawn from off-screen. */
async function customMaterialCase(proof: CullingProof, labels: LabelScene): Promise<boolean> {
  labels.msdf.material = defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    material.positionNode = context.position.add(vec3(-900, 0, 0));
    return material;
  });
  labels.msdf.position.x = 840;
  await proof.parity('displacing caller material');
  const unculled = drawsOf(proof.scene).some(
    (draw) => !draw.frustumCulled && draw.userData.pmndrsGlyphPrimitiveKind === 'glyph',
  );
  if (!unculled) throw new Error('the displacing material draw was culled');
  labels.msdf.material = undefined;
  place(labels, -80, 20);
  return unculled;
}

/** A bound that excludes visible glyphs must fail the pixel oracle. */
async function negativeControl(proof: CullingProof, labels: LabelScene): Promise<boolean> {
  place(labels, -80, 20);
  const reference = await proof.frame(false);
  const wrong = new THREE.Sphere(new THREE.Vector3(10_000, 0, 0), 1);
  const draws = drawsOf(proof.scene).filter((draw) => draw.frustumCulled);
  for (const draw of draws) Object.defineProperty(draw, 'boundingSphere', { configurable: true, value: wrong });
  const broken = await proof.frame(true);
  for (const draw of draws) Reflect.deleteProperty(draw, 'boundingSphere');
  const detected = countChanged(reference.bytes, broken.bytes) !== 0;
  if (!detected) throw new Error('a wrong bound was not detected by the pixel oracle');
  return detected;
}

/** Many labels in rows of ten, a tenth of them on screen: static, moving and editing frames, culling on and off. */
async function measure(
  proof: CullingProof,
  labels: LabelScene,
  count: number,
  samples: number,
): Promise<TimingWorkload[]> {
  const { rows, timed } = timingRows(proof.scene, labels, count);
  await proof.frame(true);
  await proof.frame(false);
  const workloads: TimingWorkload[] = [];
  const updates = {
    static: () => undefined,
    moving: (sample: number) => {
      for (const row of rows) row.position.y += sample % 2 === 0 ? 0.25 : -0.25;
    },
    editing: (sample: number) => {
      timed[(sample * 37) % timed.length]!.text = `Edited ${String(sample)}`;
    },
  } as const;
  for (const [name, update] of Object.entries(updates)) {
    const recorded: TimingSample[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      for (const enabled of sample % 2 === 0 ? [false, true] : [true, false]) {
        update(sample);
        recorded.push(await timedFrame(proof, enabled));
      }
    }
    workloads.push({ name, labels: count, onScreenLabels: Math.ceil(rows.length / 10) * 10, samples: recorded });
  }
  for (const label of timed) label.dispose();
  for (const row of rows) row.removeFromParent();
  return workloads;
}

function timingRows(scene: THREE.Scene, labels: LabelScene, count: number) {
  const rows: THREE.Object3D[] = [];
  const timed: Text<typeof bitmap>[] = [];
  for (let index = 0; index < count; index += 10) {
    const row = labels.root.createTextGroup({ batching: 'group' });
    const rowIndex = index / 10;
    row.position.set(rowIndex % 10 === 0 ? -120 : 400 + (rowIndex % 7) * 300, (rowIndex % 8) * 14 - 56, 0);
    rows.push(row);
    scene.add(row);
    for (let column = 0; column < 10 && index + column < count; column += 1) {
      const label = labels.root.createText({
        font: labels.bitmapFont,
        text: `Label ${String(index + column)}`,
        style: { fontSize: 12 },
      });
      label.position.x = column * 24;
      row.add(label);
      timed.push(label);
    }
  }
  return { rows, timed };
}

async function timedFrame(proof: CullingProof, enabled: boolean): Promise<TimingSample> {
  const { renderer, scene, camera, target } = proof;
  proof.culling = enabled;
  const started = performance.now();
  scene.updateMatrixWorld();
  const published = performance.now();
  renderer.setRenderTarget(target);
  renderer.info.reset();
  renderer.render(scene, camera);
  const rendered = performance.now();
  const calls = renderer.info.render.drawCalls;
  const gpuMs = (await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)) ?? null;
  return { culling: enabled, publishMs: published - started, renderMs: rendered - published, gpuMs, calls };
}

function createRenderTarget(): THREE.RenderTarget {
  const target = new THREE.RenderTarget(WIDTH, HEIGHT, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  target.texture.colorSpace = THREE.NoColorSpace;
  return target;
}

async function fixture(
  url: string,
  artifacts: readonly {
    readonly fontFixture: string;
    readonly compressed: { readonly bytes: number; readonly sha256: string };
    readonly uncompressed: { readonly bytes: number; readonly sha256: string };
  }[],
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const manifest = artifacts.find((artifact) => artifact.fontFixture === 'inter');
  if (manifest === undefined) throw new Error(`${label} Inter fixture manifest is missing`);
  return fetchAuthenticatedGzipAsset(url, manifest, `${label} font fixture`);
}

function drawsOf(scene: THREE.Scene): THREE.Mesh[] {
  const draws: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.pmndrsGlyphPrimitiveKind !== undefined) draws.push(object);
  });
  return draws;
}

function countChanged(left: Uint8Array, right: Uint8Array): number {
  let changed = 0;
  for (let index = 0; index < left.length; index += 1) changed += Number(left[index] !== right[index]);
  return changed;
}

function countLit(bytes: Uint8Array): number {
  let lit = 0;
  for (let index = 0; index < bytes.length; index += 1) lit += Number(index % 4 !== 3 && bytes[index] !== 0);
  return lit;
}
