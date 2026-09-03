import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import type { Scene } from 'three/webgpu';

import { INTER, INTER_STRIKES } from '../../fonts';

/** The imperative twin: one column per format, sizes in pixels under an orthographic camera. */
const SIZES = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512] as const;
const WIDTH_PER_PX = 3.4;

export async function mount(scene: Scene, width: number, height: number): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-ladder', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: [msdf, slug, bitmap(INTER_STRIKES)] });
  await Inter.load();

  const columns = [
    ['bitmap', Inter.bitmap],
    ['msdf', Inter.msdf],
    ['slug', Inter.slug],
  ] as const;
  const columnWidth = width / columns.length;
  const sizes = SIZES.filter((size) => size * WIDTH_PER_PX <= columnWidth - 32);
  const created = columns.flatMap(([label, font], column) => {
    const x = -width / 2 + column * columnWidth + 24;
    let y = height / 2 - 64;
    const caption = three.createText({
      font: Inter.msdf,
      text: label.toUpperCase(),
      style: { fontSize: 12, color: '#97a1b4', letterSpacing: 1 },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: columnWidth } },
    });
    caption.position.set(x, y, 0);
    const rows = sizes.map((size) => {
      y -= size * 1.15 + 6;
      const row = three.createText({
        font,
        text: `${size} Glyph`,
        style: { fontSize: size, color: '#e7ecf6', lineHeight: 1 },
        layout: { wrap: 'none', overflow: 'clip' },
        constraints: { width: { mode: 'exact', size: columnWidth - 32 } },
        pixelSnapping: label === 'bitmap',
      });
      row.position.set(x, y + size, 0);
      return row;
    });
    return [caption, ...rows];
  });
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    Inter.dispose();
    three.dispose();
  };
}
