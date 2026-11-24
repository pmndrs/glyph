import type { Text } from '@pmndrs/glyph/three';
import { trait } from 'koota';
import type { Object3D } from 'three/webgpu';

/**
 * The caret: one bar of light, wherever text is being set. Page units, the bar's top and height. `field` is the
 * text it edits, or -1 while it only stands somewhere, as it does in the headline.
 */
export const Caret = trait({
  shown: true,
  x: 0,
  y: 0,
  height: 1,
  /** The caret's other place at a boundary between directions, or NaN when it has only one. */
  secondX: Number.NaN,
  secondY: 0,
  field: -1,
  offset: 0,
  affinity: 'downstream' as 'upstream' | 'downstream',
  /** When it last moved, on the playback clock: a caret that just moved does not blink. */
  movedAt: 0,
  /** The last edit, for the ripple: where on the page, how tall its line, and when. */
  editX: 0,
  editY: 0,
  editHeight: 1,
  editAt: -100,
});

/** What the editor has been asked to do, in order. The view answers them against the laid-out text. */
export type EditorRequest =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'place'; field: number; offset: number }
  | { kind: 'insert'; text: string }
  | { kind: 'delete' }
  | { kind: 'erase'; field: number; start: number; end: number }
  | { kind: 'move'; direction: 'left' | 'right' | 'up' | 'down' };

/** Text waiting to be typed a character at a time, and when the next one lands. */
export const Typist = trait({
  requests: (): EditorRequest[] => [],
  pending: '',
  nextAt: 0,
  /** What `typeText` has typed, into which field and from which offset, so exactly that can be taken out again. */
  typed: 0,
  typedField: -1,
  typedAt: 0,
});

/** A text the caret may enter: where it sits on the page and how far it reaches. */
export interface Field {
  text: Text<never>;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface EditorDraw {
  fields: (Field | undefined)[];
  bar: Object3D;
  second: Object3D;
  uniforms: typeof import('./materials').editorUniforms;
}

export const EditorView = trait((): EditorDraw | undefined => undefined);

/** The body is field 0. The sidebar's specimens follow. */
export const BODY_FIELD = 0;
