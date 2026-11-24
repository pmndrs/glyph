import type { World } from 'koota';
import { pageActions } from '../page/actions';
import { BodyView, Spread } from '../page/traits';
import { BODY_ORIGIN, pageToWorldX, pageToWorldY } from '../page/utils';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { BODY_FIELD, Caret, EditorView, Typist, type EditorDraw, type Field } from './traits';

/** Hand the typist's pending text to the editor a character at a time. */
export function typePending(world: World): void {
  const typist = world.get(Typist)!;
  const { elapsed } = world.get(Time)!;

  if (typist.pending.length === 0 || elapsed < typist.nextAt) return;

  const [character = ''] = typist.pending;
  const caret = world.get(Caret)!;

  if (caret.field < 0) return;

  typist.requests.push({ kind: 'insert', text: character });
  world.set(Typist, {
    // The first character marks where the run began.
    ...(typist.typed === 0 ? { typedField: caret.field, typedAt: caret.offset } : {}),
    typed: typist.typed + character.length,
    pending: typist.pending.slice(character.length),
    nextAt: elapsed + 0.06 + 0.09 * jitter(typist.pending.length * 3) + (character === ' ' ? 0.07 : 0),
  });
}

/**
 * Answer what the editor was asked, against the laid-out text. A click is a hit test in the field under it, an
 * insert or a delete is one exact replacement at the caret, and a move asks the engine for the next stop, so the
 * caret never stands anywhere the layout would not put it. The caret's rectangle comes back from the same engine
 * call, with its second place where two directions meet.
 */
export function resolveEditor(world: World): void {
  const view = world.get(EditorView);
  const typist = world.get(Typist)!;

  if (view === undefined || typist.requests.length === 0) return;

  const { elapsed } = world.get(Time)!;
  let { field, offset, affinity } = world.get(Caret)!;
  let edited = false;

  for (const request of typist.requests) {
    if (request.kind === 'click') {
      field = fieldAt(view, request.x, request.y, world.get(Spread)!.width);

      if (field < 0) continue;

      const target = view.fields[field]!;
      ({ offset, affinity } = target.text.hitTest({ x: request.x - target.originX, y: request.y - target.originY }));
      continue;
    }

    if (request.kind === 'place') {
      if (view.fields[request.field] === undefined) continue;

      field = request.field;
      offset = Math.min(request.offset, view.fields[field]!.text.text.length);
      affinity = 'downstream';
      continue;
    }

    if (request.kind === 'erase') {
      const erased = view.fields[request.field];

      if (erased === undefined) continue;

      erased.text.replace(request.start, Math.min(request.end, erased.text.text.length), '');

      if (request.field === BODY_FIELD) touchBody(world);

      if (request.field === field) field = -1;

      continue;
    }

    const target = view.fields[field];

    if (target === undefined) continue;

    if (request.kind === 'move') {
      ({ offset, affinity } = target.text.move({ offset, affinity }, request.direction, 'grapheme').position);
      continue;
    }

    if (request.kind === 'insert') {
      target.text.replace(offset, offset, request.text);
      offset += request.text.length;
    } else {
      const start = target.text.move({ offset, affinity }, 'backward', 'grapheme').position.offset;

      if (start === offset) continue;

      target.text.replace(start, offset, '');
      offset = start;
    }

    affinity = 'upstream';
    edited = true;

    if (field === BODY_FIELD) touchBody(world);
  }

  typist.requests.length = 0;
  const target = view.fields[field];

  if (target === undefined) {
    if (world.get(Caret)!.field >= 0) world.set(Caret, { field: -1, shown: false });

    return;
  }

  const caret = target.text.caret({ offset, affinity });
  const x = target.originX + caret.rect.x;
  const y = target.originY + caret.rect.y;
  world.set(Caret, {
    shown: true,
    field,
    offset,
    affinity,
    x,
    y,
    height: caret.rect.height,
    secondX: caret.secondary === undefined ? Number.NaN : target.originX + caret.secondary.x,
    secondY: caret.secondary === undefined ? 0 : target.originY + caret.secondary.y,
    movedAt: elapsed,
    ...(edited ? { editX: x, editY: y, editHeight: caret.rect.height, editAt: elapsed } : {}),
  });
}

/** The letters were split from the body's text as it was. They are redrawn from it when they are next needed. */
function touchBody(world: World): void {
  pageActions(world).markScriptStale();
  const body = world.get(BodyView);

  if (body !== undefined) body.layoutDirty = true;
}

/** The field under a point of the page, or -1. The body reaches only as wide as it is now set. */
function fieldAt(view: EditorDraw, x: number, y: number, bodyWidth: number): number {
  for (const [index, field] of view.fields.entries()) {
    if (field === undefined) continue;

    const width = index === BODY_FIELD ? bodyWidth : field.width;

    if (inside(field, x, y, width)) return index;
  }

  return -1;
}

function inside(field: Field, x: number, y: number, width: number): boolean {
  return (
    x >= field.originX - 0.3 &&
    x <= field.originX + width + 0.3 &&
    y >= field.originY &&
    y <= field.originY + field.height
  );
}

/** Draw the caret where it stands, blinking once it has rested, and hand the shaders its light and the ripple. */
export function syncEditorView(world: World): void {
  const view = world.get(EditorView);

  if (view === undefined) return;

  const caret = world.get(Caret)!;
  const { elapsed } = world.get(Time)!;
  const rested = elapsed - caret.movedAt;
  // On for the first half second after a move, then a slow blink that never goes fully dark.
  const blink = rested < 0.5 ? 1 : 0.5 + 0.5 * Math.cos((rested - 0.5) * Math.PI * 1.9);
  const lit = caret.shown ? 0.12 + 0.88 * blink * blink : 0;
  const width = Math.max(0.035, caret.height * 0.045);
  view.bar.visible = caret.shown;
  view.bar.position.set(pageToWorldX(caret.x), pageToWorldY(caret.y + caret.height / 2), 0.03);
  view.bar.scale.set(width, caret.height, 1);
  view.second.visible = caret.shown && !Number.isNaN(caret.secondX);
  view.second.position.set(pageToWorldX(caret.secondX), pageToWorldY(caret.secondY + caret.height / 2), 0.03);
  view.second.scale.set(width * 0.7, caret.height, 1);
  view.uniforms.uCaret.value.set(pageToWorldX(caret.x), pageToWorldY(caret.y + caret.height / 2), caret.height);
  view.uniforms.uCaretLit.value = lit;
  // The ripple is told in the body's own paragraph space and in the world's, for whichever text it runs through.
  view.uniforms.uEdit.value.set(pageToWorldX(caret.editX), pageToWorldY(caret.editY + caret.editHeight / 2));
  view.uniforms.uEditParagraph.value.set(
    caret.editX - BODY_ORIGIN.x,
    caret.editY + caret.editHeight / 2 - BODY_ORIGIN.y,
  );
  view.uniforms.uEditHeight.value = caret.editHeight;
  view.uniforms.uEditAge.value = elapsed - caret.editAt;
}
