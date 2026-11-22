import { bitmap, glyph, msdf, slug } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig, type Text } from '@pmndrs/glyph/three';
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
const bitmapFontUrl = '/fixtures/rendering/inter-bitmap-16.font.glb';
const msdfFontUrl = '/fixtures/rendering/inter-mtsdf.font.glb.gz';
const slugFontUrl = '/fixtures/rendering/inter-slug.font.glb.gz';
const HEIGHT = 128;

window.frustumCullingReady = prove();

async function prove(): Promise<FrustumCullingReport> {
  await glyph.init();
  const query = new URLSearchParams(location.search);
  const transformMode = query.get('transforms') === 'direct' ? 'direct' : 'indexed';
  const timingLabels = Number(query.get('labels') ?? 2_000);
  const timingSamples = Number(query.get('samples') ?? 40);
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    forceWebGL: query.get('backend') === 'webgl2',
    trackTimestamp: true,
  });
  const target = new THREE.RenderTarget(WIDTH, HEIGHT, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const passTarget = new THREE.RenderTarget(WIDTH, HEIGHT, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  target.texture.colorSpace = THREE.NoColorSpace;
  passTarget.texture.colorSpace = THREE.NoColorSpace;
  const handle = glyph.handle('frustum-culling-proof', defineThreeConfig({ transformMode }));
  const fonts: { dispose(): void }[] = [];
  // Off answers every frustum test "inside": exactly what the draws rendered before culling existed.
  const intersectsObject = THREE.Frustum.prototype.intersectsObject;
  let culling = true;
  let culledDraws = 0;
  THREE.Frustum.prototype.intersectsObject = function (object) {
    if (!culling) return true;
    const inside = intersectsObject.call(this, object);
    if (!inside) culledDraws += 1;
    return inside;
  };
  try {
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);
    await renderer.init();
    const bitmapFont = glyph.fontFace(bitmapFontUrl, { format: bitmap({ strikes: [16] }) });
    const msdfFont = glyph.fontFace(
      new Blob([await fixture(msdfFontUrl, msdfManifest.artifacts, 'MTSDF')], { type: 'model/gltf-binary' }),
      { format: msdf },
    );
    const slugFont = glyph.fontFace(
      new Blob([await fixture(slugFontUrl, slugManifest.artifacts, 'Slug')], { type: 'model/gltf-binary' }),
      { format: slug },
    );
    fonts.push(bitmapFont, msdfFont, slugFont);
    await Promise.all([bitmapFont.load(), msdfFont.load(), slugFont.load()]);

    const scene = new THREE.Scene();
    const orthographic = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 0.1, 10);
    orthographic.position.z = 1;
    const perspective = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 1, 2_000);
    perspective.position.z = 300;
    let camera: THREE.Camera = orthographic;
    const root = handle('proof');
    const parent = new THREE.Group();
    const group = root.createTextGroup({ batching: 'group' });
    parent.add(group);
    scene.add(parent);
    const labelStyle = { color: '#ffffff', decoration: { underline: true } } as const;
    const bitmapLabel = root.createText({
      font: bitmapFont,
      text: 'Bitmap glyphs',
      style: { ...labelStyle, fontSize: 16 },
    });
    const msdfLabel = root.createText({
      font: msdfFont,
      text: 'MSDF effects',
      style: {
        ...labelStyle,
        fontSize: 22,
        outline: { color: '#ff3030', width: 3 },
        shadow: { color: '#3080ff', offset: [5, -4] },
      },
    });
    const slugLabel = root.createText({ font: slugFont, text: 'Slug fringe', style: { ...labelStyle, fontSize: 22 } });
    const labels = [bitmapLabel, msdfLabel, slugLabel];
    group.add(...labels);
    const standalone = root.createText({
      font: slugFont,
      text: 'Standalone',
      style: { color: '#80ff80', fontSize: 18 },
    });
    scene.add(standalone);

    async function frame(enabled: boolean, renderTarget = target) {
      culling = enabled;
      culledDraws = 0;
      renderer.setRenderTarget(renderTarget);
      // Info resets itself only inside Three's animation loop.
      renderer.info.reset();
      renderer.render(scene, camera);
      const calls = renderer.info.render.drawCalls;
      const culled = culledDraws;
      const bytes = new Uint8Array(await renderer.readRenderTargetPixelsAsync(renderTarget, 0, 0, WIDTH, HEIGHT));
      return { calls, culled, bytes };
    }

    const cases: ParityCase[] = [];
    async function parity(name: string, expect: 'visible' | 'empty' | 'any' = 'visible', reduction = false) {
      const unculled = await frame(false);
      const culled = await frame(true);
      const changed = countChanged(unculled.bytes, culled.bytes);
      const litChannels = countLit(culled.bytes);
      if (changed !== 0) throw new Error(`${name}: culling changed ${String(changed)} channels`);
      if (expect === 'visible' && litChannels === 0) throw new Error(`${name}: the on-screen control drew nothing`);
      if (expect === 'empty' && litChannels !== 0) throw new Error(`${name}: the off-screen control drew pixels`);
      if (reduction && culled.calls >= unculled.calls) {
        throw new Error(
          `${name}: culling removed no draw call (${String(unculled.calls)} -> ${String(culled.calls)}, ${String(culled.culled)} culled)`,
        );
      }
      cases.push({
        name,
        litChannels,
        unculledCalls: unculled.calls,
        culledCalls: culled.calls,
        culledDraws: culled.culled,
      });
    }

    const place = (x: number, y: number) => {
      bitmapLabel.position.set(x, y + 34, 0);
      msdfLabel.position.set(x, y, 0);
      slugLabel.position.set(x, y - 34, 0);
    };
    const inkWorld = (label: THREE.Object3D & { computeBoundingBox(): THREE.Box3 }) => {
      scene.updateMatrixWorld(true);
      return label.computeBoundingBox().clone().applyMatrix4(label.matrixWorld);
    };

    standalone.position.set(-120, -40, 0);
    place(-80, 20);
    await parity('visible');
    // Each edge, straddled.
    for (const [x, y] of [
      [WIDTH / 2 - 30, 20],
      [-WIDTH / 2 - 60, 20],
      [-40, HEIGHT / 2 + 16],
      [-40, -HEIGHT / 2 + 30],
    ] as const) {
      place(x, y);
      await parity(`straddles ${String(x)},${String(y)}`);
    }
    // Ink a fraction of a pixel to a few pixels past each edge: quad padding, cells, fringes and shadows decide.
    for (const gap of [0.05, 0.3, 0.5, 0.8, 1.2, 2, 4, 8]) {
      for (const label of labels) {
        label.position.x = 0;
        label.position.x = WIDTH / 2 + gap - inkWorld(label).min.x;
      }
      await parity(`ink ${String(gap)}px right of the view`, 'any');
      for (const label of labels) {
        label.position.x = 0;
        label.position.x = -WIDTH / 2 - gap - inkWorld(label).max.x;
      }
      await parity(`ink ${String(gap)}px left of the view`, 'any');
      place(-60, 0);
      for (const label of labels) {
        label.position.y = 0;
        label.position.y = HEIGHT / 2 + gap - inkWorld(label).min.y;
      }
      await parity(`ink ${String(gap)}px above the view`, 'any');
    }
    place(600, 0);
    standalone.position.x = 600;
    await parity('everything off-screen', 'empty', true);

    // Shear: a rotation inside a non-uniform scale, at every edge.
    parent.rotation.z = 0.35;
    parent.scale.set(1.6, 0.6, 1);
    group.rotation.z = -0.5;
    group.scale.set(0.8, 1.3, 1);
    for (const x of [-150, -90, 60, 120]) {
      place(x, 0);
      await parity(`sheared at ${String(x)}`, 'any');
    }
    parent.rotation.z = 0;
    parent.scale.set(1, 1, 1);
    group.rotation.z = 0;
    group.scale.set(1, 1, 1);

    // Perspective, with the text plane turned nearly edge-on beside each side plane.
    camera = perspective;
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(25)) * (WIDTH / HEIGHT) * 300;
    for (const angle of [70, 85, 88, 89.5]) {
      group.rotation.y = THREE.MathUtils.degToRad(angle);
      for (const x of [halfWidth - 20, halfWidth - 4, halfWidth, halfWidth + 4, -halfWidth + 2]) {
        place(x, 0);
        await parity(`grazing ${String(angle)}deg at ${x.toFixed(1)}`, 'any');
      }
    }
    group.rotation.y = 0;
    group.rotation.x = THREE.MathUtils.degToRad(88);
    for (const y of [60, 110, 140]) {
      place(-40, y);
      await parity(`grazing top at ${String(y)}`, 'any');
    }
    group.rotation.x = 0;
    camera = orthographic;

    // Members that move, change and leave.
    place(-80, 20);
    standalone.position.x = -120;
    await parity('members return');
    slugLabel.position.x = 900;
    msdfLabel.text = 'MSDF effects edited off-screen';
    msdfLabel.position.x = 900;
    await parity('two members leave, one edited');
    msdfLabel.position.x = -60;
    await parity('edited member returns');
    bitmapLabel.text = `${'wide '.repeat(30)}label`;
    bitmapLabel.position.x = -700;
    await parity('off-screen member grows into view');
    msdfLabel.removeFromParent();
    await parity('one member removed');
    group.add(msdfLabel);
    await parity('member added back');
    const added = root.createText({ font: bitmapFont, text: 'Added late', style: { fontSize: 16 } });
    added.position.set(110, -10, 0);
    group.add(added);
    await parity('new member at the edge');
    added.dispose();
    bitmapLabel.text = 'Bitmap glyphs';
    place(-80, 20);
    await parity('members restored');

    // A detached split: per-glyph matrices carry glyphs across the edge with no publication.
    const [glyphs, decorations] = msdfLabel.split();
    msdfLabel.visible = false;
    glyphs.position.copy(msdfLabel.position);
    group.add(glyphs);
    decorations?.dispose();
    const matrix = new THREE.Matrix4();
    for (const offset of [0, 180, 400]) {
      for (let index = 0; index < glyphs.count; index += 1) {
        glyphs.getMatrixAt(index, matrix);
        const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
        matrix.setPosition(origin.x + (index % 2 === 0 ? offset : -offset) / 4, origin.y + index, 0);
        glyphs.setMatrixAt(index, matrix);
      }
      await parity(`detached glyphs scattered by ${String(offset)}`, 'any');
    }
    glyphs.position.x = 900;
    await parity('detached copy off-screen', 'visible');
    glyphs.dispose();
    msdfLabel.visible = true;

    // A second camera into a second target, as a shadow or reflection pass would.
    const overhead = new THREE.OrthographicCamera(-WIDTH, WIDTH, HEIGHT, -HEIGHT, 0.1, 10);
    overhead.position.set(200, 0, 1);
    place(-100, 0);
    const passes = async (enabled: boolean) => {
      const main = await frame(enabled);
      const saved = camera;
      camera = overhead;
      const pass = await frame(enabled, passTarget);
      camera = saved;
      return { main, pass };
    };
    const unculledPasses = await passes(false);
    const culledPasses = await passes(true);
    if (
      countChanged(unculledPasses.main.bytes, culledPasses.main.bytes) !== 0 ||
      countChanged(unculledPasses.pass.bytes, culledPasses.pass.bytes) !== 0
    ) {
      throw new Error('a second camera pass changed pixels under culling');
    }
    cases.push({
      name: 'second camera pass',
      litChannels: countLit(culledPasses.pass.bytes),
      unculledCalls: unculledPasses.pass.calls,
      culledCalls: culledPasses.pass.calls,
      culledDraws: culledPasses.pass.culled,
    });

    // A caller material that moves its glyphs 900 units: unboundable, so drawn from off-screen.
    msdfLabel.material = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.positionNode = context.position.add(vec3(-900, 0, 0));
      return material;
    });
    msdfLabel.position.x = 840;
    await parity('displacing caller material');
    const unculledCustomMaterial = drawsOf(scene).some(
      (draw) => !draw.frustumCulled && draw.userData.pmndrsGlyphPrimitiveKind === 'glyph',
    );
    if (!unculledCustomMaterial) throw new Error('the displacing material draw was culled');
    msdfLabel.material = undefined;
    place(-80, 20);

    // Negative control: a bound that excludes visible glyphs must fail the pixel oracle.
    const reference = await frame(false);
    const wrong = new THREE.Sphere(new THREE.Vector3(10_000, 0, 0), 1);
    const draws = drawsOf(scene).filter((draw) => draw.frustumCulled);
    for (const draw of draws) Object.defineProperty(draw, 'boundingSphere', { configurable: true, value: wrong });
    const broken = await frame(true);
    for (const draw of draws) Reflect.deleteProperty(draw, 'boundingSphere');
    const negativeControlDetected = countChanged(reference.bytes, broken.bytes) !== 0;
    if (!negativeControlDetected) throw new Error('a wrong bound was not detected by the pixel oracle');

    for (const label of [...labels, standalone]) label.dispose();
    const timings = await measure(timingLabels, timingSamples);
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      transformMode,
      threeRevision: THREE.REVISION,
      cases,
      negativeControlDetected,
      unculledCustomMaterial,
      timings,
    };

    /** Many labels in rows of ten, a tenth of them on screen: static, moving and editing frames, culling on and off. */
    async function measure(count: number, samples: number): Promise<TimingWorkload[]> {
      camera = orthographic;
      const rows: THREE.Object3D[] = [];
      const timed: Text<typeof bitmap>[] = [];
      for (let index = 0; index < count; index += 1) {
        if (index % 10 === 0) {
          const row = root.createTextGroup({ batching: 'group' });
          const rowIndex = index / 10;
          const onScreen = rowIndex % 10 === 0;
          row.position.set(onScreen ? -120 : 400 + (rowIndex % 7) * 300, (rowIndex % 8) * 14 - 56, 0);
          rows.push(row);
          scene.add(row);
        }
        const label = root.createText({ font: bitmapFont, text: `Label ${String(index)}`, style: { fontSize: 12 } });
        label.position.x = (index % 10) * 24;
        rows.at(-1)!.add(label);
        timed.push(label);
      }
      const onScreenLabels = Math.ceil(rows.length / 10) * 10;
      await frame(true);
      await frame(false);
      const workloads: TimingWorkload[] = [];
      for (const name of ['static', 'moving', 'editing'] as const) {
        const recorded: TimingSample[] = [];
        for (let sample = 0; sample < samples; sample += 1) {
          for (const enabled of sample % 2 === 0 ? [false, true] : [true, false]) {
            if (name === 'moving') for (const row of rows) row.position.y += sample % 2 === 0 ? 0.25 : -0.25;
            if (name === 'editing') timed[(sample * 37) % timed.length]!.text = `Edited ${String(sample)}`;
            culling = enabled;
            const started = performance.now();
            scene.updateMatrixWorld();
            const published = performance.now();
            renderer.setRenderTarget(target);
            renderer.info.reset();
            renderer.render(scene, camera);
            const rendered = performance.now();
            const calls = renderer.info.render.drawCalls;
            const gpuMs = (await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)) ?? null;
            recorded.push({
              culling: enabled,
              publishMs: published - started,
              renderMs: rendered - published,
              gpuMs,
              calls,
            });
          }
        }
        workloads.push({ name, labels: count, onScreenLabels, samples: recorded });
      }
      for (const label of timed) label.dispose();
      for (const row of rows) row.removeFromParent();
      return workloads;
    }
  } finally {
    THREE.Frustum.prototype.intersectsObject = intersectsObject;
    handle.dispose();
    for (const font of fonts) font.dispose();
    target.dispose();
    passTarget.dispose();
    renderer.dispose();
  }
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
