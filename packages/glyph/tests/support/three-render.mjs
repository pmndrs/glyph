import assert from 'node:assert/strict';

/**
 * What `renderer.render(scene, camera)` does to a Scene, in Three's order: traverse it, call its `onBeforeRender`,
 * draw, then call its `onAfterRender`. A Glyph root throws what the render found from that last hook.
 */
export function renderScene(scene) {
  if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
  scene.onBeforeRender();
  scene.onAfterRender();
}

/** Asserts that every live Text in `object`, itself included, is committed: its current input was published. */
export function assertCommitted(object, message) {
  object.traverse((node) => {
    if (typeof node.commitState === 'function' && !node.disposed)
      assert.equal(node.commitState().status, 'committed', message);
  });
}

/** Ends a render whose traversal already ran (`scene.updateMatrixWorld()`), throwing what that traversal found. */
export function endRender(scene) {
  scene.onBeforeRender();
  scene.onAfterRender();
}
