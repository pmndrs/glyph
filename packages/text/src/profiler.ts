/**
 * Phase attribution for the layout hot path.
 *
 * Paragraph preparation and positioning are one synchronous call from the outside, so a frame that misses its budget
 * says nothing about which phase spent it. A sampling profiler answers that for a recorded window; this answers it for
 * every update, in the running application, with the numbers a harness can average.
 *
 * Nothing is recorded until an application installs a profiler, and an installed profiler receives the raw span rather
 * than an aggregate so a consumer can total it, forward it to the User Timing timeline, or both.
 */

/** A phase of paragraph preparation, layout, or instance packing. Nested phases report separately. */
export type TextProfilePhase =
  | 'prepare'
  | 'prepare.unicode'
  | 'prepare.styles'
  | 'prepare.bidi'
  | 'prepare.runs'
  | 'prepare.shape'
  | 'prepare.ellipses'
  | 'prepare.clusters'
  | 'prepare.cluster-index'
  | 'layout.line-break'
  | 'layout.measure'
  | 'layout.positioning'
  | 'layout.position'
  | 'batch.pack';

/** Receives one completed phase span. Both timestamps share the `performance.now()` origin. */
export type TextProfiler = (phase: TextProfilePhase, startedMs: number, endedMs: number) => void;

let active: TextProfiler | undefined;

/**
 * Installs the profiler that receives every subsequent phase span, or `undefined` to stop recording. While no profiler
 * is installed the instrumentation costs one comparison per phase and allocates nothing.
 */
export function setTextProfiler(profiler: TextProfiler | undefined): void {
  active = profiler;
}

/**
 * Records phase spans as User Timing measures, which a browser profile, the DevTools performance timeline, and Node's
 * `PerformanceObserver` all read without further instrumentation.
 */
export function userTimingProfiler(prefix = '@pmndrs/text'): TextProfiler {
  return (phase, startedMs, endedMs) => {
    performance.measure(`${prefix} ${phase}`, { start: startedMs, duration: endedMs - startedMs });
  };
}

/** Returns the start timestamp a matching {@link profileEnd} needs, or `0` while nothing is recording. */
export function profileBegin(): number {
  return active === undefined ? 0 : performance.now();
}

/** Reports one phase span to the installed profiler. Pass the value {@link profileBegin} returned. */
export function profileEnd(phase: TextProfilePhase, startedMs: number): void {
  if (active !== undefined) active(phase, startedMs, performance.now());
}
