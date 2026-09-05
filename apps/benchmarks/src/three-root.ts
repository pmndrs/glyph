import { glyph } from '@pmndrs/glyph';
import { defineThreeConfig, type GlyphBufferCapacity, type ThreeHandle, type ThreeRoot } from '@pmndrs/glyph/three';

interface BenchmarkThreeRootOptions {
  readonly capacity?: GlyphBufferCapacity;
}

await glyph.init();
const benchmarkHandles = new Map<string, ThreeHandle>();

function benchmarkHandle(options: BenchmarkThreeRootOptions): ThreeHandle {
  const capacity = options.capacity ?? { size: 4_096, policy: 'chunk' };
  const key = `${String(capacity.size)}:${capacity.policy}`;
  const existing = benchmarkHandles.get(key);
  if (existing !== undefined) return existing;
  const handle = glyph.handle(`benchmarks:${key}`, defineThreeConfig({ capacity }));
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
