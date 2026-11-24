import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ALIGNS, PARAGRAPH } from './scene';

/** The imperative twin: one text per alignment. Alignment needs an exact width to have room to align in. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-align', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = ALIGNS.map((align, column) => {
    const text = three.createText({
      font: inter,
      text: PARAGRAPH,
      style: { fontSize: 0.21, lineHeight: 1.35, color: '#e7ecf6' },
      layout: { align },
      constraints: { width: { mode: 'exact', size: 2.2 } },
    });
    text.position.set(-5.25 + column * 2.68, 1.5, 0);
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
