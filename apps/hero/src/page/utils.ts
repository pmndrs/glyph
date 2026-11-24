import type { GlyphOutlineContour, TextFlow, TextFlowExclusion, TextFlowPoint } from '@pmndrs/glyph';
import { BODY_BOX, GUTTER, PAGE, PULL_BOX } from './content';

/** A box in body-local units: x right and y down from the body's upper-left corner, as the paragraph measures. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A measure narrower than this sets no words, so a column that thin is left out of the flow. */
const MIN_MEASURE = 1.4;

/**
 * The column boxes for a real-valued column count. The whole columns share one measure and the fraction is a last,
 * narrower column that grows out of the right edge, its gutter opening with it, so a count sliding from three to
 * two or to four moves every gutter continuously and the boxes always span the width. Returns how many boxes were
 * written into `out`.
 */
export function columnBoxes(out: Box[], columns: number, width: number, height: number, gutter = GUTTER): number {
  const whole = Math.max(1, Math.floor(columns + 1e-6));
  const part = Math.max(0, columns - whole);
  const partGutter = gutter * Math.min(1, part * 4);
  const measure = (width - (whole - 1) * gutter - partGutter) / (whole + part);
  let count = 0;

  for (let index = 0; index < whole; index++) {
    const left = index * (measure + gutter);
    write(out, count++, left, left + measure, height);
  }

  if (part * measure >= MIN_MEASURE) write(out, count++, width - part * measure, width, height);

  return count;
}

function write(out: Box[], index: number, left: number, right: number, height: number): void {
  const box = (out[index] ??= { left: 0, top: 0, right: 0, bottom: 0 });
  box.left = left;
  box.right = right;
  box.top = 0;
  box.bottom = height;
}

/**
 * The pull quote's box: as wide as one column's measure and centred on the body, so it sits in the middle column
 * of three and straddles the gutter of two or four, and as tall as the quote set at that measure.
 */
export function pullBox(out: Box, width: number, height: number, measure: number, quoteHeight: number): Box {
  out.left = PULL_BOX.centerX * width - measure / 2;
  out.right = PULL_BOX.centerX * width + measure / 2;
  out.top = PULL_BOX.top * height;
  out.bottom = out.top + quoteHeight + PULL_BOX.padding * 2;

  return out;
}

/** A disc the text keeps clear of, in body-local units. */
export interface Disc {
  x: number;
  y: number;
  radius: number;
}

/**
 * The flow the body is set in: one region a column, each excluding the pull quote and the disc where they reach
 * it. Keys are stable, so a moved disc restates one exclusion and a slid gutter restates the regions it touches.
 */
export function bodyFlow(
  boxes: readonly Box[],
  count: number,
  pull: Box | undefined,
  disc: Disc | undefined,
  sides: number,
): TextFlow {
  const regions = [];

  for (let index = 0; index < count; index++) {
    const box = boxes[index]!;
    const exclusions: TextFlowExclusion[] = [];

    if (pull !== undefined && pull.left < box.right && pull.right > box.left) {
      exclusions.push({
        key: `pull-${index}`,
        shape: { kind: 'rectangle', bounds: [pull.left, pull.top, pull.right, pull.bottom] },
        marginInline: 0.34,
        marginBlock: 0.12,
      });
    }

    if (disc !== undefined && disc.x - disc.radius < box.right && disc.x + disc.radius > box.left) {
      const vertices: TextFlowPoint[] = [];

      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        vertices.push([disc.x + Math.cos(angle) * disc.radius, disc.y + Math.sin(angle) * disc.radius]);
      }

      exclusions.push({ key: `stone-${index}`, shape: { kind: 'polygon', vertices }, wrapSide: 'both' });
    }

    regions.push({
      key: `column-${index}`,
      shape: { kind: 'rectangle', bounds: [box.left, box.top, box.right, box.bottom] },
      exclusions,
    } as const);
  }

  return { regions };
}

/** Page units to world: the page is centred on the origin, facing +z, with y up. */
export function pageToWorldX(x: number): number {
  return x - PAGE.width / 2;
}

export function pageToWorldY(y: number): number {
  return PAGE.height / 2 - y;
}

/** The body's own origin on the page: body-local units add this. */
export const BODY_ORIGIN = { x: BODY_BOX.left, y: BODY_BOX.top } as const;
export const BODY_HEIGHT = BODY_BOX.bottom - BODY_BOX.top;
export const BODY_WIDTH = BODY_BOX.right - BODY_BOX.left;
/** The body may be dragged this narrow and this wide. */
export const BODY_WIDTH_RANGE = { min: 15, max: BODY_WIDTH } as const;

/** What a letter is doing. A resting letter is where the layout put it and costs nothing. */
export const REST = 0;
export const SPRING = 1;
/** Driven by its rigid body. */
export const BODY = 2;
/** Inside the stone, drawn at nothing. */
export const SWALLOWED = 3;
/** Being given back: carried home to wherever the layout now wants it. */
export const RETURNING = 4;

/**
 * Every drawable letter of the body, by its dense index in the detached glyphs. Positions are pen origins in
 * body-local units. `cluster` is the letter's offset in the text the glyphs were split from, which is its identity
 * for as long as those glyphs are drawn: the layout may move it, an edit may take it out of the text and put it
 * back, and it is still this letter.
 */
export function createLetters(count: number) {
  return {
    count,
    cluster: new Uint32Array(count),
    state: new Uint8Array(count),
    /** Set for one view pass when a letter comes to rest, so its final place is written once. */
    flush: new Uint8Array(count),
    x: new Float32Array(count),
    y: new Float32Array(count),
    vx: new Float32Array(count),
    vy: new Float32Array(count),
    targetX: new Float32Array(count),
    targetY: new Float32Array(count),
    angle: new Float32Array(count),
    scale: new Float32Array(count).fill(1),
    /** The ink box's centre from the pen origin: what a letter turns and shrinks about. */
    pivotX: new Float32Array(count),
    pivotY: new Float32Array(count),
    fontSize: new Float32Array(count),
    /** Each letter's own spring rate, so a line does not move as one. */
    stiffness: new Float32Array(count),
    /** When a returning letter may start, on the playback clock. */
    startAt: new Float32Array(count),
    /** Which outline each letter is: equal keys are equal shapes, so their colliders are shared. */
    shape: new Uint32Array(count),
    /** A letter's outline, as closed contours of quadratics in em units with y down. Supplied by whoever split them. */
    outlineAt: (_index: number): readonly GlyphOutlineContour[] => [],
    /** How many letters are not at rest. */
    moving: 0,
  };
}

export type Letters = ReturnType<typeof createLetters>;

/**
 * The text the letters were split from, and what has been taken out of it since. `removed` flags offsets of the
 * original; the engine's text is the original without them, and `edits` are the exact replacements that keep it so,
 * waiting for the view to state them.
 */
export function createManuscript(original: string) {
  return {
    original,
    removed: new Uint8Array(original.length),
    removedCount: 0,
    edits: [] as { start: number; end: number; insert: string }[],
    /** Bumps whenever `removed` changes. */
    revision: 0,
    /** The visitor typed into the text, so the detached letters no longer describe it. */
    stale: false,
  };
}

export type Manuscript = ReturnType<typeof createManuscript>;

/** Where an offset of the original now sits in the engine's text: what has been removed before it no longer counts. */
export function currentOffset(manuscript: Manuscript, original: number): number {
  let before = 0;

  for (let index = 0; index < original; index++) before += manuscript.removed[index]!;

  return original - before;
}

/** The engine's text: the original without what has been removed. */
export function currentText(manuscript: Manuscript): string {
  if (manuscript.removedCount === 0) return manuscript.original;

  let text = '';

  for (let index = 0; index < manuscript.original.length; index++) {
    if (manuscript.removed[index] === 0) text += manuscript.original[index];
  }

  return text;
}

/** For each offset of the engine's text, the offset of the original it came from, written into `out`. */
export function originalOffsets(out: Uint32Array, manuscript: Manuscript): Uint32Array {
  let current = 0;

  for (let index = 0; index < manuscript.original.length; index++) {
    if (manuscript.removed[index] === 0) out[current++] = index;
  }

  return out;
}
