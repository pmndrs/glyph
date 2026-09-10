import { createContext, useContext } from 'react';
import { PerspectiveCamera, type Camera, type Vector3 } from 'three/webgpu';

/**
 * Pointer input as the explainer element delivers it: the proxy's pointer
 * events, mapped into the root's virtual frame in CSS pixels, queued for the
 * scene to drain inside `useFrame`. The type is structural so the examples
 * app needs nothing from the element; the element's `GlyphInputStream`
 * satisfies it as is.
 */
export interface SceneInput {
  readonly type: string;
  readonly buttons?: number;
  readonly pointerId?: number;
  readonly x?: number;
  readonly y?: number;
  readonly value?: string;
}

export interface SceneInputs {
  drain(): readonly SceneInput[];
}

export const SceneInputsContext = createContext<SceneInputs | undefined>(undefined);

/** The scene's mailbox, or `undefined` where no host feeds one (a plain canvas). */
export function useSceneInputs(): SceneInputs | undefined {
  return useContext(SceneInputsContext);
}

/**
 * A frame point in CSS pixels to the world point where its ray crosses the
 * plane `z = plane`. The frame is the root's, so `size` is R3F's `size`.
 */
export function pointerToWorld(
  x: number,
  y: number,
  size: { readonly width: number; readonly height: number },
  camera: Camera,
  out: Vector3,
  plane = 0,
): Vector3 {
  out.set((x / Math.max(size.width, 1)) * 2 - 1, -((y / Math.max(size.height, 1)) * 2 - 1), 0.5).unproject(camera);
  if (camera instanceof PerspectiveCamera) {
    const direction = out.sub(camera.position).normalize();
    const distance = (plane - camera.position.z) / direction.z;
    return out.copy(camera.position).addScaledVector(direction, distance);
  }
  out.z = plane;
  return out;
}
