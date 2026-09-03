import { createParagraph, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/raster/slug';
import type { Scene } from 'three/webgpu';

import { PLAYWRITE } from '../../fonts';

/**
 * The imperative twin, plus the thing React cannot show: `Paragraph` measures
 * with no scene object at all — what a layout engine needs from inside a
 * measure callback.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:measurement', ThreeConfig);
  const script = glyph.fontFace(PLAYWRITE, { format: slug });
  await script.load();

  const word = three.createText({
    font: script,
    text: 'glyph',
    style: { fontSize: 1.5, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  word.position.set(-3.4, 1, 0);
  scene.add(word);

  // Desired-state measurement: no world matrix, no renderer resource, no committed frame.
  const measured = word.measure();
  const advance = { width: measured.contentWidth, height: measured.contentHeight };
  const ink = measured.inkBounds; // undefined when nothing drew
  const baseline = measured.firstBaseline; // from the box's top edge, y-down
  void advance;
  void ink;
  void baseline;

  // Renderer-free: the same numbers from a Paragraph that owns no scene object, on the same loaded face.
  const paragraph = await createParagraph({ font: script, text: 'glyph', style: { fontSize: 1.5 } });
  const metrics = paragraph.measure({ width: { mode: 'unconstrained' } });
  void metrics.minContentWidth; // longest unbreakable run, from the same pass
  paragraph.dispose();

  glyph.shape();

  return () => {
    word.dispose();
    script.dispose();
    three.dispose();
  };
}
