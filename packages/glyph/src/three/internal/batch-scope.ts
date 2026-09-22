import type * as THREE from 'three/webgpu';

const batchScopes = new WeakMap<object, WeakRef<THREE.Object3D>>();

/** Associate one renderer material binding with the authored group that owns its physical draw scope. */
export function setThreeBatchScope(binding: object, scope: THREE.Object3D | undefined): void {
  if (scope === undefined) batchScopes.delete(binding);
  else batchScopes.set(binding, new WeakRef(scope));
}

/** Preserve batch ownership while resolving an application material against one Three root. */
export function inheritThreeBatchScope(source: object, target: object): void {
  const scope = batchScopes.get(source);
  if (scope === undefined) batchScopes.delete(target);
  else batchScopes.set(target, scope);
}

/** Resolve the authored group that may cull every contribution to one physical draw. */
export function threeBatchScope(binding: object | undefined): THREE.Object3D | undefined {
  return binding === undefined ? undefined : batchScopes.get(binding)?.deref();
}
