import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three/webgpu';

const raycaster = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();

/**
 * A frame point in CSS pixels to a Text-local point for the editing queries: the pointer's ray meets the plane
 * the text lies on (world `z = 0` in these scenes), `worldToLocal` undoes the text's transform, and y flips
 * because Text-local coordinates are +Y down while the three.js object is +Y up.
 */
export function pointerToTextLocal(
  text: Object3D,
  x: number,
  y: number,
  size: { readonly width: number; readonly height: number },
  camera: Camera,
): { readonly x: number; readonly y: number } {
  ndc.set((x / Math.max(size.width, 1)) * 2 - 1, -((y / Math.max(size.height, 1)) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  hit.copy(origin).addScaledVector(direction, -origin.z / direction.z);
  const local = text.worldToLocal(hit);
  return { x: local.x, y: -local.y };
}
