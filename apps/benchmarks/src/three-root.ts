import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, type GlyphBufferCapacity, type ThreeRoot } from '@pmndrs/glyph/three';

interface BenchmarkThreeRootOptions {
  readonly capacity?: GlyphBufferCapacity;
  readonly compositing?: 'ordered' | 'independent';
}

const owners = new WeakMap<ThreeRoot, ReturnType<typeof createHandle>>();
let nextHandle = 1;

await glyph.init();

/** Create one semantically named benchmark root after all target-specific raster registration has run. */
export function createBenchmarkThreeRoot(name: string, options: BenchmarkThreeRootOptions = {}): ThreeRoot {
  const handle = createHandle(name);
  const root = handle(name);
  if (options.capacity !== undefined) root.setCapacity(options.capacity);
  if (options.compositing !== undefined) root.setCompositing(options.compositing);
  owners.set(root, handle);
  return root;
}

/** Dispose the root and the private handle that owns its renderer/font caches. */
export function disposeBenchmarkThreeRoot(root: ThreeRoot): void {
  const handle = owners.get(root);
  if (handle === undefined) throw new TypeError('benchmark Three root was not created by createBenchmarkThreeRoot');
  owners.delete(root);
  handle.dispose();
}

function createHandle(label: string) {
  const handle = glyph.handle(`benchmarks:${label}:${String(nextHandle)}`, ThreeConfig);
  nextHandle += 1;
  return handle;
}
