export const PRESENTATION_SCENES = [
  { durationMs: 7_000, workload: 'off-axis-3d' },
  { durationMs: 8_000, workload: 'icon-grid' },
  { durationMs: 7_000, workload: 'paint-effects' },
  { durationMs: 10_000, workload: 'advanced-shaping' },
  { durationMs: 7_000, workload: 'zoom-text' },
  { durationMs: 7_000, workload: 'text-ladder' },
  { durationMs: 7_000, workload: 'dynamic-layout' },
  { durationMs: 7_000, workload: 'paragraph-stress' },
] as const;

export type PresentationWorkload = (typeof PRESENTATION_SCENES)[number]['workload'];

export interface PresentationFrame {
  readonly complete: boolean;
  readonly elapsedInSceneMs: number;
  readonly workload: PresentationWorkload;
}

export function adjacentPresentationWorkload(workload: string, direction: -1 | 1): PresentationWorkload {
  const currentIndex = PRESENTATION_SCENES.findIndex((scene) => scene.workload === workload);
  const fallbackIndex = direction === 1 ? 0 : PRESENTATION_SCENES.length - 1;
  const nextIndex = currentIndex === -1 ? fallbackIndex : clampIndex(currentIndex + direction);
  return PRESENTATION_SCENES[nextIndex]!.workload;
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
      return { complete: false, elapsedInSceneMs: remainingMs, workload: scene.workload };
    }
    remainingMs -= scene.durationMs;
  }
  const finalScene = PRESENTATION_SCENES[PRESENTATION_SCENES.length - 1]!;
  return { complete: true, elapsedInSceneMs: finalScene.durationMs, workload: finalScene.workload };
}

function clampIndex(index: number): number {
  return Math.max(0, Math.min(index, PRESENTATION_SCENES.length - 1));
}
