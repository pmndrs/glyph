import { glyph, ParagraphLayout } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PARAGRAPH } from './scene';

/** The imperative twin: four named justification rules on one exact width. */
const rules = ParagraphLayout.create({
  unbounded: { align: 'justify' },
  capped: { align: 'justify', justify: { maxWordSpaceRatio: 1.5 } },
  spilled: { align: 'justify', justify: { maxWordSpaceRatio: 1.5, letterSpaceExpansion: 0.02 } },
  full: { align: 'justify', lastLine: 'justify' },
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-justify-bounds', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = Object.values(rules).map((layout, column) => {
    const text = three.createText({
      font: inter,
      text: PARAGRAPH,
      style: { fontSize: 0.21, lineHeight: 1.35, color: '#e7ecf6' },
      layout,
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
