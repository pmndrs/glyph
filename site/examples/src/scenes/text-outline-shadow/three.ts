import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { SAMPLES, SIZE } from './scene';

/**
 * The imperative twin. The face is requested in MSDF explicitly: outline and
 * shadow are MSDF effects, and a Bitmap or Slug font would make `createText`
 * throw `GlyphInputError` for these styles.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-outline-shadow', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const created = SAMPLES.map((sample, index) => {
    const text = three.createText({
      font: inter,
      text: sample.word,
      style: [{ fontSize: SIZE }, sample.style],
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 9 } },
    });
    text.position.set(-4.5, 2.2 - index * 1.62, 0);
    scene.add(text);
    return text;
  });
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
