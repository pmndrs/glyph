import { glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { DIGITS, LANGUAGES } from './config';
import { AMIRI, COLUMN } from './scene';

/**
 * The imperative twin: one text per language, identical except for
 * `style.language`.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-language-shaping', ThreeConfig);
  const amiri = glyph.fontFace(AMIRI, { format: slug });
  await amiri.load();

  const created = LANGUAGES.map((entry, index) => {
    const text = three.createText({
      font: amiri,
      text: DIGITS,
      style: { fontSize: 1.15, color: '#e7ecf6', language: entry.language },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: COLUMN } },
    });
    text.position.set(-5.1 + index * COLUMN, 1.55, 0);
    scene.add(text);
    return text;
  });
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    amiri.dispose();
    three.dispose();
  };
}
