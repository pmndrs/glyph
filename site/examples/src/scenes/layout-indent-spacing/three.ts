import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PARAGRAPHS, SPACED, WIDTH } from './scene';

/**
 * The imperative twin: stack paragraphs by `measure().height`. The height
 * includes `spaceBefore` and `spaceAfter`, so the gap needs no extra math.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-indent-spacing', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  let top = 2.25;
  const texts = PARAGRAPHS.map((paragraph) => {
    const text = three.createText({
      font: inter,
      text: paragraph,
      style: { fontSize: 0.22, lineHeight: 1.35, color: '#e7ecf6' },
      layout: SPACED,
      constraints: { width: { mode: 'exact', size: WIDTH } },
    });
    text.position.set(0.5, top, 0);
    top -= text.measure().height; // paragraph units are the object's local units; +Y is up in the scene
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
