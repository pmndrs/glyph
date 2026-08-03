import { ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS } from '../workloads/advanced-shaping';

export const TEXT_LADDER_PRESENTATION_DURATION_MS = 7_200;
// Three complete 3.5-second base cycles at the default 1.125× animation rate, rounded up to the next millisecond.
export const ZOOM_TEXT_PRESENTATION_DURATION_MS = 9_334;

export const PRESENTATION_SCENES = [
  { durationMs: 2_000, workload: 'off-axis-3d' },
  { durationMs: 2_000, workload: 'icon-grid' },
  { durationMs: 4_000, workload: 'paint-effects' },
  { durationMs: ADVANCED_SHAPING_PRESENTATION_CYCLE_DURATION_MS, workload: 'advanced-shaping' },
  { durationMs: ZOOM_TEXT_PRESENTATION_DURATION_MS, workload: 'zoom-text' },
  { durationMs: TEXT_LADDER_PRESENTATION_DURATION_MS, workload: 'text-ladder' },
  { durationMs: 9_000, preset: 'icon-grid-return', workload: 'icon-grid' },
  { durationMs: 6_000, workload: 'dynamic-layout' },
  { durationMs: 6_000, workload: 'paragraph-stress' },
  { durationMs: 8_016, workload: 'off-axis-3d' },
] as const;

export type PresentationWorkload = (typeof PRESENTATION_SCENES)[number]['workload'];
export type PresentationPreset = 'icon-grid-return';

const PRESENTATION_WORKLOADS = [
  ...new Set<PresentationWorkload>(PRESENTATION_SCENES.map(({ workload }) => workload)),
] as const;

export interface PresentationFrame {
  readonly complete: boolean;
  readonly elapsedInSceneMs: number;
  readonly preset?: PresentationPreset;
  readonly workload: PresentationWorkload;
}

export function adjacentPresentationWorkload(workload: string, direction: -1 | 1): PresentationWorkload {
  const currentIndex = PRESENTATION_WORKLOADS.findIndex((candidate) => candidate === workload);
  const fallbackIndex = direction === 1 ? 0 : PRESENTATION_WORKLOADS.length - 1;
  const nextIndex = currentIndex === -1 ? fallbackIndex : clampIndex(currentIndex + direction);
  return PRESENTATION_WORKLOADS[nextIndex]!;
}

export function presentationFrame(startWorkload: string, elapsedMs: number): PresentationFrame {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('presentation elapsed time must be finite and nonnegative');
  }
  const resolvedStartIndex = PRESENTATION_SCENES.findIndex((scene) => scene.workload === startWorkload);
  const startIndex = resolvedStartIndex === -1 ? 0 : resolvedStartIndex;
  let remainingMs = elapsedMs;
  for (let index = startIndex; index < PRESENTATION_SCENES.length; index += 1) {
    const scene = PRESENTATION_SCENES[index]!;
    if (remainingMs < scene.durationMs) {
      return {
        complete: false,
        elapsedInSceneMs: remainingMs,
        ...('preset' in scene ? { preset: scene.preset } : {}),
        workload: scene.workload,
      };
    }
    remainingMs -= scene.durationMs;
  }
  const finalScene = PRESENTATION_SCENES[PRESENTATION_SCENES.length - 1]!;
  return { complete: true, elapsedInSceneMs: finalScene.durationMs, workload: finalScene.workload };
}

function clampIndex(index: number): number {
  return Math.max(0, Math.min(index, PRESENTATION_WORKLOADS.length - 1));
}
