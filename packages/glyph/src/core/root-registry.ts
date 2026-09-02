import type { GlyphRoot } from './glyph-config.js';

/** Handle-local idempotent lookup for one anonymous root and any number of named roots. */
export interface GlyphRootRegistry<Root extends GlyphRoot> {
  readonly anonymous: Root;
  get(name: string): Root;
  dispose(): void;
}

/**
 * Creates the renderer-neutral root registry used by a configured handle. The factory receives
 * an idempotent release callback so independently disposed roots relinquish their lookup key.
 */
export function createGlyphRootRegistry<Root extends GlyphRoot>(
  create: (name: string | undefined, release: () => void) => Root,
): GlyphRootRegistry<Root> {
  if (typeof create !== 'function') throw new TypeError('Glyph root factory must be a function');
  const roots = new Map<string | undefined, Root>();
  let disposed = false;

  const select = (name: string | undefined): Root => {
    if (disposed) throw new Error('Glyph root registry has been disposed');
    const existing = roots.get(name);
    if (existing !== undefined) return existing;
    let root!: Root;
    const release = (): void => {
      if (roots.get(name) === root) roots.delete(name);
    };
    root = create(name, release);
    if (root.name !== name || typeof root.dispose !== 'function') {
      try {
        root.dispose();
      } catch {
        // Preserve the invalid factory result as the primary failure.
      }
      throw new TypeError('Glyph root factory must preserve the selected name and return a disposable root');
    }
    roots.set(name, root);
    return root;
  };

  const anonymous = select(undefined);
  return Object.freeze({
    anonymous,
    get(name: string): Root {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new TypeError('Glyph named-root selection requires a nonempty string');
      }
      return select(name);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let failure: unknown;
      for (const root of [...roots.values()]) {
        try {
          root.dispose();
        } catch (error) {
          failure ??= error;
        }
      }
      roots.clear();
      if (failure !== undefined) throw failure;
    },
  });
}
