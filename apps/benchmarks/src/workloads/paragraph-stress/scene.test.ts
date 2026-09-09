import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import type { ComparisonWorkloadAnimationScratch } from '../comparison/contracts';
import type { ComparisonWorkloadEntry } from '../shared/scene-entry';
import { animateParagraphStressScene } from './scene';

function paragraphStressEntry(): {
  readonly entry: ComparisonWorkloadEntry;
  readonly set: ReturnType<typeof vi.fn>;
} {
  const state = {
    constraints: { width: { mode: 'exact' as const, size: 700 } },
    style: { fontSize: 48 },
  };
  const set = vi.fn<(update: { constraints?: typeof state.constraints; style?: typeof state.style }) => void>(
    (update) => {
      if (update.constraints !== undefined) state.constraints = update.constraints;
      if (update.style !== undefined) state.style = update.style;
    },
  );
  const text = {
    get constraints() {
      return state.constraints;
    },
    get style() {
      return state.style;
    },
    error: undefined,
    measure: vi.fn<() => { height: number; width: number }>(() => ({
      height: 1_200,
      width: state.constraints.width.size,
    })),
    position: new THREE.Vector3(),
    set,
  } as unknown as ComparisonWorkloadEntry['text'];
  return {
    entry: { node: text, role: 'primary', sourceText: '', text, lastWidth: 700 },
    set,
  };
}

describe('paragraph stress animation', () => {
  it('applies automated width changes inside the scene without restaging an unchanged frame', () => {
    const scene = new THREE.Scene();
    const updateMatrixWorld = vi.spyOn(scene, 'updateMatrixWorld');
    const { entry, set } = paragraphStressEntry();
    const frame: ComparisonWorkloadAnimationScratch['paragraphStress'] = {
      fontSize: 0,
      layoutWidthPercent: 0,
      scrollProgress: 0,
    };
    const onError = vi.fn<(error: unknown) => void>();
    const onReflow = vi.fn<(duration: number) => void>();
    const configuration = {
      animationEnabled: true,
      animationSpeed: 50,
      fontSize: 48,
      layoutWidthRatio: 0.7,
    };

    animateParagraphStressScene(scene, [entry], configuration, 0, 1_000, 800, frame, onError, onReflow);
    animateParagraphStressScene(scene, [entry], configuration, 0, 1_000, 800, frame, onError, onReflow);

    expect(set).toHaveBeenCalledTimes(1);
    expect(updateMatrixWorld).toHaveBeenCalledTimes(1);
    expect(onReflow).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
