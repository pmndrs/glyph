import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import type { PersistentRenderSceneRenderer } from './persistent-render-host';
import { withRendererStateRestored } from './renderer-state-transaction';

describe('renderer state transaction', () => {
  it('restores host render state after a successful offscreen operation', async () => {
    const { renderer, state } = rendererFixture();

    await withRendererStateRestored(renderer, () => {
      renderer.setRenderTarget(new THREE.RenderTarget(8, 8), 0, 0);
      renderer.setClearColor(0xffffff, 1);
      renderer.setViewport(9, 10, 11, 12);
      renderer.setScissor(13, 14, 15, 16);
      renderer.setScissorTest(false);
    });

    expect(state()).toMatchObject({
      activeCubeFace: 4,
      activeMipmapLevel: 3,
      clearAlpha: 0.25,
      scissorTest: true,
    });
    expect(state().renderTarget).toBe(hostTarget);
    expect(state().clearColor.getHex()).toBe(0x123456);
    expect(state().viewport.toArray()).toEqual([1, 2, 3, 4]);
    expect(state().scissor.toArray()).toEqual([5, 6, 7, 8]);
  });

  it('restores host render state when the offscreen operation fails', async () => {
    const { renderer, state } = rendererFixture();
    const failure = new Error('readback failed');

    await expect(
      withRendererStateRestored(renderer, () => {
        renderer.setRenderTarget(new THREE.RenderTarget(8, 8));
        renderer.setClearColor(0xffffff, 1);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(state().renderTarget).toBe(hostTarget);
    expect(state().clearColor.getHex()).toBe(0x123456);
    expect(state().clearAlpha).toBe(0.25);
  });

  it('restores every host render-state field when an offscreen operation aborts', async () => {
    const { renderer, state } = rendererFixture();
    const controller = new AbortController();
    const failure = new DOMException('capture cancelled', 'AbortError');
    controller.abort(failure);

    await expect(
      withRendererStateRestored(renderer, () => {
        renderer.setRenderTarget(new THREE.RenderTarget(8, 8), 0, 0);
        renderer.setClearColor(0xffffff, 1);
        renderer.setViewport(9, 10, 11, 12);
        renderer.setScissor(13, 14, 15, 16);
        renderer.setScissorTest(false);
        controller.signal.throwIfAborted();
      }),
    ).rejects.toBe(failure);

    expect(state()).toMatchObject({
      activeCubeFace: 4,
      activeMipmapLevel: 3,
      clearAlpha: 0.25,
      scissorTest: true,
    });
    expect(state().renderTarget).toBe(hostTarget);
    expect(state().clearColor.getHex()).toBe(0x123456);
    expect(state().viewport.toArray()).toEqual([1, 2, 3, 4]);
    expect(state().scissor.toArray()).toEqual([5, 6, 7, 8]);
  });

  it('does not require renderer lifecycle methods at its boundary', async () => {
    const { renderer } = rendererFixture();

    await withRendererStateRestored(renderer, () => undefined);

    expect('setSize' in renderer).toBe(false);
    expect('setPixelRatio' in renderer).toBe(false);
    expect('setAnimationLoop' in renderer).toBe(false);
    expect('dispose' in renderer).toBe(false);
  });
});

const hostTarget = new THREE.RenderTarget(4, 4);

function rendererFixture(): {
  readonly renderer: PersistentRenderSceneRenderer;
  readonly state: () => RendererFixtureState;
} {
  const value: RendererFixtureState = {
    activeCubeFace: 4,
    activeMipmapLevel: 3,
    clearAlpha: 0.25,
    clearColor: new THREE.Color(0x123456),
    renderTarget: hostTarget,
    scissor: new THREE.Vector4(5, 6, 7, 8),
    scissorTest: true,
    viewport: new THREE.Vector4(1, 2, 3, 4),
  };
  const renderer = {
    getActiveCubeFace: () => value.activeCubeFace,
    getActiveMipmapLevel: () => value.activeMipmapLevel,
    getClearAlpha: () => value.clearAlpha,
    getClearColor: (target: THREE.Color) => target.copy(value.clearColor),
    getRenderTarget: () => value.renderTarget,
    getScissor: (target: THREE.Vector4) => target.copy(value.scissor),
    getScissorTest: () => value.scissorTest,
    getViewport: (target: THREE.Vector4) => target.copy(value.viewport),
    setClearColor: (color: THREE.ColorRepresentation, alpha = 1) => {
      value.clearColor.set(color);
      value.clearAlpha = alpha;
    },
    setRenderTarget: (target: THREE.RenderTarget | null, face = 0, mip = 0) => {
      value.renderTarget = target;
      value.activeCubeFace = face;
      value.activeMipmapLevel = mip;
    },
    setScissor: (scissor: THREE.Vector4) => value.scissor.copy(scissor),
    setScissorTest: (enabled: boolean) => {
      value.scissorTest = enabled;
    },
    setViewport: (viewport: THREE.Vector4) => value.viewport.copy(viewport),
  } as unknown as PersistentRenderSceneRenderer;
  return { renderer, state: () => value };
}

interface RendererFixtureState {
  activeCubeFace: number;
  activeMipmapLevel: number;
  clearAlpha: number;
  clearColor: THREE.Color;
  renderTarget: THREE.RenderTarget | null;
  scissor: THREE.Vector4;
  scissorTest: boolean;
  viewport: THREE.Vector4;
}
