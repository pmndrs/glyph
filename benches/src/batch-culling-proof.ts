import { bitmap, glyph } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

import { applyExperimentBounds } from './benchmark/labs/batch-culling-bounds';

declare global {
  interface Window {
    batchCullingReady: ReturnType<typeof experiment>;
  }
}

window.batchCullingReady = experiment();

export type BatchCullingReport = Awaited<ReturnType<typeof experiment>>;

async function experiment() {
  await glyph.init();
  const query = new URLSearchParams(location.search);
  const transformMode = query.get('transforms') === 'direct' ? 'direct' : 'indexed';
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    forceWebGL: query.get('backend') === 'webgl2',
    trackTimestamp: true,
  });
  const target = new THREE.RenderTarget(256, 128, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  const font = glyph.fontFace('/fixtures/rendering/inter-bitmap-16.font.glb', {
    format: bitmap({ strikes: [16] }),
  });
  const handle = glyph.handle('culling-experiment', defineThreeConfig({ transformMode }));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-128, 128, 64, -64, 0.1, 10);
  camera.position.z = 1;
  const batches: ReturnType<typeof createBatch>[] = [];
  let culling = false;
  let boundsMs = 0;
  let updateMs = 0;
  let cullingMathMs = 0;
  let cullingTests = 0;
  const intersectsObject = THREE.Frustum.prototype.intersectsObject;
  // Observe the renderer's own tests, without introducing another culling pass or visibility authority.
  THREE.Frustum.prototype.intersectsObject = function (object) {
    const started = performance.now();
    const result = intersectsObject.call(this, object);
    cullingMathMs += performance.now() - started;
    cullingTests += 1;
    return result;
  };
  const updateMatrixWorld = scene.updateMatrixWorld.bind(scene);
  scene.updateMatrixWorld = (force) => {
    const started = performance.now();
    updateMatrixWorld(force);
    updateMs = performance.now() - started;
  };
  // Three calls this after its normal matrix update and before its normal frustum traversal.
  const prepareBounds = () => {
    const started = performance.now();
    setCulling(culling);
    boundsMs = performance.now() - started;
  };
  scene.onBeforeRender = prepareBounds;

  function createBatch(index: number) {
    // A named root is an existing publication/batch boundary. Its meshes may split by span/resource.
    const name = `culling-${String(index)}`;
    const root = handle(name);
    const parent = new THREE.Group();
    const group = root.createTextGroup({ batching: 'group' });
    const text = root.createText({
      font,
      text: 'Batch glyphs',
      style: { fontSize: 16, color: '#ffffff', decoration: { underline: true } },
    });
    text.position.set(-48, 10, 0);
    group.add(text);
    parent.add(group);
    scene.add(parent);
    scene.updateMatrixWorld(true);
    const publication = scene.getObjectByName(`@pmndrs/glyph:${name}`);
    if (publication === undefined) throw new Error('missing committed Three publication');
    return { root, parent, group, text, publication, world: new THREE.Box3(), displacement: new THREE.Vector3() };
  }

  function draws(batch: (typeof batches)[number]): THREE.Mesh[] {
    // Read the known publication's direct children after edits; no second scene traversal or visibility filter.
    return batch.publication.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  }

  function bounds(batch: (typeof batches)[number]): void {
    // Fixture-owned envelope, intentionally larger than the Bitmap quad and underline. This is NOT
    // a general Text.boundingBox -> render bounds implementation. Edits below stay inside this envelope.
    batch.world.min.set(-64, -48, -1);
    batch.world.max.set(100, 32, 1);
    batch.world.applyMatrix4(batch.group.matrixWorld).translate(batch.displacement);
    applyExperimentBounds(draws(batch), { kind: 'supplied', world: batch.world });
  }

  function setCulling(enabled: boolean): void {
    for (const batch of batches) {
      if (enabled) bounds(batch);
      else applyExperimentBounds(draws(batch), { kind: 'unknown-displacement' });
    }
  }

  async function pixels(enabled: boolean) {
    culling = enabled;
    renderer.info.reset();
    renderer.render(scene, camera);
    const calls = renderer.info.render.drawCalls;
    const bytes = new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128));
    return { calls, bytes };
  }

  async function parity(name: string, expectVisible: boolean, expectReduction = false) {
    const disabled = await pixels(false);
    const enabled = await pixels(true);
    const changed = enabled.bytes.reduce((count, byte, index) => count + Number(byte !== disabled.bytes[index]), 0);
    const lit = enabled.bytes.reduce((count, byte, index) => count + Number(index % 4 !== 3 && byte !== 0), 0);
    if (changed !== 0 || (expectVisible ? lit === 0 : lit !== 0)) {
      throw new Error(`${name}: pixel parity/visible control failed: ${JSON.stringify({ changed, lit })}`);
    }
    if (expectReduction && enabled.calls >= disabled.calls) throw new Error(`${name}: no draw-call reduction`);
    return {
      name,
      changedChannels: changed,
      litChannels: lit,
      disabledCalls: disabled.calls,
      enabledCalls: enabled.calls,
    };
  }

  try {
    renderer.setSize(256, 128, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    target.texture.colorSpace = THREE.NoColorSpace;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    await renderer.init();
    await font.load();
    const batch = createBatch(0);
    batches.push(batch);
    const checks = [await parity('visible', true)];
    if (draws(batch).length < 2) throw new Error('glyph and decoration must exercise a multi-mesh boundary');
    batch.parent.position.x = 900;
    checks.push(await parity('fully-off-screen', false, true));
    batch.parent.position.x = 140;
    checks.push(await parity('partially-visible', true));
    camera.position.x = 900;
    checks.push(await parity('camera-moves-away', false, true));
    camera.position.x = 0;
    batch.parent.position.set(-24, 8, 0);
    batch.parent.rotation.z = 0.17;
    batch.parent.scale.set(0.9, 1.1, 1);
    batch.group.rotation.z = -0.3;
    batch.group.scale.set(1.2, 0.8, 1);
    checks.push(await parity('moving-nested-return', true));
    batch.text.text = 'Edited';
    batch.text.constraints = { width: { mode: 'exact', size: 45 } };
    checks.push(await parity('edited-reflowed-nested', true));
    batch.parent.position.x = 900;
    batch.text.text = 'Hidden edit';
    checks.push(await parity('edited-while-off-screen', false, true));
    batch.parent.position.x = -24;
    checks.push(await parity('edited-batch-returns', true));

    // Arbitrary overrides opt out. A pass-through factory exercises material replacement without
    // pretending its identity proves the absence of displacement. Supplied bounds re-enable explicitly.
    batch.text.material = defineTextMaterial((context) => context.createDefaultMaterial());
    scene.updateMatrixWorld(true);
    const reference = await pixels(false);
    applyExperimentBounds(draws(batch), { kind: 'unknown-displacement' });
    if (draws(batch).some((draw) => draw.frustumCulled)) throw new Error('unknown material did not opt out');
    renderer.render(scene, camera);
    const optedOut = new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128));
    if (optedOut.some((byte, index) => byte !== reference.bytes[index])) throw new Error('opt-out pixel mismatch');
    checks.push(await parity('override-with-supplied-bounds', true));

    // Negative control: stale, incorrect bounds must make the pixel oracle fail.
    const wrong = new THREE.Box3(new THREE.Vector3(900, 0, 0), new THREE.Vector3(1000, 30, 1));
    applyExperimentBounds(draws(batch), { kind: 'supplied', world: wrong });
    scene.onBeforeRender = () => {};
    renderer.render(scene, camera);
    const wrongPixels = new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128));
    scene.onBeforeRender = prepareBounds;
    if (!wrongPixels.some((byte, index) => byte !== reference.bytes[index])) {
      throw new Error('incorrect-bounds negative control was not detected');
    }

    batch.text.material = undefined;
    batch.text.constraints = undefined;
    batch.parent.rotation.z = 0;
    batch.parent.scale.set(1, 1, 1);
    batch.group.rotation.z = 0;
    batch.group.scale.set(1, 1, 1);
    batch.parent.position.set(900, 0, 0);
    batch.text.material = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      material.positionNode = context.position.add(vec3(-900, 0, 0));
      return material;
    });
    const displacedReference = await pixels(false);
    if (!displacedReference.bytes.some((byte, index) => index % 4 !== 3 && byte !== 0)) {
      throw new Error('displacement control did not bring the off-screen glyphs into view');
    }
    if (draws(batch).some((draw) => draw.frustumCulled)) throw new Error('displaced material must opt out');
    batch.displacement.set(-900, 0, 0);
    checks.push(await parity('displaced-material-with-supplied-bounds', true));
    batch.text.material = undefined;
    batch.displacement.set(0, 0, 0);
    for (let index = 1; index < 24; index += 1) batches.push(createBatch(index));
    const timings = [];
    for (const workload of ['mostly-visible', 'mostly-off-screen'] as const) {
      for (const updates of ['static', 'moving-editing'] as const) {
        for (const [index, current] of batches.entries()) {
          const visible = workload === 'mostly-visible' ? index < 22 : index < 2;
          current.parent.position.set(visible ? -10 : 900, (index % 5) * 9 - 20, 0);
        }
        checks.push(await parity(`${workload}-${updates}`, true, workload === 'mostly-off-screen'));
        // Compile both paths before measuring. Readback above is also a causal GPU completion barrier.
        await renderer.resolveTimestampsAsync();
        const samples = [];
        for (let sample = 0; sample < 12; sample += 1) {
          // Alternate order. Each moving/editing observation starts from the same accepted state,
          // otherwise the first mode alone pays the semantic publication cost.
          for (const enabled of sample % 2 === 0 ? [false, true] : [true, false]) {
            if (updates === 'moving-editing') {
              for (const [index, current] of batches.entries()) {
                const visible = workload === 'mostly-visible' ? index < 22 : index < 2;
                current.parent.position.x = visible ? -10 : 900;
                current.text.set({ text: 'Batch glyphs', constraints: undefined });
              }
              culling = false;
              renderer.render(scene, camera);
              await renderer.resolveTimestampsAsync();
              for (const current of batches) {
                current.parent.position.x += sample % 2 === 0 ? 1 : -1;
                current.text.set({
                  text: sample % 2 === 0 ? 'Edited glyphs' : 'Shifted glyphs',
                  constraints: { width: { mode: 'exact', size: sample % 2 === 0 ? 80 : 90 } },
                });
              }
            }
            culling = enabled;
            renderer.info.reset();
            cullingMathMs = 0;
            cullingTests = 0;
            const renderStart = performance.now();
            renderer.render(scene, camera);
            const renderSubmitMs = performance.now() - renderStart;
            const calls = renderer.info.render.drawCalls;
            if (enabled ? cullingTests === 0 : cullingTests !== 0) {
              throw new Error('native frustum-test instrumentation did not observe the selected culling mode');
            }
            const gpuMs = await renderer.resolveTimestampsAsync();
            samples.push({
              enabled,
              updateMs,
              boundsMs,
              cullingMathMs,
              cullingTests,
              renderSubmitMs,
              calls,
              gpuMs: gpuMs ?? null,
            });
          }
        }
        timings.push({ workload, updates, samples });
        checks.push(await parity(`${workload}-${updates}-after-updates`, true, workload === 'mostly-off-screen'));
      }
    }
    return {
      backend: renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu',
      transformMode,
      threeRevision: THREE.REVISION,
      rendererIdentity: rendererIdentity(renderer),
      boundaryCount: batches.length,
      meshesPerBoundary: batches.map((current) => draws(current).length),
      checks,
      unknownDisplacementOptOut: true,
      incorrectBoundsControlDetected: true,
      timings,
    };
  } finally {
    THREE.Frustum.prototype.intersectsObject = intersectsObject;
    for (const batch of batches) {
      batch.text.dispose();
      batch.group.dispose();
      batch.parent.removeFromParent();
    }
    handle.dispose();
    font.dispose();
    target.dispose();
    renderer.dispose();
  }
}

function rendererIdentity(renderer: THREE.WebGPURenderer): string | null {
  const backend = renderer.backend;
  // Three 0.185.1 owns these properties; its 0.185.4 declarations omit them.
  if (backend instanceof THREE.WebGLBackend) {
    if (!('gl' in backend) || !(backend.gl instanceof WebGL2RenderingContext)) return null;
    const info = backend.gl.getExtension('WEBGL_debug_renderer_info');
    if (info === null) return null;
    const name: unknown = backend.gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return typeof name === 'string' ? name : null;
  }
  if (!('device' in backend) || !(backend.device instanceof GPUDevice) || !('adapterInfo' in backend.device))
    return null;
  const info = backend.device.adapterInfo;
  if (info === null || typeof info !== 'object') return null;
  if (
    !('vendor' in info) ||
    typeof info.vendor !== 'string' ||
    !('architecture' in info) ||
    typeof info.architecture !== 'string' ||
    !('description' in info) ||
    typeof info.description !== 'string'
  )
    return null;
  return `${info.vendor} ${info.architecture} ${info.description}`;
}
