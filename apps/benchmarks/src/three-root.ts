import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, type GlyphBufferCapacity, type ThreeRoot } from '@pmndrs/glyph/three';

interface BenchmarkThreeRootOptions {
  readonly capacity?: GlyphBufferCapacity;
  readonly compositing?: 'ordered' | 'independent';
}

await glyph.init();
const benchmarkHandle = glyph.handle('benchmarks', ThreeConfig);

/** Create one semantically named benchmark root after all target-specific raster registration has run. */
export function createBenchmarkThreeRoot(name: string, options: BenchmarkThreeRootOptions = {}): ThreeRoot {
  const root = benchmarkHandle(name);
  if (options.capacity !== undefined) root.setCapacity(options.capacity);
  if (options.compositing !== undefined) root.setCompositing(options.compositing);
  return root;
}

/** Dispose one named publication root while preserving the benchmark application's shared handle. */
export function disposeBenchmarkThreeRoot(root: ThreeRoot): void {
  if (root.handle !== benchmarkHandle || root.name === undefined) {
    throw new TypeError('benchmark Three root was not created by createBenchmarkThreeRoot');
  }
  root.dispose();
}

if (import.meta.hot !== undefined) import.meta.hot.dispose(() => benchmarkHandle.dispose());
