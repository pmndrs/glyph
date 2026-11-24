import type * as THREE from 'three/webgpu';

/** Ends a headless frame as renderer.render() does, so Glyph throws what the frame found. */
export function endFrame(scene: THREE.Scene): void {
  const hooks = scene as unknown as { onBeforeRender(): void; onAfterRender(): void };
  hooks.onBeforeRender();
  hooks.onAfterRender();
}
