/** Deterministic jitter in [0, 1) from an index. */
export function jitter(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;

  return value - Math.floor(value);
}

/**
 * Keep one set of uniforms across a hot module replacement. A uniform set is written every frame by a mounted view
 * and read once by the render pipeline when its node graph is built, and the two import it from the same module but
 * re-execute at their own times. A fresh set on replacement leaves the writer and the reader holding different
 * objects: the simulation carries on while the frame stops answering it, so the scene falls into the hole and the
 * picture of it does not. Vite hands a replaced module its predecessor's data, so the same set comes back. Outside
 * development nothing is replaced and every caller builds its own.
 */
export function retained<T extends object>(key: string, build: () => T): T {
  const store = import.meta.hot?.data as Record<string, T | undefined> | undefined;
  const kept = store?.[key];

  if (kept !== undefined) return kept;

  const made = build();

  if (store !== undefined) store[key] = made;

  return made;
}
