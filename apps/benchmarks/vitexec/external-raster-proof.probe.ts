import type { BenchmarkMeasurement } from '../src/benchmark/contracts';
import * as THREE from 'three/webgpu';

const executionPath = '/src/benchmark/execution.ts';
const environmentPath = '/src/benchmark/environment.ts';
const rendererPath = '/src/renderer/webgpu-renderer.ts';
const [{ runRegisteredBenchmark }, { environmentResource }, rendererModule] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ rendererPath),
]);
const environment = await environmentResource();
if (environment.webgpu !== true) throw new Error('External raster proof requires WebGPU-capable Chrome');

for (const [targetId, backendMetric] of [
  ['external-raster-proof-webgpu', 'backendWebGpu'],
  ['external-raster-proof-webgl2', 'backendWebGl2'],
] as const) {
  const before = rendererModule.configuredRendererDiagnostics();
  const renderer = await rendererModule.createConfiguredRenderer({
    backend: targetId.endsWith('webgpu') ? 'webgpu' : 'webgl2',
    canvas: document.createElement('canvas'),
    dpr: 1,
    width: 32,
    height: 24,
  });
  renderer.setClearColor(0x123456, 0.75);
  renderer.setViewport(2, 3, 20, 16);
  renderer.setScissor(4, 5, 12, 10);
  renderer.setScissorTest(true);
  const controller = new AbortController();
  let result: Awaited<ReturnType<typeof runRegisteredBenchmark>>;
  try {
    result = await runRegisteredBenchmark({
      targetId,
      scenarioId: 'external-raster-proof',
      input: {},
      controls: { dpr: 1, samples: 2, warmup: 1 },
      environment,
      executionContext: { renderer, signal: controller.signal },
    });
    const after = rendererModule.configuredRendererDiagnostics();
    const clear = renderer.getClearColor(new THREE.Color());
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    if (
      after.activeCount !== 1 ||
      after.createdCount !== before.createdCount + 1 ||
      after.peakActiveCount > 1 ||
      clear.getHex() !== 0x123456 ||
      renderer.getClearAlpha() !== 0.75 ||
      !viewport.equals(new THREE.Vector4(2, 3, 20, 16)) ||
      !scissor.equals(new THREE.Vector4(4, 5, 12, 10)) ||
      renderer.getScissorTest() !== true
    ) {
      throw new Error(`${targetId} did not borrow exactly one renderer and restore its state`);
    }
  } finally {
    await rendererModule.disposeConfiguredRenderer(renderer);
  }
  if (
    result.status !== 'passed' ||
    result.measurements.length !== 2 ||
    result.measurements.some(
      (measurement: BenchmarkMeasurement) =>
        measurement.metrics?.[backendMetric] !== 1 ||
        measurement.metrics.glyphCount !== 13 ||
        measurement.metrics.drawCount !== 1 ||
        measurement.metrics.retainedObject !== 1 ||
        measurement.metrics.retainedGeometry !== 1 ||
        (measurement.metrics.litPixels ?? 0) < 100,
    )
  ) {
    throw new Error(`${targetId} did not preserve the public external raster contract`);
  }
  console.log(
    'external-raster-proof-ready',
    JSON.stringify({ targetId, hash: result.measurements[0]?.hash, validation: result.validation }),
  );
}

export {};
