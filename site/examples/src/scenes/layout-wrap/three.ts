import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { SENTENCE, WRAPS } from './scene';

/** The imperative twin: one text per wrap mode on the same exact width. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-wrap', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = WRAPS.map((wrap, row) => {
    const text = three.createText({
      font: inter,
      text: SENTENCE,
      style: { fontSize: 0.24, lineHeight: 1.3, color: '#e7ecf6' },
      layout: { wrap },
      constraints: { width: { mode: 'exact', size: 4 } },
    });
    text.position.set(-3.1, 2.65 - row * 1.9, 0);
    scene.add(text);
    return text;
  });
  glyph.shape();

  return () => {
    for (const text of texts) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
