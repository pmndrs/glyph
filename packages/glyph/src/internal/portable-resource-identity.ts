import type { PortableResource } from '../config/resources.js';

const identities = new WeakMap<object, object>();

export function portableResourceIdentity(resource: PortableResource): object {
  let identity = identities.get(resource);
  if (identity === undefined) {
    identity = Object.freeze({});
    identities.set(resource, identity);
  }
  return identity;
}
