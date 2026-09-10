/** A card stays inside the short edge of the gallery's default 16:9 crop while it arcs. */
export const CARD_WIDTH = 3.45;
export const CARD_HEIGHT = 4.6;
export const CARD_DEPTH = 0.11;
export const CARD_RADIUS = 0.14;
export const CARD_SEGMENTS = 8;
export const CARD_TEXT_Z = CARD_DEPTH / 2 + 0.008;
export const CORNER_X = 1.42;
export const CORNER_Y = 1.82;

export const TOP_Z = 0.12;
export const BOTTOM_Z = -0.09;
export const FLIP_SECONDS = 0.9;
export const AUTO_CYCLE_SECONDS = 2.8;
export const TILT_DAMPING = 7;
export const TILT_X = 0.16;
export const TILT_Y = 0.2;

export interface CardFace {
  readonly rank: 'A' | 'K';
  readonly suit: 'STAR' | 'MOON';
  readonly ink: string;
  readonly pips: readonly PipPosition[];
}

export interface PipPosition {
  readonly x: number;
  readonly y: number;
  /** Turns the asterisk upside down for the lower half of a traditional card layout. */
  readonly inverted?: boolean;
}

const PIP_COLUMNS = [-0.72, 0, 0.72] as const;

/** The two fronts never change identity; cycling only moves the two reusable physical cards. */
export const CARD_FACES: readonly CardFace[] = [
  {
    rank: 'A',
    suit: 'STAR',
    ink: '#9c3d48',
    pips: [
      { x: 0, y: 0.62 },
      { x: 0, y: 0 },
      { x: 0, y: -0.62, inverted: true },
    ],
  },
  {
    rank: 'K',
    suit: 'MOON',
    ink: '#294f8d',
    pips: [
      { x: PIP_COLUMNS[0], y: 0.84 },
      { x: PIP_COLUMNS[2], y: 0.84 },
      { x: 0, y: 0.35 },
      { x: PIP_COLUMNS[0], y: -0.5, inverted: true },
      { x: PIP_COLUMNS[2], y: -0.5, inverted: true },
      { x: 0, y: -0.98, inverted: true },
    ],
  },
];

export interface CycleState {
  top: 0 | 1;
  queued: number;
  flipping: boolean;
  progress: number;
}

export interface CardTransform {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

export function createCycleState(): CycleState {
  return { top: 0, queued: 0, flipping: false, progress: 0 };
}

/** Bound queued taps without changing the indefinitely repeatable cycle itself. */
export function queueFlip(state: CycleState): void {
  state.queued = Math.min(state.queued + 1, 8);
}

/** Advance one deterministic flip state machine; callers own its clock and rendering. */
export function stepCycle(state: CycleState, delta: number): void {
  if (!state.flipping && state.queued > 0) {
    state.queued -= 1;
    state.flipping = true;
  }
  if (!state.flipping) return;

  state.progress = Math.min(1, state.progress + Math.max(delta, 0) / FLIP_SECONDS);
  if (state.progress < 1) return;

  state.top = state.top === 0 ? 1 : 0;
  state.progress = 0;
  state.flipping = false;
}

/** Smooth the path without allocating a per-frame vector or transform record. */
export function writeCardTransform(out: CardTransform, card: 0 | 1, top: 0 | 1, progress: number | undefined): void {
  if (card !== top || progress === undefined) {
    out.x = 0;
    out.y = 0;
    out.z = card === top ? TOP_Z : BOTTOM_Z;
    out.rotationY = 0;
    return;
  }

  const eased = smoothstep(progress);
  const arc = Math.sin(progress * Math.PI);
  out.x = arc * 0.46;
  out.y = arc * 0.42;
  // Negative Z is away from the stage camera: the active card visibly travels behind the stack.
  out.z = TOP_Z + (BOTTOM_Z - TOP_Z) * eased - arc * 0.32;
  out.rotationY = progress * Math.PI * 2;
}

/** A frame-rate-independent one-pole damping step for the gallery pointer target. */
export function damp(current: number, target: number, lambda: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(delta, 0)));
}

function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
