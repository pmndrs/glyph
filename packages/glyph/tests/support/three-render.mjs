/**
 * What `renderer.render(scene, camera)` does to a Scene, in Three's order: traverse it, call its `onBeforeRender`,
 * draw, then call its `onAfterRender`. A Glyph root throws what the render found from that last hook.
 */
export function renderScene(scene) {
  if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
  scene.onBeforeRender();
  scene.onAfterRender();
}
