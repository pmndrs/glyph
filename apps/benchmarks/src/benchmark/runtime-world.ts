import { createWorld, trait, type Trait, type TraitRecord, type World } from 'koota';
import { useTrait, useWorld } from 'koota/react';

import type { BitmapTextLiveStats } from '../renderer/bitmap-text';
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text';
import type { SlugTextLiveStats } from '../renderer/slug-text';
import type { CanvasViewController } from '../renderer/canvas-view-controller';
import type { HarnessLayout } from './url-state';

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
  paintShadowEnabled: false,
  paintStrokePercent: 0,
});

export const RuntimeTelemetry = trait(() => ({ stats: undefined as RuntimeLiveStats | undefined }));

export const RuntimeCanvasSettings = trait(() => ({
  controller: undefined as CanvasViewController | undefined,
  label: 'Text rendering canvas',
  panEnabled: false,
  zoomEnabled: false,
}));

export interface RuntimeWorldOptions {
  readonly initialFontSize?: number;
  readonly initialLayoutWidthPercent?: number;
  readonly initialWorkloadAmount?: number;
}

export function defaultRuntimeFontSizeForWorkload(workload: string, layout: HarnessLayout = 'main'): number {
  if (workload === 'off-axis-3d') return 96;
  if (layout === 'presentation') {
    switch (workload) {
      case 'advanced-shaping':
        return 48;
      case 'icon-grid':
        return 64;
      case 'paint-effects':
        return 52;
      case 'dynamic-layout':
        return 32;
      default:
        return 24;
    }
  }
  switch (workload) {
    case 'icon-grid':
      return 56;
    case 'paint-effects':
      return 44;
    case 'dynamic-layout':
      return 28;
    default:
      return 20;
  }
}

export function defaultRuntimeLayoutWidthPercentForWorkload(workload: string): number {
  return workload === 'off-axis-3d' ? 120 : 82;
}

export function defaultRuntimeWorkloadAmountForWorkload(workload: string): number {
  return workload === 'off-axis-3d' || workload === 'paragraph-stress' ? 100 : 50;
}

export function resetRuntimeControlsForWorkload(world: World, workload: string, layout: HarnessLayout): void {
  world.set(RuntimeViewControls, { showGrid: true, showLayoutBounds: true });
  world.set(RuntimeLayoutControls, {
    fontSize: defaultRuntimeFontSizeForWorkload(workload, layout),
    layoutWidthPercent: defaultRuntimeLayoutWidthPercentForWorkload(workload),
    workloadAmount: defaultRuntimeWorkloadAmountForWorkload(workload),
  });
  world.set(RuntimeAnimationControls, { animationEnabled: true, animationSpeed: 50 });
  world.set(RuntimePaintControls, {
    paintOpacityPercent: 100,
    paintShadowEnabled: false,
    paintStrokePercent: 0,
  });
}

export function createRuntimeWorld({
  initialFontSize = 16,
  initialLayoutWidthPercent = 82,
  initialWorkloadAmount = 50,
}: RuntimeWorldOptions = {}): World {
  return createWorld(
    RuntimeViewControls,
    RuntimeLayoutControls({
      fontSize: initialFontSize,
      layoutWidthPercent: initialLayoutWidthPercent,
      workloadAmount: initialWorkloadAmount,
    }),
    RuntimeAnimationControls,
    RuntimePaintControls,
    RuntimeCanvasSettings,
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
