import * as THREE from 'three/webgpu';

import type { PersistentRenderSceneRenderer } from './persistent-render-host';

interface RendererStateSnapshot {
  readonly activeCubeFace: number;
  readonly activeMipmapLevel: number;
  readonly clearAlpha: number;
  readonly clearColor: THREE.Color;
  readonly renderTarget: THREE.RenderTarget | null;
  readonly scissor: THREE.Vector4;
  readonly scissorTest: boolean;
  readonly viewport: THREE.Vector4;
}

/** Run an offscreen render without publishing renderer state into the host's next live frame. */
export async function withRendererStateRestored<T>(
  renderer: PersistentRenderSceneRenderer,
  operation: () => Promise<T> | T,
): Promise<T> {
  const snapshot = captureRendererState(renderer);
  try {
    return await operation();
  } finally {
    restoreRendererState(renderer, snapshot);
  }
}

function captureRendererState(renderer: PersistentRenderSceneRenderer): RendererStateSnapshot {
  return {
    activeCubeFace: renderer.getActiveCubeFace(),
    activeMipmapLevel: renderer.getActiveMipmapLevel(),
    clearAlpha: renderer.getClearAlpha(),
    clearColor: renderer.getClearColor(new THREE.Color()),
    renderTarget: renderer.getRenderTarget(),
    scissor: renderer.getScissor(new THREE.Vector4()),
    scissorTest: renderer.getScissorTest(),
    viewport: renderer.getViewport(new THREE.Vector4()),
  };
}

function restoreRendererState(renderer: PersistentRenderSceneRenderer, snapshot: RendererStateSnapshot): void {
  renderer.setRenderTarget(snapshot.renderTarget, snapshot.activeCubeFace, snapshot.activeMipmapLevel);
  renderer.setClearColor(snapshot.clearColor, snapshot.clearAlpha);
  renderer.setViewport(snapshot.viewport);
  renderer.setScissor(snapshot.scissor);
  renderer.setScissorTest(snapshot.scissorTest);
}
