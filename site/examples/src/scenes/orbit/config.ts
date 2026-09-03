/** The body the rings orbit; the frame is eleven units wide. */
export const SPHERE = { radius: 1.45, position: [0, 0.25, 0] as const } as const;

/**
 * Two rings of Slug glyphs, each on a circle around the sphere, tumbling
 * gently like gimbals on an armillary sphere — `tilt` is each ring's base
 * angle off horizontal, pitched in opposite directions so the two ellipses
 * cross each other and the sphere rather than sitting as two nested ovals
 * of the same orientation. `spin` is `[wobble, turn]`: `wobble` is how fast
 * the tilt breathes around its base, `turn` how fast the ring comes around.
 * `speed` is the marquee — how fast the letters themselves travel the
 * circle, which is what reads most as motion; both rings run it the same
 * way round at different rates, off a different `phase`, so they move
 * together without reading as one linked assembly. `text` is a clause rather
 * than a whole passage, and `size` is set so a couple of copies come close to
 * filling the circle: the nearer the copies land to it on their own, the less
 * `ringFit` has to ask of the word spaces.
 */
export const RINGS = [
  {
    radius: SPHERE.radius + 0.75,
    size: 0.22,
    speed: -0.35,
    tilt: Math.PI / 12,
    spin: [0.11, -0.07] as const,
    phase: 0,
    text: 'HOPE IS THE THING WITH FEATHERS THAT PERCHES IN THE SOUL',
  },
  {
    radius: SPHERE.radius + 0.95,
    size: 0.2,
    speed: -0.24,
    tilt: -Math.PI / 11,
    /** Slower than the inner ring's and a little shallower, so the pair never swing as one. */
    spin: [-0.05, -0.11] as const,
    wobble: 0.1,
    phase: 2.1,
    text: 'I CELEBRATE MYSELF, AND SING MYSELF, AND WHAT I ASSUME YOU SHALL ASSUME',
  },
] as const;
/** Radians a second the body turns on its own axis; slow enough to read as drift, not spin. */
export const SPHERE_SPIN = 0.035;
/** Radians either side of a ring's base `tilt` when it does not name its own; gentle, not a swing. */
export const RING_WOBBLE = 0.12;
/**
 * The theme's accent, lifted a little toward paper. The body is greyscale, so the warmth is what
 * separates the type from it — pulled much further back than this and the letters just read as
 * another shade of the belts they cross. Lightening it rather than desaturating keeps the gold
 * while holding the contrast a whole ring of small type needs.
 */
export const RING_INK = '#ffdf9c';
/**
 * Tight — negative tracking, letters nearly touching. The shaper's kerning
 * is what holds them apart, and justification opens the word spaces rather
 * than these, so closing the tracking never runs the glyphs together.
 */
export const RING_LETTER_SPACING = -0.008;

/**
 * Two fixed lights, only the key casting. The key sits close to the camera
 * axis (mostly +z) so the sphere reads all but fully lit — its own
 * terminator is a thin crescent, leaving the most surface for the rings'
 * shadows to fall on — but offset in x and y, or the shadows would hide
 * directly behind the letters that cast them. Height matters: a ring's
 * glyphs stand on the circle facing outward, so a light high above grazes
 * past those faces edge-on and casts nothing, however bright. The fill
 * models the far side and does not cast — a second caster would relight
 * what the key's shadow darkens, and the letters would wash out.
 */
export const LIGHTS = [
  { position: [2.5, 2, 6] as const, color: '#f4f7ff', intensity: 2.4, castShadow: true },
  { position: [-4.5, 2, 3] as const, color: '#dfe6f5', intensity: 1.4, castShadow: false },
] as const;

/** One repetition of a ring's phrase, with the dot and the spaces that hold it off both sides. */
export function ringLine(ring: (typeof RINGS)[number]): string {
  return `${ring.text.toUpperCase()} · `;
}

/** About how wide a word space is at this size; Inter's is close to a quarter em. */
function spaceWidth(size: number): number {
  return size * 0.26;
}

/**
 * One copy's arc: what the paragraph measured for a single line, plus the
 * trailing space it trimmed off the end the way any line end trims it. That
 * space is real here — it is what holds the phrase off its own head — so it
 * has to be added back before the copies are counted.
 */
export function ringPitch(measured: number, size: number): number {
  return measured + spaceWidth(size);
}

/**
 * How many copies of the phrase to set, and what every word space in them has
 * to give or take for the ring to close exactly.
 *
 * Flooring the count would always leave the spaces carrying the remainder as
 * air — up to a whole phrase of it, which is the gap you see at the seam. So
 * the counts either side of the ideal are tried too, and the one asking least
 * of the spacing wins, whether that means opening the spaces a little or
 * closing them. A count that would need a space to give back more than it has
 * is skipped: that is where words start touching.
 */
export function ringFit(
  circumference: number,
  pitch: number,
  spacesPerCopy: number,
  size: number,
): { repeats: number; extra: number } {
  if (!(pitch > 0) || spacesPerCopy < 1) return { repeats: 1, extra: 0 };
  const space = spaceWidth(size);
  // How far a space may be pushed either way: most of itself back, or half again as wide. The
  // growth bound matters as much as the shrink one — without it a single sparse copy, its spaces
  // opened to bursting, would win on the arithmetic over the denser count that actually reads.
  const shrink = space * 0.8;
  const grow = space * 1.5;
  const ideal = circumference / pitch;
  let best: { repeats: number; extra: number; cost: number } | undefined;
  let nearest = { repeats: 1, extra: 0, cost: Number.POSITIVE_INFINITY };
  for (let repeats = Math.max(1, Math.floor(ideal) - 1); repeats <= Math.ceil(ideal) + 1; repeats += 1) {
    const extra = (circumference - pitch * repeats) / (spacesPerCopy * repeats);
    const cost = Math.abs(extra);
    if (cost < nearest.cost) nearest = { repeats, extra, cost };
    if (extra < -shrink || extra > grow) continue;
    if (best === undefined || cost < best.cost) best = { repeats, extra, cost };
  }
  const chosen = best ?? nearest;
  return { repeats: chosen.repeats, extra: chosen.extra };
}

/**
 * Justification, done at placement rather than in the box: a running count of
 * the word spaces before each source index, and the arc each one has to grow
 * by for the copies to close the circle exactly.
 *
 * The engine's own `align: 'justify'` wants a box to justify into, and a ring
 * has no box — its line is placed by arc, and `wrap: 'none'` lets an
 * overlong line run straight past the seam and onto its own head. Spreading
 * the shortfall over the word spaces here is the same arithmetic justify
 * does, with the circle as the measure. Only the spaces grow: every glyph
 * keeps the advance the shaper gave it, kerning and all.
 */
export function ringSpacing(text: string): Int32Array {
  const spacesBefore = new Int32Array(text.length + 1);
  for (let index = 0; index < text.length; index += 1) {
    spacesBefore[index + 1] = (spacesBefore[index] ?? 0) + (text[index] === ' ' ? 1 : 0);
  }
  return spacesBefore;
}

/** How many word spaces one copy of the phrase carries; what `ringFit` spreads the difference over. */
export function ringSpaces(line: string): number {
  let spaces = 0;
  for (const character of line) if (character === ' ') spaces += 1;
  return spaces;
}
