/** Synchronous host phases surrounding one retained Rust text update. */
export type ThreeTextProfilePhase =
  | 'frame.total'
  | 'frame.prepare'
  | 'engine.update'
  | 'plan.apply'
  | 'semantic.read'
  | 'transforms.sync';

/** Receives one completed phase whose timestamps share the `performance.now()` origin. */
export type ThreeTextProfiler = (phase: ThreeTextProfilePhase, startedMs: number, endedMs: number) => void;

let activeProfiler: ThreeTextProfiler | undefined;

/** Installs optional process-wide diagnostics. Passing `undefined` restores the allocation-free inactive path. */
export function setThreeTextProfiler(profiler: ThreeTextProfiler | undefined): void {
  activeProfiler = profiler;
}

/** Creates Chrome/Node User Timing entries without requiring paired named marks. */
export function threeTextUserTimingProfiler(prefix = '@pmndrs/text'): ThreeTextProfiler {
  return (phase, startedMs, endedMs) => {
    performance.measure(`${prefix} ${phase}`, { start: startedMs, duration: endedMs - startedMs });
  };
}

export function textProfileBegin(): number {
  return activeProfiler === undefined ? 0 : performance.now();
}

export function textProfileEnd(phase: ThreeTextProfilePhase, startedMs: number): void {
  if (activeProfiler !== undefined) activeProfiler(phase, startedMs, performance.now());
}
