import { STEP_SECONDS } from './glyph-physics-world';

/**
 * Most fixed steps one rendered frame may run. A step that costs a good part of the frame budget would otherwise make
 * each late frame owe more steps than the last, so the frame gets later still. Two steps absorb ordinary jitter at 60 Hz.
 */
export const MAX_STEPS_PER_FRAME = 2;
/** Largest wall-clock gap one frame may feed the simulation, in milliseconds. */
export const MAX_FRAME_MS = 100;

/**
 * Turns wall-clock frame gaps into whole fixed steps. The step is always `STEP_SECONDS`, so a run is a pure function of
 * its step count; only how much simulated time passes per wall-clock second changes under load. When a frame owes more
 * than `MAX_STEPS_PER_FRAME`, the time it could not run is discarded, not carried: the simulation slows down instead of
 * spiralling.
 */
export class FrameStepper {
  #pending = 0;

  /** Simulated milliseconds accumulated and not yet stepped; always below one step after `advance`. */
  get pendingMs(): number {
    return this.#pending;
  }

  /** Runs `step` for the whole steps this frame's `elapsedMs` (times `speed`) owes, at most the cap, and returns how many. */
  advance(elapsedMs: number, speed: number, step: () => void): number {
    const stepMs = STEP_SECONDS * 1000;
    this.#pending += Math.min(MAX_FRAME_MS, Math.max(0, elapsedMs)) * speed;
    let steps = 0;
    while (this.#pending >= stepMs && steps < MAX_STEPS_PER_FRAME) {
      this.#pending -= stepMs;
      step();
      steps += 1;
    }
    if (this.#pending >= stepMs) this.#pending = 0;
    return steps;
  }
}
