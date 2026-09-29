import { assert } from '@pmndrs/labs';

import { createLabels, disposeLabels, font } from './fixture.ts';

// Compare application flows that need fresh layout in scenes with 100 or 1,000 labels.
// A deferred artifact publishes during a frame. A synchronous artifact publishes on the read.
// Deferred artifacts batch per-object reads because each read needs a completed frame.
// Timings include scene traversal but exclude GPU work.
export type Label = ReturnType<typeof createLabels>['labels'][number];
export type LabelScene = Pick<ReturnType<typeof createLabels>, 'root' | 'scene' | 'textGroup'>;

export const layoutReadsPublish = probeLayoutReadsPublish();

/** Untimed capability probe: does a layout read publish a pending paragraph without a frame? */
function probeLayoutReadsPublish(): boolean {
  const probe = createLabels(1);
  try {
    const label = probe.labels[0]!;
    label.text = 'WWWWWWWWWWWW';
    label.measureGlyphs();
    return label.commitState().status === 'committed';
  } finally {
    disposeLabels(probe);
  }
}

/** Glyph's share of `renderer.render(scene)`: the scene traversal that publishes pending layout. */
export function renderFrame({ scene, textGroup }: LabelScene): void {
  scene.updateMatrixWorld();
  if (textGroup.error !== undefined) throw textGroup.error;
}

/** A deferred caller's wait: render the frame that publishes, then confirm it did before reading. */
function renderUntilPublished(scene: LabelScene, texts: readonly Label[]): void {
  renderFrame(scene);
  for (const text of texts) {
    if (text.commitState().status !== 'committed') throw new Error('deferred layout was not published by one frame');
  }
}

/** Rejects a read that answered for the text before the latest write. */
export function requireFresh(actual: number, expected: number): number {
  if (actual !== expected) {
    throw new Error(`layout read answered for stale text (${String(actual)}, not ${String(expected)})`);
  }
  return actual;
}

/**
 * Writes each object and then reads it, either all writes before the reads or each object in turn, and renders the
 * result. Returns the sum of the reads.
 */
export function updateThenRead(
  scene: LabelScene,
  objects: readonly Label[],
  write: (object: Label, index: number) => void,
  read: (object: Label) => number,
  eachInTurn: boolean,
): number {
  let total = 0;
  if (layoutReadsPublish && eachInTurn) {
    for (const [index, object] of objects.entries()) {
      write(object, index);
      total += read(object);
    }
  } else {
    for (const [index, object] of objects.entries()) write(object, index);
    if (!layoutReadsPublish) renderUntilPublished(scene, objects);
    for (const object of objects) total += read(object);
  }
  renderFrame(scene);
  return total;
}

/** Spawns and breaks apart each string, then renders and returns the glyph count and cleanup. */
export function spawnAndBreakApart(scene: LabelScene, texts: readonly string[], eachInTurn: boolean) {
  const spawned = texts.map((text) => scene.root.createText({ font, text, style: { fontSize: 16 } }));
  const copies: ReturnType<Label['breakApart']>[0][] = [];
  const copied = updateThenRead(
    scene,
    spawned,
    (object) => {
      scene.textGroup.add(object);
    },
    (object) => {
      const [glyphs, decorations] = object.breakApart();
      decorations?.dispose();
      object.visible = false;
      scene.scene.add(glyphs);
      copies.push(glyphs);
      return requireFresh(glyphs.count, object.text.length);
    },
    eachInTurn,
  );
  return {
    copied,
    unmount() {
      for (const copy of copies) {
        copy.removeFromParent();
        copy.dispose();
      }
      for (const object of spawned) {
        object.removeFromParent();
        object.dispose();
      }
    },
  };
}

/** Untimed outcome check: every object is committed and measures the glyphs of its current text. */
export function freshSnapshot(objects: readonly Label[]) {
  let fresh = 0;
  for (const object of objects) {
    if (object.commitState().status === 'committed' && object.measureGlyphs()?.length === object.text.length) {
      fresh += 1;
    }
  }
  assert.equal(fresh, objects.length);
  return fresh;
}
