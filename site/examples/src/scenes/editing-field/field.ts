import type { LayoutBox, TextPosition, msdf } from '@pmndrs/glyph';
import type { Text } from '@pmndrs/glyph/three';

/**
 * The state of an editable field and every way it changes. The text answers geometry and applies one exact
 * edit; the selection is two positions the application owns. Every function here is one or two calls on the
 * text, in Text-local coordinates (+X right, +Y down).
 */
export type Field = Text<typeof msdf>;

export interface Selection {
  /** Where the selection started; equal to `focus` when nothing is selected. */
  readonly anchor: TextPosition;
  /** Where the caret is. */
  readonly focus: TextPosition;
  /** The column vertical movement keeps; cleared by every other change. */
  readonly goalX: number | undefined;
}

export function collapsed(position: TextPosition): Selection {
  return { anchor: position, focus: position, goalX: undefined };
}

/** The selection as an ordered range: `rangeRects` and `replace` refuse a reversed one. */
export function ordered(selection: Selection): readonly [start: number, end: number] {
  const { anchor, focus } = selection;
  return [Math.min(anchor.offset, focus.offset), Math.max(anchor.offset, focus.offset)];
}

/** A press: the caret stop nearest a Text-local point. */
export function press(text: Field, point: { readonly x: number; readonly y: number }): Selection {
  return collapsed(text.hitTest(point));
}

/** A drag: the anchor stays, the focus follows the pointer. */
export function drag(text: Field, selection: Selection, point: { readonly x: number; readonly y: number }): Selection {
  return { anchor: selection.anchor, focus: text.hitTest(point), goalX: undefined };
}

/** A double click: the word that contains the position. */
export function selectWord(text: Field, position: TextPosition): Selection {
  const word = text.boundary(position, 'word');
  return {
    anchor: { offset: word.start, affinity: 'downstream' },
    focus: { offset: word.end, affinity: 'upstream' },
    goalX: undefined,
  };
}

/** Replaces the selection with `insert` and leaves the caret after it. */
export function type(text: Field, selection: Selection, insert: string): Selection {
  const [start, end] = ordered(selection);
  text.replace(start, end, insert);
  // The caret belongs to what was just typed: at a soft wrap it stays at the end of the line it typed on.
  return collapsed({ offset: start + insert.length, affinity: 'upstream' });
}

/** Deletes the selection, or one grapheme before (`backward`) or after (`forward`) the caret. */
export function erase(text: Field, selection: Selection, direction: 'backward' | 'forward'): Selection {
  const [start, end] = ordered(selection);
  if (start !== end) return type(text, selection, '');
  const other = text.move(selection.focus, direction, 'grapheme').position.offset;
  // At the start or the end of the text there is nothing to delete.
  if (other === start) return selection;
  return type(text, { ...selection, anchor: { offset: other, affinity: 'downstream' } }, '');
}

/** One key. Returns the selection unchanged for a key the field does not handle. */
export function pressKey(text: Field, selection: Selection, key: string): Selection {
  const [start, end] = ordered(selection);
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowRight': {
      const direction = key === 'ArrowLeft' ? 'left' : 'right';
      // With a selection, the arrow collapses it to that end; this is left-to-right text.
      if (start !== end) return collapsed({ offset: direction === 'left' ? start : end, affinity: 'downstream' });
      return collapsed(text.move(selection.focus, direction, 'grapheme').position);
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const moved = text.move(selection.focus, key === 'ArrowUp' ? 'up' : 'down', 'line', selection.goalX);
      return { anchor: moved.position, focus: moved.position, goalX: moved.goalX };
    }
    case 'Home':
      return collapsed(text.move(selection.focus, 'backward', 'line').position);
    case 'End':
      return collapsed(text.move(selection.focus, 'forward', 'line').position);
    case 'Backspace':
      return erase(text, selection, 'backward');
    case 'Delete':
      return erase(text, selection, 'forward');
    case 'Enter':
      return type(text, selection, '\n');
    default:
      // The checked-in Inter subset draws Basic Latin; a real field accepts any single grapheme.
      return key.length === 1 && key >= ' ' && key <= '~' ? type(text, selection, key) : selection;
  }
}

export interface FieldGeometry {
  readonly caret: LayoutBox;
  readonly rects: readonly LayoutBox[];
}

/** What to draw for a selection. Each query prepares the text first, so this is the edited layout. */
export function geometry(text: Field, selection: Selection): FieldGeometry {
  const [start, end] = ordered(selection);
  return {
    caret: text.caret(selection.focus).rect,
    rects: start === end ? [] : text.rangeRects(start, end),
  };
}
