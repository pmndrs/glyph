import { createActions } from 'koota';
import { Time } from '../time/traits';
import { Caret, EditorView, Typist, type EditorDraw, type Field } from './traits';

export const editorActions = createActions((world) => ({
  /** Stand the caret somewhere without a text under it. */
  standCaret: (x: number, y: number, height: number) => {
    world.set(Caret, {
      shown: true,
      x,
      y,
      height,
      secondX: Number.NaN,
      field: -1,
      movedAt: world.get(Time)!.elapsed,
    });
  },
  hideCaret: () => {
    world.set(Caret, { shown: false, field: -1 });
  },
  /** A press on the page: the caret goes to the nearest place in whatever text is under it. */
  clickPage: (x: number, y: number) => {
    world.get(Typist)!.requests.push({ kind: 'click', x, y });
  },
  placeCaret: (field: number, offset: number) => {
    world.get(Typist)!.requests.push({ kind: 'place', field, offset });
  },
  insertText: (text: string) => {
    world.get(Typist)!.requests.push({ kind: 'insert', text });
  },
  deleteBackward: () => {
    world.get(Typist)!.requests.push({ kind: 'delete' });
  },
  moveCaret: (direction: 'left' | 'right' | 'up' | 'down') => {
    world.get(Typist)!.requests.push({ kind: 'move', direction });
  },
  /** Type `text` at the caret a character at a time, at a hand's cadence. */
  typeText: (text: string) => {
    const typist = world.get(Typist)!;
    world.set(Typist, { pending: typist.pending + text, nextAt: world.get(Time)!.elapsed });
  },
  /** Take out exactly what `typeText` typed, wherever the caret is now. */
  eraseTyped: () => {
    const typist = world.get(Typist)!;

    if (typist.typed > 0) {
      typist.requests.push({
        kind: 'erase',
        field: typist.typedField,
        start: typist.typedAt,
        end: typist.typedAt + typist.typed,
      });
    }

    world.set(Typist, { pending: '', typed: 0, typedField: -1 });
  },
  mountEditorView: (view: EditorDraw) => {
    world.set(EditorView, view);
  },
  unmountEditorView: () => {
    world.set(EditorView, undefined);
  },
  registerField: (index: number, field: Field | undefined) => {
    const view = world.get(EditorView);

    if (view !== undefined) view.fields[index] = field;
  },
}));
