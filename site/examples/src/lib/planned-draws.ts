import type { Object3D } from 'three/webgpu';

/**
 * How many draws the plan left in the scene. Every glyph root attaches one
 * draw object named `@pmndrs/glyph:<root>`, and each planned draw is one mesh
 * under it — so counting children counts draws, per root when a name is given.
 */
export function plannedDraws(scene: Object3D, root?: string): number {
  const prefix = root === undefined ? '@pmndrs/glyph:' : `@pmndrs/glyph:${root}`;
  let count = 0;
  scene.traverse((object) => {
    if (object.name.startsWith(prefix)) count += object.children.length;
  });
  return count;
}
