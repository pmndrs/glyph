import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import { createCanvasGridPositions, createCanvasSurface } from './canvas-surface';

describe('canvas surface grid', () => {
  it('builds fixed one-CSS-pixel grid quads at the sixteen-pixel design rhythm', () => {
    const positions = createCanvasGridPositions(32, 32);
    expect(positions).toHaveLength(4 * 6 * 3);
    expect(Array.from(positions.slice(0, 18))).toEqual([
      15, 0, 0, 15, -32, 0, 16, 0, 0, 15, -32, 0, 16, -32, 0, 16, 0, 0,
    ]);
  });

  it('rejects invalid viewport dimensions before allocating geometry', () => {
    expect(() => createCanvasGridPositions(0, 32)).toThrow(RangeError);
    expect(() => createCanvasGridPositions(32, Number.NaN)).toThrow(RangeError);
  });

  it('does not submit an empty grid mesh while a one-pixel surface is waiting for layout', () => {
    const renderer = {
      autoClear: true,
      clear: vi.fn<(...args: unknown[]) => void>(),
      clearDepth: vi.fn<(...args: unknown[]) => void>(),
      render: vi.fn<(...args: unknown[]) => void>(),
      setClearColor: vi.fn<(...args: unknown[]) => void>(),
      setRenderTarget: vi.fn<(...args: unknown[]) => void>(),
    } as unknown as THREE.WebGPURenderer;
    const surface = createCanvasSurface(renderer, 1, 1, true);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();

    surface.render(scene, camera);

    expect(renderer.render).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
    surface.dispose();
  });
});
