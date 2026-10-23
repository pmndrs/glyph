import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

const SIDE = 32;
const CELL = 48;
const SIZE = SIDE * CELL;
const COUNTS = [512, 1024];
const WARMUPS = 20;
const BLOCKS = 8;
const SAMPLES_PER_BLOCK = 16;
let nextRootId = 0;

window.denseBrowserReady = run();

async function run() {
  const requestedBackend = new URLSearchParams(location.search).get('backend');
  if (requestedBackend !== 'webgpu' && requestedBackend !== 'webgl2') throw new Error('Invalid requested backend');
  const canvas = document.querySelector('#canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing dense timing canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: requestedBackend === 'webgl2' });
  const target = new THREE.RenderTarget(SIZE, SIZE, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
  let handle;
  const roots = [];
  let font;
  let longTaskObserver;
  let primaryFailure;
  let hasPrimaryFailure = false;
  let result;
  const longTasks = [];
  try {
    await glyph.init();
    handle = glyph.handle('dense-browser-timing', defineThreeConfig({ capacity: { size: 2048, policy: 'grow' } }));
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    target.texture.colorSpace = THREE.NoColorSpace;
    await renderer.init();
    const actualBackend = renderer.backend instanceof THREE.WebGLBackend ? 'webgl2' : 'webgpu';
    if (actualBackend !== requestedBackend) throw new Error(`Backend mismatch: ${actualBackend}`);
    const backendInfo =
      actualBackend === 'webgl2' ? webglInfo(renderer.backend.gl) : webgpuInfo(renderer.backend.device);
    font = glyph.fontFace('/Inter.font.glb', { format: bitmap({ strikes: [16] }) });
    await font.load();
    const camera = new THREE.OrthographicCamera(0, SIZE, 0, -SIZE, 0.1, 10);
    camera.position.z = 1;
    const scenes = new Map();
    for (const count of COUNTS) {
      const state = createScene(count, handle, font);
      roots.push(state);
      scenes.set(count, state);
    }
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    const phase = new Map(COUNTS.map((count) => [count, 0]));
    const lastRaf = { value: undefined };
    let previousCount;
    const take = (count, measured, block) =>
      new Promise((resolve, reject) => {
        requestAnimationFrame((rafTimestamp) => {
          try {
            const scene = scenes.get(count);
            const nextPhase = 1 - phase.get(count);
            const start = performance.now();
            for (let index = 0; index < count; index += 1) {
              scene.texts[index].set({ text: label(index, nextPhase) });
            }
            const afterSetters = performance.now();
            scene.publication.begin();
            renderer.render(scene.scene, camera);
            const afterRender = performance.now();
            const publication = scene.publication.end();
            if (publication.calls !== 1) throw new Error(`Expected one scene traversal, saw ${publication.calls}`);
            const rendererTotalMs = afterRender - afterSetters;
            phase.set(count, nextPhase);
            const rafIntervalMs = lastRaf.value === undefined ? null : rafTimestamp - lastRaf.value;
            const rafIntervalPreviousCount = previousCount ?? null;
            const rafIntervalTransition = previousCount !== undefined && previousCount !== count;
            lastRaf.value = rafTimestamp;
            previousCount = count;
            resolve(
              measured
                ? {
                    count,
                    block,
                    phase: nextPhase === 0 ? 'alpha' : 'bravo',
                    setterMs: afterSetters - start,
                    publicationMs: publication.duration,
                    renderSubmitMs: rendererTotalMs - publication.duration,
                    rendererTotalMs,
                    completeCpuMs: afterRender - start,
                    rafTimestamp,
                    rafIntervalMs,
                    rafIntervalPreviousCount,
                    rafIntervalTransition,
                  }
                : undefined,
            );
          } catch (error) {
            reject(error);
          }
        });
      });
    for (let index = 0; index < WARMUPS; index += 1) {
      await take(512, false, -1);
      await take(1024, false, -1);
    }
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: false });
    }
    const samples = { 512: [], 1024: [] };
    const blockOrder = [];
    for (let block = 0; block < BLOCKS; block += 1) {
      const order = block % 2 === 0 ? COUNTS : [...COUNTS].reverse();
      blockOrder.push(order);
      for (const count of order) {
        for (let index = 0; index < SAMPLES_PER_BLOCK; index += 1) {
          samples[count].push(await take(count, true, block));
        }
      }
    }
    // Let the final measured callback end and drain its long-task entry before closing observation.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    for (const entry of longTaskObserver?.takeRecords() ?? []) {
      longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
    longTaskObserver?.disconnect();
    renderer.setRenderTarget(target);
    const oracles = {};
    for (const count of COUNTS) {
      const warm = scenes.get(count);
      for (let index = 0; index < count; index += 1) warm.texts[index].set({ text: label(index, 0) });
      renderer.render(warm.scene, camera);
      const warmPixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE);
      const warmOutput = await outputProof(warm, warmPixels);
      const cold = createScene(count, handle, font);
      roots.push(cold);
      renderer.render(cold.scene, camera);
      const coldPixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE);
      const coldOutput = await outputProof(cold, coldPixels);
      if (
        warmOutput.pixelSha256 !== coldOutput.pixelSha256 ||
        warmOutput.nonblankPixels !== coldOutput.nonblankPixels ||
        warmOutput.draws !== coldOutput.draws ||
        warmOutput.instances !== coldOutput.instances ||
        JSON.stringify(warmOutput.firstMeasurement) !== JSON.stringify(coldOutput.firstMeasurement) ||
        JSON.stringify(warmOutput.lastMeasurement) !== JSON.stringify(coldOutput.lastMeasurement)
      ) {
        throw new Error(`Cold output differs from warm output at ${count} labels`);
      }
      if (coldOutput.nonblankPixels === 0 || coldOutput.draws === 0 || coldOutput.instances < count * 9) {
        throw new Error(`Cold output is incomplete at ${count} labels`);
      }
      oracles[count] = { warm: warmOutput, cold: coldOutput };
    }
    renderer.setRenderTarget(null);
    renderer.render(scenes.get(1024).scene, camera);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await window.captureDenseCanvas();
    result = {
      requestedBackend,
      actualBackend,
      backendInfo,
      fixture: {
        grid: [SIDE, SIDE],
        viewport: [SIZE, SIZE],
        dpr: devicePixelRatio,
        font: 'Inter Bitmap 16',
        text: 'alpha/bravo, one space, then zero-padded four-digit index',
        camera: [0, SIZE, 0, -SIZE, 0.1, 10],
        rootCapacity: { size: 2048, policy: 'grow' },
      },
      warmupsPerCount: WARMUPS,
      blocksPerCount: BLOCKS,
      samplesPerBlock: SAMPLES_PER_BLOCK,
      blockOrder,
      samples,
      longTasks,
      oracles,
    };
  } catch (error) {
    hasPrimaryFailure = true;
    primaryFailure = error;
  }
  const cleanupErrors = [];
  try {
    longTaskObserver?.disconnect();
  } catch (error) {
    cleanupErrors.push(error);
  }
  for (const scene of roots.reverse()) {
    try {
      disposeScene(scene);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const [name, dispose] of [
    ['font', () => font?.dispose()],
    ['handle', () => handle?.dispose()],
    ['target', () => target.dispose()],
    ['renderer', () => renderer.dispose()],
  ]) {
    try {
      dispose();
    } catch (error) {
      cleanupErrors.push(new Error(`${name} cleanup: ${String(error)}`));
    }
  }
  if (hasPrimaryFailure) {
    if (cleanupErrors.length > 0) console.error('Dense browser cleanup errors', cleanupErrors);
    throw primaryFailure;
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Dense browser cleanup failed');
  return result;
}

function createScene(count, handle, font) {
  const root = handle(`dense-${count}-${nextRootId++}`);
  const texts = [];
  const state = { root, scene: undefined, group: undefined, texts, publication: undefined };
  try {
    const scene = new THREE.Scene();
    state.scene = scene;
    state.publication = instrumentScenePublication(scene);
    const group = root.createTextGroup({ batching: 'group' });
    state.group = group;
    scene.add(group);
    for (let index = 0; index < count; index += 1) {
      const text = root.createText({
        font,
        text: label(index, 0),
        constraints: { width: { mode: 'exact', size: CELL - 4 } },
        layout: { align: 'start', wrap: 'none' },
        style: { color: '#ffffff', fontSize: 7, lineHeight: 1 },
      });
      texts.push(text);
      text.position.set((index % SIDE) * CELL + 2, -Math.floor(index / SIDE) * CELL - 10, 0);
      group.add(text);
    }
    return state;
  } catch (error) {
    try {
      disposeScene(state);
    } catch (cleanupError) {
      console.error('Partial dense scene cleanup failed', cleanupError);
    }
    throw error;
  }
}

function disposeScene(state) {
  const errors = [];
  state.publication?.restore();
  for (const text of state.texts) {
    try {
      text.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    try {
      text.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    state.group?.removeFromParent();
  } catch (error) {
    errors.push(error);
  }
  try {
    state.group?.dispose();
  } catch (error) {
    errors.push(error);
  }
  try {
    state.root.dispose();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Dense scene cleanup failed');
}

function instrumentScenePublication(scene) {
  const original = scene.updateMatrixWorld;
  let measuring = false;
  let duration = 0;
  let calls = 0;
  scene.updateMatrixWorld = function (force) {
    if (!measuring) return original.call(this, force);
    const started = performance.now();
    try {
      return original.call(this, force);
    } finally {
      duration += performance.now() - started;
      calls += 1;
    }
  };
  return {
    begin() {
      duration = 0;
      calls = 0;
      measuring = true;
    },
    end() {
      measuring = false;
      return { duration, calls };
    },
    restore() {
      scene.updateMatrixWorld = original;
    },
  };
}

function label(index, phase) {
  return `${phase === 0 ? 'alpha' : 'bravo'} ${String(index).padStart(4, '0')}`;
}

async function outputProof(state, pixels) {
  const commits = state.texts.map((text) => text.commitState());
  if (commits.some((commit) => commit.status !== 'committed')) throw new Error('Text publication did not commit');
  if (state.scene.children.filter((child) => child === state.group).length !== 1)
    throw new Error('Missing sole TextGroup');
  if (state.group.children.length !== state.texts.length) throw new Error('TextGroup member count differs');
  const draws =
    state.scene
      .getObjectByName(`@pmndrs/glyph:${state.root.name}`)
      ?.children.filter((child) => child instanceof THREE.Mesh) ?? [];
  const instances = draws.reduce(
    (total, draw) => total + (draw.geometry instanceof THREE.InstancedBufferGeometry ? draw.geometry.instanceCount : 0),
    0,
  );
  let nonblankPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0 || pixels[offset + 1] !== 0 || pixels[offset + 2] !== 0) nonblankPixels += 1;
  }
  const pixelSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return {
    committed: commits.length,
    groupChildren: state.group.children.length,
    draws: draws.length,
    instances,
    firstMeasurement: state.texts[0].measure(),
    lastMeasurement: state.texts.at(-1).measure(),
    nonblankPixels,
    pixelSha256,
  };
}

function webglInfo(gl) {
  if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL backend has no WebGL2 context');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    context: gl.getParameter(gl.VERSION),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : 'unavailable',
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
  };
}

function webgpuInfo(device) {
  if (!device) throw new Error('WebGPU backend has no device');
  const adapter = device.adapterInfo;
  return {
    device: 'WebGPUDevice',
    adapter: adapter
      ? {
          vendor: adapter.vendor || 'unavailable',
          architecture: adapter.architecture || 'unavailable',
          device: adapter.device || 'unavailable',
          description: adapter.description || 'unavailable',
        }
      : 'unavailable from active Three device',
    features: [...device.features].sort(),
    limits: { maxTextureDimension2D: device.limits.maxTextureDimension2D },
  };
}
