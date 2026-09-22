import type { Beat } from '../utils';

/** One take, in seconds. The robot rolls in, delivers its line, remembers the rest of it, and bolts. */
export const TAKE_SECONDS = 16.6;

/** Seconds the take rests off frame before the next one begins. */
export const RESET_SECONDS = 0.9;

/**
 * Arc length along the travel line, measured from the mark. The entry and the exit are placed by the frame's
 * width at run time, so `-1` and `1` here stand for just outside it on either side.
 *
 * It arrives in a hurry: it charges the whole way in, skids a little past the mark and backs onto it, because it
 * cannot wait to say what it came to say. The beat after the greeting is the whole joke: it drives away, brakes
 * to a stop a body-length on, and waits there while it works out what it forgot.
 */
export const TRAVEL: readonly Beat[] = [
  { at: 0, to: -1, ease: 'hold' },
  { at: 0.75, to: -0.28, ease: 'drive' },
  { at: 1.2, to: 0.05, ease: 'brake' },
  { at: 1.55, to: 0, ease: 'swing' },
  { at: 8.4, to: 0, ease: 'hold' },
  { at: 9.3, to: 0.13, ease: 'swing' },
  { at: 14.2, to: 0.13, ease: 'hold' },
  { at: TAKE_SECONDS, to: 1, ease: 'drive' },
];

/**
 * 0 while it watches where it is going, 1 while its face is turned to the lens. Past 1 it has turned further than
 * the lens, which is what gives each turn its whip: it goes by the mark and comes back to it. The turn away after
 * the greeting is unhurried; the turn back is a snap, because it has just remembered, and it waits a beat first.
 */
export const LOOK: readonly Beat[] = [
  { at: 0, to: 0, ease: 'hold' },
  { at: 1.35, to: 0, ease: 'hold' },
  { at: 1.9, to: 1.14, ease: 'swing' },
  { at: 2.15, to: 1, ease: 'swing' },
  { at: 8.1, to: 1, ease: 'hold' },
  { at: 8.6, to: 0, ease: 'swing' },
  { at: 10, to: 0, ease: 'hold' },
  { at: 10.35, to: 1.22, ease: 'swing' },
  { at: 10.6, to: 1, ease: 'swing' },
  { at: 14.2, to: 1, ease: 'hold' },
  { at: 14.6, to: 0, ease: 'swing' },
];

/** Where in the take the robot's braking and pulling away hit the floor, and how hard each one lands. */
export const SHOCKS: readonly { readonly at: number; readonly force: number }[] = [
  { at: 1.3, force: 1 },
  { at: 9.3, force: 0.55 },
  { at: 14.2, force: 0.85 },
];

/** How far the head cranes up to meet a lens that is above it, at a full look. */
export const HEAD_TILT = 0.28;
/** How far the body rocks back onto its wheels as it turns to the camera. */
export const BODY_LEAN = 0.16;
/**
 * Radians of pitch per unit of acceleration along the travel line, and as far as it ever goes. The lean is taken
 * from the travel track itself, so the robot tips into every charge and rocks back out of every brake without the
 * script having to say so twice.
 *
 * A track can change its acceleration between one beat and the next, but a body cannot change its pitch in a
 * frame, so the lean chases the track over `LEAN_SECONDS` rather than reading it raw. Without that it snaps the
 * full range in a single frame where a charge gives way to a brake, which reads as the rig popping.
 */
export const RUSH_LEAN = 0.013;
export const RUSH_LIMIT = 0.34;
export const LEAN_SECONDS = 0.18;

/** One screenful, and the span of the take it holds the display for. */
export interface Card {
  readonly text: string;
  readonly from: number;
  readonly until: number;
  /** Set where the screenful should beat where it stands once it has finished printing. */
  readonly beating?: boolean;
}

/**
 * What the robot says, a screen at a time. The display is one line wide, so the message is cut into screenfuls
 * that each print and then hold, which is what lets them be read at the size they are.
 *
 * The first three are the greeting. The last two are what it came back to say, and the sign-off escalates the
 * usual `<3` the way people do when one is not enough.
 */
export const CARDS: readonly Card[] = [
  { text: 'R3F 9.8.0 +', from: 2.1, until: 3.9 },
  { text: 'React 19.3.0', from: 3.9, until: 5.7 },
  { text: '=== <3', from: 5.7, until: 7.4 },
  { text: '+ Glyph', from: 10.8, until: 12.3 },
  { text: '<3 <33 <333', from: 12.3, until: 14.1, beating: true },
];

/** Which screenfuls belong to each half of the take, for anything that reasons about the two messages. */
export const GREETING = CARDS.slice(0, 3);
export const POSTSCRIPT = CARDS.slice(3);

/** Characters a second on the face's own printer. */
export const PRINT_RATE = 13;

/** Seconds the eyes are shut, and when in the take they shut: once it has finished saying the first part. */
export const BLINKS: readonly number[] = [7.56, 7.82];
export const BLINK_SECONDS = 0.11;

/** Where the display lives in the head joint. Text up follows +x, text right follows +z, its normal follows +y. */
export const FACE_CENTER: readonly [number, number, number] = [10.96, 8.6, 0.49];
/**
 * The display panel, the margin the type keeps either side of it, and the type that fills what is left. The size
 * is chosen for the widest screenful above, and `cameo:take-check` measures every one of them against the margin
 * through the real shaper, so a longer line cannot quietly run off the panel.
 */
export const FACE_WIDTH = 1.66;
export const FACE_PADDING = 0.12;
export const FACE_FONT_SIZE = 0.18;
/** Letter spacing is a distance, not a fraction of the size, so the two are chosen together. */
export const FACE_LETTER_SPACING = 0.03;
/** Rig units to world units for the model as it is mounted. */
export const RIG_SCALE = 3 / 2.85;
/** The display's finish under the printed pixels. */
export const FACE_FINISH = { roughness: 0.35, metalness: 0.6 } as const;

/** Along the heading, across it, and up. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];

/** Retained glyph dust kicked up behind the wheels. */
export const DUST_COUNT = 96;
export const DUST_BASE_Z = 0.1;
export const DUST_RISE = 0.9;
