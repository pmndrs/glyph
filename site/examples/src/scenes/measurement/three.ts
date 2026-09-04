import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/raster/slug';
import type { Scene } from 'three/webgpu';

import { PLAYWRITE } from '../../fonts';

/**
 * The imperative twin, plus the thing React cannot show: `measure()` answers
 * from desired state — before any world matrix, renderer resource, or committed
 * frame exists — which is what a layout engine needs from inside a measure
 * callback.
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

  // Intrinsic widths ride the same pass. They do not depend on the constraints
  // being probed, so the longest unbreakable run and the unwrapped width come
  // back from the measurement already taken — no second layout, and no separate
  // renderer-free paragraph object to own and dispose.
  void measured.minContentWidth; // longest unbreakable run
  void measured.maxContentWidth; // width if nothing wrapped

  glyph.shape();

  return () => {
    word.dispose();
    script.dispose();
    three.dispose();
  };
}
