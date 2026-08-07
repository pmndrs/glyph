import type { Node } from 'three/webgpu';
import { property } from 'three/tsl';
import * as t3 from '@typegpu/three';

/**
 * Evaluate one host-agnostic core shader function and hand its result back as a TSL node.
 *
 * The result is always a named TSL property rather than the raw bridge node, and that
 * is load-bearing rather than cosmetic. `@typegpu/three` builds a core call by resolving
 * TypeGPU while traversing every TSL node the call reads, and TypeGPU's resolution
 * context is a single stack, so a second core node reachable through those arguments
 * would resolve re-entrantly and corrupt it. Assigning through a property emits each
 * core call as its own statement and leaves later calls reading an opaque leaf, which
 * is what lets the fill algorithm cross the boundary more than once per fragment.
 *
 * `name` appears verbatim in the generated shader and shares one WGSL namespace with
 * the core functions themselves, so it must be unique per stage and must never equal
 * the name of a core function. `slug-shader-wgsl.test.mjs` holds both invariants.
 */
export function coreValue<const NodeType extends string>(
  type: NodeType,
  name: string,
  core: () => unknown,
): Node<NodeType> {
  const result: Node<NodeType> = property(type, name);
  result.assign(t3.toTSL(core) as Node<NodeType>);
  return result;
}
