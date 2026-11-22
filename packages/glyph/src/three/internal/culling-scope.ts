import type * as THREE from 'three/webgpu';

/**
 * `Text`, `TextGroup` and `Glyphs` honour Three's own `frustumCulled = false`: every draw that renders a record of an
 * opted-out object, or of an object inside an opted-out `TextGroup`, is drawn whatever the camera sees. Three reads the
 * flag only on the meshes it submits, so each of those objects reports a change from its per-frame matrix visit, and
 * each draw re-reads its members only after such a report or a change of the records it draws.
 */
const scopes = new WeakSet<THREE.Object3D>();
let generation = 0;
/** No object has ever opted out: every draw keeps its computed bound without reading its members. */
let anyOptedOut = false;

export function registerCullingScope(object: THREE.Object3D): void {
  scopes.add(object);
}

/** A scope's `frustumCulled` differs from the value its last traversal observed. */
export function cullingScopeChanged(frustumCulled: boolean): void {
  generation += 1;
  if (!frustumCulled) anyOptedOut = true;
}

/** A Text or one of its ancestors was reparented, so the `TextGroup`s enclosing it may have changed. */
export function cullingTreeChanged(): void {
  if (anyOptedOut) generation += 1;
}

export function cullingGeneration(): number {
  return generation;
}

/** Whether `object`, or a `TextGroup` enclosing it, has `frustumCulled === false`. */
export function optsOutOfCulling(object: THREE.Object3D | undefined): boolean {
  if (!anyOptedOut) return false;
  for (let node = object ?? null; node !== null; node = node.parent) {
    if (!node.frustumCulled && scopes.has(node)) return true;
  }
  return false;
}

export function cullingOptOutObserved(): boolean {
  return anyOptedOut;
}
