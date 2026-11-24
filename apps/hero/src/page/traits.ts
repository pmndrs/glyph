import type { Glyphs, Text } from '@pmndrs/glyph/three';
import { trait } from 'koota';
import type { Matrix4 } from 'three/webgpu';
import { COLUMN_RANGE } from './content';
import { BODY_WIDTH, createLetters, createManuscript, type Box } from './utils';

/** The spread's live geometry and light. */
export const Spread = trait({
  /** The column count as drawn: a real number while a gutter is in motion. */
  columns: COLUMN_RANGE.initial as number,
  columnsTarget: COLUMN_RANGE.initial as number,
  columnsVelocity: 0,
  /** The body's width in page units, which the page's right edge drags. */
  width: BODY_WIDTH,
  widthTarget: BODY_WIDTH,
  widthVelocity: 0,
  /** A hand holds the gutters or the edge, so they follow it exactly and do not spring. */
  held: false,
  /** 0..1: the room's light on the page. At nothing only the caret lights it. */
  light: 0,
  lightTarget: 0,
  /** 0..1: how much of the body's ink has arrived, top to bottom. */
  ink: 0,
  inkTarget: 0,
  /** Bumps whenever the columns or the width moved, so the view restates the flow. */
  geometry: 0,
  /**
   * `detached` draws every letter as its own glyph riding a spring between layouts; `direct` draws the paragraph
   * as the engine publishes it, which is what editing and the lite tier use.
   */
  mode: 'detached' as 'detached' | 'direct',
  /** The last reflow's cost on the CPU, in milliseconds, and the lines it set. */
  reflowMs: 0,
  lines: 0,
});

export const Letterpress = trait(() => createLetters(0));
export const Script = trait(() => createManuscript(''));

/** The body's mounted resources. */
export interface BodyDraw {
  text: Text<never>;
  /** The pull quote, which is set at one column's measure and whose height the body's flow steps around. */
  quote: Text<never>;
  quoteMeasure: number;
  quoteHeight: number;
  /** The paragraph broken into letters, or undefined until it has been split. */
  glyphs: Glyphs | undefined;
  matrix: Matrix4;
  boxes: Box[];
  boxCount: number;
  /** What the flow was last stated for. */
  statedGeometry: number;
  statedStone: number;
  /** The flow or the text changed, so the layout must be read again. */
  layoutDirty: boolean;
  originals: Uint32Array;
  originalsRevision: number;
  /** First detached letter of each original offset, or -1. */
  byCluster: Int32Array;
  uniforms: typeof import('./materials').pageUniforms;
}

/** The drop cap: the body's first letter, which the camera dives through. Page units, the ink box's centre. */
export const DropCap = trait({ x: 0, y: 0, size: 1 });

export const BodyView = trait((): BodyDraw | undefined => undefined);
