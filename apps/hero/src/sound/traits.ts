import { trait } from 'koota';
import type { HoleState } from '../black-hole/traits';
import type { ModeKind } from '../director/traits';
import { COUNT } from '../rain/content';

/** The baked voices played once per cue. */
export type OneShot =
  | 'doo'
  | 'speech'
  | 'chime'
  | 'sparkle'
  | 'thud'
  | 'tick'
  | 'tap'
  | 'whoosh'
  | 'blip'
  | 'gulp'
  | 'boom';
/** The baked voices that run for as long as the mixer does, at a level the scene sets. */
export type Loop = 'motor' | 'drone';

/**
 * One sound: its voice, its place from -1 left to 1 right, its playback rate and level, its delay in seconds, and
 * which take of a voice recorded in several, as the robot's syllables are.
 */
export interface SoundCue {
  voice: OneShot;
  pan: number;
  rate: number;
  gain: number;
  delay: number;
  take: number;
}

/** What the listener last heard, so each change in the scene sounds once. */
export interface Heard {
  lifting: boolean;
  typed: number;
  printed: number;
  /** How many syllables the robot has said, so each greeting goes on where the last left off. */
  spoken: number;
  trips: number;
  /** The robot's floor position last frame, while it was on the floor. */
  x: number;
  y: number;
  rolling: boolean;
  /** Which drop each rain slot last rang for, so a glyph rings once however often it strikes. */
  rang: Float64Array;
  beat: HoleState['beat'];
  fedAt: number;
  /** The embers' age last frame, negative before they burst. */
  embers: number;
  mode: ModeKind;
  modeSince: number;
  revealed: boolean;
  over: boolean;
}

export const Sound = trait({
  muted: false,
  /** The robot's motor and the hole's drone: how loud each runs, 0..1, and where it sits across the stereo field. */
  motor: 0,
  motorPan: 0,
  drone: 0,
  dronePan: 0,
  /** 0..1: how far the hole's drones have climbed, as it grows in play and through the finale to the pop. */
  rise: 0,
  /** This frame's cues, a fixed buffer and count that the mounted mixer drains. */
  queue: () => ({
    count: 0,
    cues: Array.from({ length: 32 }, (): SoundCue => ({ voice: 'tick', pan: 0, rate: 1, gain: 0, delay: 0, take: 0 })),
  }),
  heard: (): Heard => ({
    lifting: false,
    typed: 0,
    printed: 0,
    spoken: 0,
    trips: 0,
    x: 0,
    y: 0,
    rolling: false,
    rang: new Float64Array(COUNT).fill(-1),
    beat: 'closed',
    fedAt: Number.NEGATIVE_INFINITY,
    embers: -1,
    mode: 'sequence',
    modeSince: 0,
    revealed: false,
    over: false,
  }),
});

/** A continuous voice: its looping source, and the level and place the scene sets on it. */
export interface LoopDraw {
  source: AudioBufferSourceNode;
  level: GainNode;
  pan: StereoPannerNode;
}

/**
 * The mounted mixer. One-shots enter at `input`, and at `reverb` and `expanse` for their share of the room and of the
 * void, whose echo and space only the embers' sparkle reaches. `clean` and `crushed` split the mix between its plain
 * path and a bit-crushed one, and `tone` darkens it.
 */
export interface SoundDraw {
  context: AudioContext;
  /** Each voice's takes: one for most, one a syllable for the robot's speech, and two sprays of the embers' sparkle. */
  samples: Readonly<Record<OneShot | Loop, readonly AudioBuffer[]>>;
  input: AudioNode;
  reverb: AudioNode;
  expanse: AudioNode;
  clean: GainNode;
  crushed: GainNode;
  tone: BiquadFilterNode;
  master: GainNode;
  motor: LoopDraw;
  drone: LoopDraw;
  /** The drone an octave up, which joins it as it climbs. */
  overtone: LoopDraw;
}

export const SoundView = trait((): SoundDraw | undefined => undefined);
