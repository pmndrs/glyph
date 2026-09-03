import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import type { Scene } from 'three/webgpu';

import { INTER, INTER_STRIKES } from '../../fonts';

/**
 * The imperative twin: one FontFace declares all three formats, `load()` loads
 * them all, and each row selects a member — `Inter.bitmap`, `Inter.msdf`,
 * `Inter.slug` — for the same word at three sizes.
 */
const SIZES = [0.18, 0.5, 1.4] as const;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:techniques', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: [msdf, slug, bitmap(INTER_STRIKES)] });
  await Inter.load();

  const rows = [
    ['bitmap', Inter.bitmap],
    ['msdf', Inter.msdf],
    ['slug', Inter.slug],
  ] as const;

  const created = rows.flatMap(([label, font], row) => {
    const caption = three.createText({
      font: Inter.msdf,
      text: label,
      style: { fontSize: 0.16, color: '#97a1b4', letterSpacing: 0.02 },
      layout: { align: 'start', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 2 } },
    });
    caption.position.set(-5.2, 1.7 - row * 1.6, 0);
    const words = SIZES.map((size, column) => {
      const word = three.createText({
        font,
        text: 'Glyph',
        style: { fontSize: size, color: '#e7ecf6' },
        layout: { align: 'start', wrap: 'none' },
        constraints: { width: { mode: 'exact', size: 3 } },
      });
      word.position.set(-3.2 + column * 2.4, 1.6 - row * 1.6 + size * 0.5, 0);
      return word;
    });
    return [caption, ...words];
  });
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    Inter.dispose();
    three.dispose();
  };
}
