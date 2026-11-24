import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: the line metrics of one paragraph. Every value is a distance in the paragraph's own
 * space, y-down from the box's top edge; a three.js position negates y.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:inspect-line-metrics', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Every line reports its box, its baseline and the heights of its primary face.',
    style: { fontSize: 0.62, color: '#e7ecf6', lineHeight: 1.7 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 6.4 } },
  });
  text.position.set(-5, 2.4, 0);
  scene.add(text);

  const summary = text.measure(); // prepares the text first; no frame is needed
  for (const line of summary.lines) {
    const box = { x: 0, y: line.baseline - line.ascent, width: summary.width, height: line.lineHeight };
    const references = [line.baseline, line.capHeightTop, line.xHeightTop];
    void [box, references, line.advance, line.textStart, line.textEnd];
  }

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
