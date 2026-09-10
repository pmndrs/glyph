import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { Group, type Scene } from 'three/webgpu';

import { CHORUS, CHORUS_MSDF, INTER } from '../../fonts';
import { ROWS, graphemes, revealPlan } from './scene';

/**
 * The imperative twin: `text.set({ text })` per revealed cluster; every
 * assignment reshapes the whole word, which is what makes reordering and
 * joining visible at all.
 */
const STEP = 0.32;
const HOLD = 2.5;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:shaping', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  // The chorus faces were baked with their own MSDF options; the same options name the same raster.
  const faces = new Map(ROWS.map((row) => [row.face, glyph.fontFace(CHORUS[row.face], { format: msdf(CHORUS_MSDF) })]));
  await Promise.all([inter.load(), ...[...faces.values()].map((face) => face.load())]);

  const rows = ROWS.map((row, index) => {
    const units = graphemes(row.word, row.language);
    const group = new Group();
    group.position.set(-5 + (index % 2) * 5.5, 2.3 - Math.floor(index / 2) * 1.35, 0);
    const face = faces.get(row.face);
    if (face === undefined) throw new Error(`no face for ${row.face}`);
    const word = three.createText({
      font: face,
      text: '',
      style: { fontSize: 0.72, color: '#e7ecf6', language: row.language, direction: row.direction },
      layout: { align: 'start', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 4.5 } },
    });
    const note = three.createText({
      font: inter,
      text: row.note,
      style: { fontSize: 0.2, color: '#97a1b4', letterSpacing: 0.02 },
      layout: { align: 'start', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 4.5 } },
    });
    note.position.y = -0.86;
    group.add(word, note);
    scene.add(group);
    return { units, word, note, shown: 0 };
  });
  glyph.shape();

  const total = rows.reduce((sum, row) => sum + row.units.length, 0);
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const cycle = total * STEP + HOLD;
    const plan = revealPlan(
      rows.map((row) => row.units),
      Math.min(total, Math.floor((elapsed % cycle) / STEP) + 1),
    );
    let dirty = false;
    for (const [index, row] of rows.entries()) {
      const shown = plan[index] ?? 0;
      if (shown !== row.shown) {
        row.shown = shown;
        row.word.set({ text: row.units.slice(0, shown).join('') });
        dirty = true;
      }
    }
    if (dirty) glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const row of rows) {
      row.word.dispose();
      row.note.dispose();
    }
    for (const face of faces.values()) face.dispose();
    inter.dispose();
    three.dispose();
  };
}
