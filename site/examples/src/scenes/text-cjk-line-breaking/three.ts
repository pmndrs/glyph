import { glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { COLUMNS, MPLUS } from './scene';

/**
 * The imperative twin: three texts whose `constraints.width` is rewritten
 * every frame; each assignment marks the text dirty and `glyph.shape()`
 * re-breaks the lines before the host renders.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-cjk-line-breaking', ThreeConfig);
  const mplus = glyph.fontFace(MPLUS, { format: slug });
  await mplus.load();

  const created = COLUMNS.map((column, index) => {
    const text = three.createText({
      font: mplus,
      text: column.text,
      style: { fontSize: 0.34, color: '#e7ecf6', lineHeight: 1.6, language: 'ja' },
      layout: { wrap: column.wrap },
      constraints: { width: { mode: 'exact', size: 2.6 } },
    });
    text.position.set(-5.2 + index * 3.55, 2.1, 0);
    scene.add(text);
    return text;
  });
  glyph.shape();

  let frame = 0;
  const start = performance.now();
  const tick = (): void => {
    const width = 2.6 + Math.sin(((performance.now() - start) / 1000) * 0.6) * 0.6;
    for (const text of created) text.constraints = { width: { mode: 'exact', size: width } };
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const text of created) text.dispose();
    mplus.dispose();
    three.dispose();
  };
}
