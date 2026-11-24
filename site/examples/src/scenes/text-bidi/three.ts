import { glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { MIXED } from './config';
import { AMIRI, BOX_X, DIRECTIONS, NARROW, TRUNCATED, WIDE } from './scene';

/**
 * The imperative twin: `style.direction` is the only thing that differs
 * between the first three texts; the last two add a one-line ellipsis.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-bidi', ThreeConfig);
  const amiri = glyph.fontFace(AMIRI, { format: slug });
  await amiri.load();

  const aligned = DIRECTIONS.map((direction, index) => {
    const text = three.createText({
      font: amiri,
      text: MIXED,
      style: { fontSize: 0.4, lineHeight: 1.65, color: '#e7ecf6', direction },
      layout: { align: 'start', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: WIDE } },
    });
    text.position.set(BOX_X, 2.45 - index * 0.86, 0);
    return text;
  });
  const truncated = TRUNCATED.map((row, index) => {
    const text = three.createText({
      font: amiri,
      text: row.text,
      style: { fontSize: 0.4, lineHeight: 1.65, color: '#e7ecf6', direction: row.direction },
      layout: { align: 'start', wrap: 'none', overflow: 'ellipsis', maxLines: 1 },
      constraints: { width: { mode: 'exact', size: NARROW } },
    });
    text.position.set(BOX_X, -0.85 - index * 0.86, 0);
    return text;
  });
  const created = [...aligned, ...truncated];
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    amiri.dispose();
    three.dispose();
  };
}
