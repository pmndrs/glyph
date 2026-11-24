import { glyph, type AxisConstraint } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { SENTENCE } from './scene';

/**
 * The imperative twin: three texts, one per width mode. Only `constraints`
 * is reassigned; `measure()` prepares the text and returns the resolved box.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-constraints', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const widths = (size: number): readonly AxisConstraint[] => [
    { mode: 'unconstrained' },
    { mode: 'at-most', size },
    { mode: 'exact', size },
  ];
  const texts = widths(5).map((width, row) => {
    const text = three.createText({
      font: inter,
      text: SENTENCE,
      style: { fontSize: 0.3, lineHeight: 1.3, color: '#e7ecf6' },
      constraints: { width },
    });
    text.position.set(-2.7, 2.55 - row * 1.8, 0);
    scene.add(text);
    return text;
  });

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const next = widths(5 + Math.sin(elapsed * 0.5) * 2.4);
    for (const [row, text] of texts.entries()) {
      text.constraints = { width: next[row]! };
      const { width, height } = text.measure(); // the resolved box, in the text's own units
      void width;
      void height;
    }
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const text of texts) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
