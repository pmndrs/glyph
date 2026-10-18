import { glyph } from '@pmndrs/glyph';
import {
  defineThreeConfig as defineStableThreeConfig,
  type GlyphBufferCapacity,
  type ThreeHandle,
  type ThreeRoot,
} from '@pmndrs/glyph/three';

interface BenchmarkThreeRootOptions {
  readonly capacity?: GlyphBufferCapacity;
  readonly transformMode?: 'direct' | 'indexed';
}

const defineThreeConfig =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('shaders') === 'typegpu'
    ? (await import('@pmndrs/glyph/three/typegpu')).defineThreeConfig
    : defineStableThreeConfig;

await glyph.init();
const benchmarkHandles = new Map<string, ThreeHandle>();

function benchmarkHandle(options: BenchmarkThreeRootOptions): ThreeHandle {
  const capacity = options.capacity ?? { size: 4_096, policy: 'chunk' };
  const transformMode = options.transformMode ?? 'indexed';
  const key = `${String(capacity.size)}:${capacity.policy}:${transformMode}`;
  const existing = benchmarkHandles.get(key);
  if (existing !== undefined) return existing;
  const handle = glyph.handle(`benchmarks:${key}`, defineThreeConfig({ capacity, transformMode }));
  benchmarkHandles.set(key, handle);
  return handle;
}

/** Create one semantically named benchmark root after all target-specific raster registration has run. */
export function createBenchmarkThreeRoot(name: string, options: BenchmarkThreeRootOptions = {}): ThreeRoot {
  return benchmarkHandle(options)(name);
}

/** Dispose one named publication root while preserving the benchmark application's shared handle. */
export function disposeBenchmarkThreeRoot(root: ThreeRoot): void {
  if (![...benchmarkHandles.values()].includes(root.handle) || root.name === undefined) {
    throw new TypeError('benchmark Three root was not created by createBenchmarkThreeRoot');
  }
  root.dispose();
}

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    for (const handle of benchmarkHandles.values()) handle.dispose();
    benchmarkHandles.clear();
  });
}
