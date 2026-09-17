export type ConformanceWorkloadId =
  | 'mtsdf-slug-compare'
  | 'runtime-fallback'
  | 'text-accuracy'
  | 'cross-technique-fidelity';

export interface WorkloadScrollEdges {
  readonly before: boolean;
  readonly after: boolean;
}

export function workloadScrollEdges({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}): WorkloadScrollEdges {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  return {
    before: scrollTop > 0.5,
    after: scrollTop < maximumScrollTop - 0.5,
  };
}
