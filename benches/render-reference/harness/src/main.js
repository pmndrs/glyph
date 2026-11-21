// Library-neutral harness. One page = one contender + one scene; the driver (scripts/run.mjs)
// opens one page per contender and interleaves samples round-robin.
import * as THREE from 'three/webgpu';
import { WIDTHS, knownEdit, newLetterEdit } from './content.js';

const moduleStartMs = performance.now();
const query = new URLSearchParams(location.search);
const lib = query.get('lib') ?? 'ultra';
const sceneName = query.get('scene') ?? 'para';
const instrument = query.has('instr');
const shot = query.has('shot');

const TARGET_WIDTH = 3200;
const TARGET_HEIGHT = 2400;

const adapters = {
  empty: () => import('./adapters/empty.js'),
  ultra: () => import('./adapters/ultra.js'),
  npm: () => import('./adapters/glyph-npm.js'),
  main: () => import('./adapters/glyph-main.js'),
  branch: () => import('./adapters/glyph-branch.js'),
  render: () => import('./adapters/glyph-render.js'),
};

// ---- API-level instrumentation (only with ?instr): GPU allocations and draw calls ----------
const gpu = { live: 0, peak: 0, created: 0, buffers: 0, textures: 0, unknownFormats: [], log: [] };
const draws = { count: 0 };
const api = {};
const apiSnapshot = () => JSON.parse(JSON.stringify(api));

const BYTES_PER_TEXEL = {
  r8unorm: 1,
  r8snorm: 1,
  r8uint: 1,
  r8sint: 1,
  rg8unorm: 2,
  rg8snorm: 2,
  rg8uint: 2,
  rg8sint: 2,
  r16uint: 2,
  r16sint: 2,
  r16float: 2,
  r16unorm: 2,
  depth16unorm: 2,
  rgba8unorm: 4,
  'rgba8unorm-srgb': 4,
  rgba8snorm: 4,
  rgba8uint: 4,
  rgba8sint: 4,
  bgra8unorm: 4,
  'bgra8unorm-srgb': 4,
  rg16uint: 4,
  rg16sint: 4,
  rg16float: 4,
  rg16unorm: 4,
  r32uint: 4,
  r32sint: 4,
  r32float: 4,
  rgb10a2unorm: 4,
  rg11b10ufloat: 4,
  rgb9e5ufloat: 4,
  depth24plus: 4,
  'depth24plus-stencil8': 4,
  depth32float: 4,
  'depth32float-stencil8': 8,
  rg32uint: 8,
  rg32sint: 8,
  rg32float: 8,
  rgba16uint: 8,
  rgba16sint: 8,
  rgba16float: 8,
  rgba16unorm: 8,
  rgba32uint: 16,
  rgba32sint: 16,
  rgba32float: 16,
};

function textureBytes(descriptor) {
  const size = descriptor.size;
  const width = Array.isArray(size) || ArrayBuffer.isView(size) ? size[0] : size.width;
  const height = Array.isArray(size) || ArrayBuffer.isView(size) ? (size[1] ?? 1) : (size.height ?? 1);
  const layers = Array.isArray(size) || ArrayBuffer.isView(size) ? (size[2] ?? 1) : (size.depthOrArrayLayers ?? 1);
  let texel = BYTES_PER_TEXEL[descriptor.format];
  if (texel === undefined) {
    gpu.unknownFormats.push(descriptor.format);
    texel = 4;
  }
  let bytes = 0;
  for (let level = 0; level < (descriptor.mipLevelCount ?? 1); level += 1) {
    bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * layers * texel;
  }
  return bytes * (descriptor.sampleCount ?? 1);
}

function track(resource, bytes, kind, detail) {
  gpu.live += bytes;
  gpu.created += bytes;
  gpu.peak = Math.max(gpu.peak, gpu.live);
  gpu[kind] += 1;
  gpu.log.push({ kind, bytes, detail });
  const destroy = resource.destroy.bind(resource);
  let destroyed = false;
  resource.destroy = () => {
    if (!destroyed) {
      destroyed = true;
      gpu.live -= bytes;
      gpu.log.push({ kind: `destroy-${kind}`, bytes: -bytes, detail });
    }
    destroy();
  };
  return resource;
}

function installInstrumentation() {
  const createBuffer = GPUDevice.prototype.createBuffer;
  GPUDevice.prototype.createBuffer = function (descriptor) {
    return track(
      createBuffer.call(this, descriptor),
      descriptor.size,
      'buffers',
      descriptor.label ?? `usage:${descriptor.usage}`,
    );
  };
  const createTexture = GPUDevice.prototype.createTexture;
  GPUDevice.prototype.createTexture = function (descriptor) {
    const size = descriptor.size;
    const dims = Array.isArray(size)
      ? size.join('x')
      : `${size.width}x${size.height ?? 1}x${size.depthOrArrayLayers ?? 1}`;
    return track(
      createTexture.call(this, descriptor),
      textureBytes(descriptor),
      'textures',
      `${descriptor.format} ${dims} mips:${descriptor.mipLevelCount ?? 1} ${descriptor.label ?? ''}`,
    );
  };
  // Synchronous time and bytes per WebGPU entry point (where the first frame and uploads go).
  const timed = (prototype, method, bytesOf) => {
    const original = prototype[method];
    if (original === undefined) return;
    prototype[method] = function (...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const entry = (api[method] ??= { calls: 0, ms: 0, bytes: 0 });
        entry.calls += 1;
        entry.ms += performance.now() - start;
        if (bytesOf !== undefined) entry.bytes += bytesOf(args);
      }
    };
  };
  for (const method of [
    'createShaderModule',
    'createRenderPipeline',
    'createRenderPipelineAsync',
    'createComputePipeline',
    'createComputePipelineAsync',
    'createBindGroup',
    'createBindGroupLayout',
    'createPipelineLayout',
    'createSampler',
    'createBuffer',
    'createTexture',
    'createCommandEncoder',
  ]) {
    timed(GPUDevice.prototype, method);
  }
  timed(GPUQueue.prototype, 'writeBuffer', (args) =>
    args[4] !== undefined
      ? args[4] * (args[2].BYTES_PER_ELEMENT ?? 1)
      : (args[2].byteLength ?? 0) - (args[3] ?? 0) * (args[2].BYTES_PER_ELEMENT ?? 1),
  );
  timed(GPUQueue.prototype, 'writeTexture', (args) => args[1].byteLength ?? 0);
  timed(GPUQueue.prototype, 'copyExternalImageToTexture');
  timed(GPUQueue.prototype, 'submit');
  for (const method of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
    const original = GPURenderPassEncoder.prototype[method];
    GPURenderPassEncoder.prototype[method] = function (...args) {
      draws.count += 1;
      return original.apply(this, args);
    };
  }
}

// ---- Scene ------------------------------------------------------------------------------------
async function boot() {
  if (instrument) installInstrumentation();
  const canvas = document.querySelector('#canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(800, 600, false);
  await renderer.init();
  const device = renderer.backend.device;
  if (device === undefined) throw new Error('WebGPU backend is not active');
  renderer.setClearColor(0x101418, 1);

  const target = new THREE.RenderTarget(TARGET_WIDTH, TARGET_HEIGHT, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
  });
  const scene = new THREE.Scene();
  // One scene unit = one CSS pixel; the 800x600 px stage fills the 3200x2400 target (4x).
  // ?scale=1 keeps the same content at 1 target pixel per CSS pixel (text fills a 800x600 corner).
  const scale = Number(query.get('scale') ?? 4);
  const camera = new THREE.OrthographicCamera(0, TARGET_WIDTH / scale, 600, 600 - TARGET_HEIGHT / scale, 0.1, 200);
  camera.position.z = 100;
  const perspective = query.has('persp') ? new THREE.PerspectiveCamera(50, 800 / 600, 1, 4000) : undefined;
  if (perspective !== undefined) {
    const distance = (300 / Math.tan((25 * Math.PI) / 180)) * (4 / scale);
    perspective.position.set(400, 300, distance);
    perspective.lookAt(400, 300, 0);
  }
  const view = perspective ?? camera;
  renderer.setRenderTarget(shot ? null : target);

  const done = () => device.queue.onSubmittedWorkDone();
  const { default: adapter } = await adapters[lib]();
  const context = { THREE, renderer, scene, camera: view, sceneName, query, stage: document.querySelector('#stage') };
  const frame = () => {
    adapter.frame();
    renderer.render(scene, view);
  };

  // Renderer baseline: one empty frame, so the first-frame and memory numbers are text-only.
  renderer.render(scene, view);
  await done();
  const baseline = { live: gpu.live, created: gpu.created, peak: gpu.peak };
  gpu.peak = gpu.live;

  await adapter.prepare(context);
  const preparedMs = performance.now();
  const apiBeforeAuthor = apiSnapshot();

  // ?hold lets the driver start a CPU profile exactly at the authoring call.
  if (query.has('hold')) await new Promise((resolve) => (window.benchGo = resolve));
  const authorStart = performance.now();
  await adapter.author(context);
  const authoredMs = performance.now();
  adapter.frame();
  const hookedMs = performance.now();
  renderer.render(scene, view);
  const renderedMs = performance.now();
  await done();
  const firstFrameMs = performance.now();

  const adapterInfo = renderer.backend.adapter?.info ?? (await navigator.gpu.requestAdapter())?.info;
  const first = {
    lib,
    scene: sceneName,
    authorToGpuDoneMs: firstFrameMs - authorStart,
    authorCallMs: authoredMs - authorStart,
    firstRenderCpuMs: renderedMs - authoredMs,
    frameHookMs: hookedMs - authoredMs,
    rendererRenderMs: renderedMs - hookedMs,
    gpuWaitMs: firstFrameMs - renderedMs,
    navToGpuDoneMs: firstFrameMs,
    navToModuleMs: moduleStartMs,
    navToPreparedMs: preparedMs,
    crossOriginIsolated: self.crossOriginIsolated,
    adapter: adapterInfo && {
      vendor: adapterInfo.vendor,
      architecture: adapterInfo.architecture,
      device: adapterInfo.device,
      description: adapterInfo.description,
    },
    three: THREE.REVISION,
    stats: adapter.stats(),
    api: instrument ? { beforeAuthor: apiBeforeAuthor, afterFirstFrame: apiSnapshot() } : undefined,
  };

  const timedMutation = async (mutate) => {
    const start = performance.now();
    const pending = mutate();
    if (pending !== undefined) await pending;
    const mutated = performance.now();
    frame();
    const rendered = performance.now();
    await done();
    const end = performance.now();
    return { ms: end - start, mutateMs: mutated - start, renderCpuMs: rendered - mutated, gpuWaitMs: end - rendered };
  };

  window.bench = {
    first,
    async steady(frames) {
      const start = performance.now();
      for (let i = 0; i < frames; i += 1) frame();
      const cpuEnd = performance.now();
      await done();
      const end = performance.now();
      return { cpuMs: (cpuEnd - start) / frames, e1Ms: (end - start) / frames };
    },
    width: (index, mode) => timedMutation(() => adapter.setWidth(WIDTHS[index % WIDTHS.length], mode)),
    editKnown: (index) => timedMutation(() => adapter.setText(knownEdit(index))),
    editNew: (index) => timedMutation(() => adapter.setText(newLetterEdit(index))),
    async settle() {
      for (let i = 0; i < 8; i += 1) frame();
      await done();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await done();
    },
    draws() {
      const before = draws.count;
      frame();
      return { apiDraws: draws.count - before, infoDrawCalls: renderer.info.render.drawCalls, stats: adapter.stats() };
    },
    memory() {
      const MiB = 1024 * 1024;
      return {
        residentMiB: (gpu.live - baseline.live) / MiB,
        peakMiB: (gpu.peak - baseline.live) / MiB,
        createdMiB: (gpu.created - baseline.created) / MiB,
        baselineMiB: baseline.live / MiB,
        unknownFormats: gpu.unknownFormats,
        stats: adapter.stats(),
      };
    },
    memoryLog: () => gpu.log,
    api: apiSnapshot,
    // CPU-only loops for profiling (no GPU wait between iterations).
    async profileLoop(kind, iterations) {
      for (let i = 0; i < iterations; i += 1) {
        if (kind === 'steady') frame();
        else if (kind === 'width') {
          const pending = adapter.setWidth(WIDTHS[i % WIDTHS.length], query.get('wmode') ?? undefined);
          if (pending !== undefined) await pending;
          frame();
        } else if (kind === 'editKnown') {
          const pending = adapter.setText(knownEdit(i));
          if (pending !== undefined) await pending;
          frame();
        }
      }
      await done();
    },
  };
  return first;
}

window.benchReady = boot().catch((error) => {
  console.error(error);
  return { error: String(error?.stack ?? error) };
});
