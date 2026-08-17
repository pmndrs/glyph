/** Three.js/TSL boundary over the host-agnostic vertex dilation in `core/dilate.js`. */
import type { Node } from 'three/webgpu';
export { slugDilate } from './core/dilate.js';

export interface SlugDilationNodes {
  readonly position: Node<'vec2'>;
  readonly textureCoordinate: Node<'vec2'>;
}
