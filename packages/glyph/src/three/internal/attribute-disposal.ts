import * as THREE from 'three/webgpu';

/** Three r185/r186's renderer-owned attribute manager; its delete path updates both GPU state and renderer.info. */
type AttributeManager = Readonly<{
  has(attribute: THREE.BufferAttribute): boolean;
  delete(attribute: THREE.BufferAttribute): unknown;
}>;

const rendererManagers = new WeakMap<object, AttributeManager>();
type Registration = {
  readonly seen: WeakSet<AttributeManager>;
  readonly managers: Set<WeakRef<AttributeManager>>;
};
const registrations = new WeakMap<THREE.BufferAttribute, Registration>();

/**
 * Three before the upstream attribute-disposal fix only frees storage through its internal Attributes.delete path.
 * The actual renderer is known when it encounters a draw; delete is harmless if that draw never initializes storage.
 */
export function trackStorageRenderer(renderer: object, attributes: readonly THREE.BufferAttribute[]): void {
  // Only these published revisions have the manager behavior verified below; later versions use attribute.dispose().
  if (THREE.REVISION !== '185' && THREE.REVISION !== '186') return;
  let manager = rendererManagers.get(renderer);
  if (manager === undefined) {
    const candidate = (renderer as { readonly _attributes?: unknown })._attributes;
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('has' in candidate) ||
      typeof candidate.has !== 'function' ||
      !('delete' in candidate) ||
      typeof candidate.delete !== 'function'
    ) {
      throw new TypeError('Three renderer did not expose its initialized attribute manager');
    }
    manager = candidate as AttributeManager;
    rendererManagers.set(renderer, manager);
  }

  for (const attribute of attributes) {
    let registration = registrations.get(attribute);
    if (registration === undefined) {
      const managers = new Set<WeakRef<AttributeManager>>();
      const seen = new WeakSet<AttributeManager>();
      const onDispose = (): void => {
        let failure: unknown;
        for (const reference of managers) {
          try {
            reference.deref()?.delete(attribute);
          } catch (error) {
            failure ??= error;
          }
        }
        managers.clear();
        registrations.delete(attribute);
        attribute.removeEventListener('dispose', onDispose);
        if (failure !== undefined) throw failure;
      };
      attribute.addEventListener('dispose', onDispose);
      registration = { seen, managers };
      registrations.set(attribute, registration);
    }
    if (!registration.seen.has(manager)) {
      registration.seen.add(manager);
      for (const reference of registration.managers) {
        if (reference.deref() === undefined) registration.managers.delete(reference);
      }
      // Weak references keep a long-lived storage attribute from retaining a discarded renderer.
      registration.managers.add(new WeakRef(manager));
    }
  }
}
