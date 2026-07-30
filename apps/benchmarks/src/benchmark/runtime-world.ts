import { createWorld, trait, type Trait, type TraitRecord, type World } from 'koota';
import { useTrait, useWorld } from 'koota/react';

import type { BitmapTextLiveStats } from '../renderer/bitmap-text';
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text';
import type { SlugTextLiveStats } from '../renderer/slug-text';

export type RuntimeLiveStats = BitmapTextLiveStats | MtsdfTextLiveStats | SlugTextLiveStats;

export const RuntimeViewControls = trait({
  showGrid: true,
  showLayoutBounds: true,
});

export const RuntimeLayoutControls = trait({
  fontSize: 16,
  layoutWidthPercent: 82,
  workloadAmount: 50,
});

export const RuntimeAnimationControls = trait({
  animationEnabled: true,
  animationSpeed: 50,
});

export const RuntimePaintControls = trait({
  paintOpacityPercent: 100,
  paintShadowEnabled: true,
  paintStrokePercent: 50,
});

export const RuntimeTelemetry = trait(() => ({ stats: undefined as RuntimeLiveStats | undefined }));

export interface RuntimeWorldOptions {
  readonly initialFontSize?: number;
}

export function defaultRuntimeFontSizeForWorkload(workload: string): number {
  switch (workload) {
    case 'icon-grid':
      return 48;
    case 'off-axis-3d':
      return 64;
    case 'paint-effects':
      return 40;
    case 'dynamic-layout':
      return 24;
    default:
      return 16;
  }
}

export function createRuntimeWorld({ initialFontSize = 16 }: RuntimeWorldOptions = {}): World {
  return createWorld(
    RuntimeViewControls,
    RuntimeLayoutControls({ fontSize: initialFontSize }),
    RuntimeAnimationControls,
    RuntimePaintControls,
    RuntimeTelemetry,
  );
}

export function useRuntimeWorld(): World {
  return useWorld();
}

function useRequiredWorldTrait<T extends Trait>(world: World, runtimeTrait: T): TraitRecord<T> {
  const value = useTrait(world, runtimeTrait);
  if (value === undefined) throw new Error('Runtime world is missing a required control trait.');
  return value;
}

export function useRuntimeViewControls() {
  const world = useRuntimeWorld();
  return useRequiredWorldTrait(world, RuntimeViewControls);
}

export function useRuntimeLayoutControls() {
  const world = useRuntimeWorld();
  return useRequiredWorldTrait(world, RuntimeLayoutControls);
}

export function useRuntimeAnimationControls() {
  const world = useRuntimeWorld();
  return useRequiredWorldTrait(world, RuntimeAnimationControls);
}

export function useRuntimePaintControls() {
  const world = useRuntimeWorld();
  return useRequiredWorldTrait(world, RuntimePaintControls);
}

export function useRuntimeTelemetry() {
  const world = useRuntimeWorld();
  return useRequiredWorldTrait(world, RuntimeTelemetry);
}
