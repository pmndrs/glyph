import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { ROWS, SERIF_MSDF } from './config';
import { OFF_X, ON_X, SERIF, STEP, TOP } from './scene';

/**
 * The imperative twin: the same string created twice per row, once with the
 * row's "off" feature list and once with its "on" list.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-opentype-features', ThreeConfig);
  // The face was baked with its own MSDF options; the same options name the same raster.
  const serif = glyph.fontFace(SERIF, { format: msdf(SERIF_MSDF) });
  await serif.load();

  const created = ROWS.flatMap((row, index) =>
    ([row.off, row.on] as const).map((features, side) => {
      const text = three.createText({
        font: serif,
        text: row.text,
        style: { fontSize: 0.5, color: side === 0 ? '#e7ecf6' : '#ffd166', features },
        layout: { wrap: 'none' },
      });
      text.position.set(side === 0 ? OFF_X : ON_X, TOP - index * STEP, 0);
      scene.add(text);
      return text;
    }),
  );
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    serif.dispose();
    three.dispose();
  };
}
