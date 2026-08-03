import { createWorld, trait, type Trait, type TraitRecord, type World } from 'koota';
import { useTrait, useWorld } from 'koota/react';

import type { BitmapTextLiveStats } from '../renderer/bitmap-text';
import type { MtsdfTextLiveStats } from '../renderer/mtsdf-text';
import type { SlugTextLiveStats } from '../renderer/slug-text';
import type { CanvasViewController } from '../renderer/canvas-view-controller';
import { benchmarkWorkloadDefinition, isBenchmarkWorkloadId } from '../workloads/catalog';
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
  return runtimeDefaultsForWorkload(workload, layout).fontSize;
}

export function defaultRuntimeLayoutWidthPercentForWorkload(workload: string): number {
  return runtimeDefaultsForWorkload(workload, 'main').layoutWidthPercent;
}

export function defaultRuntimeWorkloadAmountForWorkload(workload: string): number {
  return runtimeDefaultsForWorkload(workload, 'main').workloadAmount;
}

export function resetRuntimeControlsForWorkload(world: World, workload: string, layout: HarnessLayout): void {
  const defaults = runtimeDefaultsForWorkload(workload, layout);
  world.set(RuntimeViewControls, {
    showGrid: defaults.showGrid,
    showLayoutBounds: defaults.showLayoutBounds,
  });
  world.set(RuntimeLayoutControls, {
    fontSize: defaults.fontSize,
    layoutWidthPercent: defaults.layoutWidthPercent,
    workloadAmount: defaults.workloadAmount,
  });
  world.set(RuntimeAnimationControls, {
    animationEnabled: defaults.animationEnabled,
    animationSpeed: defaults.animationSpeed,
  });
  world.set(RuntimePaintControls, {
    paintOpacityPercent: defaults.paintOpacityPercent,
    paintShadowEnabled: defaults.paintShadowEnabled,
    paintStrokePercent: defaults.paintStrokePercent,
  });
}

function runtimeDefaultsForWorkload(workload: string, layout: HarnessLayout) {
  const workloadId = isBenchmarkWorkloadId(workload) ? workload : 'benchmark-ipsum';
  return benchmarkWorkloadDefinition(workloadId).defaults[layout];
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
