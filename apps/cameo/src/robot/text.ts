import type { Text } from '@pmndrs/glyph/three';
import { mat4 } from 'math';
import { Matrix4 } from 'three/webgpu';

type Source = Pick<Text<never>, 'text' | 'glyphs' | 'breakApart' | 'parent' | 'visible'>;

/** Row 0 and row 1 of a column-major 4x4: the lanes that carry a glyph's x and y. */
const ROW_X = [0, 4, 8] as const;
const ROW_Y = [1, 5, 9] as const;

/**
 * One screenful the face can print a character at a time without reshaping it, re-rendering React, or allocating
 * while a take runs.
 *
 * Printing a prefix of centred text moves the characters already on screen: the line recentres as it fills. The
 * layout is therefore measured once for every prefix, and each glyph keeps the horizontal shift that prefix put it
 * at, so a prefix is drawn by copying committed matrices rather than by laying text out again.
 *
 * Words are recorded too, with the centre of each one's ink, so a printed word can be beaten about its own middle.
 *
 * The line is centred on its ink rather than on its advances, because a display is read by where the marks sit and
 * not by where the pen would have stopped. `width` is the area it is centred in.
 */
export function createPrintedCard(source: Source, width: number) {
  const complete = source.text;
  const full = source.glyphs();
  const [glyphs, decorations] = source.breakApart();
  decorations?.dispose();
  source.parent?.add(glyphs);
  source.visible = false;

  try {
    // Runs of non-space characters, which is what beats as a unit.
    const wordOfCluster = new Int32Array(complete.length).fill(-1);
    const wordEnds: number[] = [];

    for (let cluster = 0; cluster < complete.length; cluster++) {
      if (complete[cluster] === ' ') continue;

      if (cluster === 0 || complete[cluster - 1] === ' ') wordEnds.push(0);

      wordOfCluster[cluster] = wordEnds.length - 1;
      wordEnds[wordEnds.length - 1] = cluster + 1;
    }

    const records = glyphs.measurements.map((measurement) => {
      const original = mat4.create();
      measurement.originalMatrix.toArray(original);
      const cluster = glyphs.glyphAt(measurement.index)!.cluster;
      const ink = measurement.localInkBounds;

      return { index: measurement.index, cluster, word: wordOfCluster[cluster] ?? -1, original, ink };
    });
    // Where each cluster sits in the committed layout, to measure a prefix's glyphs against.
    const slotOfCluster = new Map<number, number>();

    for (let slot = 0; slot < records.length; slot++) slotOfCluster.set(records[slot]!.cluster, slot);

    const restX = new Float64Array(records.length);

    for (let index = 0; index < full.clusters.length; index++) {
      const slot = slotOfCluster.get(full.clusters[index]!);

      if (slot !== undefined) restX[slot] = full.x[index]!;
    }

    const shifts = new Float32Array((complete.length + 1) * records.length);

    for (let count = 1; count < complete.length; count++) {
      source.text = complete.slice(0, count);
      const prefix = source.glyphs();

      for (let index = 0; index < prefix.clusters.length; index++) {
        const slot = slotOfCluster.get(prefix.clusters[index]!);

        if (slot !== undefined) shifts[count * records.length + slot] = prefix.x[index]! - restX[slot]!;
      }
    }

    // Each word's ink centre, and the first record that carries its horizontal shift.
    const pivots = new Float32Array(wordEnds.length * 2);
    const leaders = new Int32Array(wordEnds.length).fill(-1);
    const extents = wordEnds.map(() => ({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));

    for (let slot = 0; slot < records.length; slot++) {
      const record = records[slot]!;
      const extent = extents[record.word];

      if (extent === undefined || record.ink.isEmpty()) continue;

      if (leaders[record.word]! < 0) leaders[record.word] = slot;

      extent.minX = Math.min(extent.minX, record.ink.min.x);
      extent.maxX = Math.max(extent.maxX, record.ink.max.x);
      extent.minY = Math.min(extent.minY, record.ink.min.y);
      extent.maxY = Math.max(extent.maxY, record.ink.max.y);
    }

    for (const [word, extent] of extents.entries()) {
      if (!Number.isFinite(extent.minX)) continue;

      pivots[word * 2] = (extent.minX + extent.maxX) / 2;
      pivots[word * 2 + 1] = (extent.minY + extent.maxY) / 2;
    }

    // Optical centring: the whole line's ink, brought to the middle of the printable area.
    const line = { min: Infinity, max: -Infinity };

    for (const record of records) {
      if (record.ink.isEmpty()) continue;

      line.min = Math.min(line.min, record.ink.min.x);
      line.max = Math.max(line.max, record.ink.max.x);
    }

    const centring = Number.isFinite(line.min) ? width / 2 - (line.min + line.max) / 2 : 0;

    return {
      glyphs,
      records,
      shifts,
      centring,
      pivots,
      leaders,
      wordEnds: Int32Array.from(wordEnds),
      length: complete.length,
      printed: -1,
      beat: Number.NaN,
      transform: mat4.create(),
      draw: new Matrix4(),
      hidden: new Matrix4().makeScale(0, 0, 0),
    };
  } catch (error) {
    glyphs.dispose();
    throw error;
  } finally {
    source.text = complete;
  }
}

export type PrintedCard = ReturnType<typeof createPrintedCard>;

/** A beat a little under a second: two thumps, the second softer and close behind the first. */
function heartbeat(seconds: number): number {
  const phase = (seconds / 0.85) % 1;
  const thump = (at: number, width: number) => Math.exp(-((phase - at) ** 2) / width);

  return thump(0, 0.008) + 0.7 * thump(0.19, 0.01);
}

/**
 * Print the first `count` characters, recentring the line as it fills. A card given a `beat` clock swells each
 * word it has finished printing about that word's own centre, so the sign-off beats where it stands.
 */
export function printCard(card: PrintedCard, count: number, beat = Number.NaN): void {
  if (count === card.printed && Object.is(beat, card.beat)) return;

  card.printed = count;
  card.beat = beat;
  const beating = !Number.isNaN(beat);
  const row = Math.min(count, card.length) * card.records.length;

  for (let slot = 0; slot < card.records.length; slot++) {
    const record = card.records[slot]!;

    if (record.cluster >= count) {
      card.glyphs.setMatrixAt(record.index, card.hidden);
      continue;
    }

    mat4.copy(card.transform, record.original);
    const shift = card.shifts[row + slot]!;
    card.transform[12] += shift + card.centring;
    const word = record.word;

    // A word swells only once it is whole, so a half printed one never jumps.
    if (beating && word >= 0 && count >= card.wordEnds[word]!) {
      // Stagger the words, so the line beats along rather than all at once.
      const swell = 1 + 0.42 * heartbeat(beat - word * 0.14);
      const pivotX = card.pivots[word * 2]! + card.shifts[row + card.leaders[word]!]! + card.centring;
      const pivotY = card.pivots[word * 2 + 1]!;

      for (const lane of ROW_X) card.transform[lane] *= swell;

      for (const lane of ROW_Y) card.transform[lane] *= swell;

      card.transform[12] = pivotX + swell * (card.transform[12] - pivotX);
      card.transform[13] = pivotY + swell * (card.transform[13] - pivotY);
    }

    card.glyphs.setMatrixAt(record.index, card.draw.fromArray(card.transform));
  }
}

export function disposeCard(card: Pick<PrintedCard, 'glyphs'>): void {
  card.glyphs.dispose();
}
