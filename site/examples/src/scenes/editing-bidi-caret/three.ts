import { glyph, slug } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { AMIRI, BOUNDARY, FONT_SIZE, PASSAGE } from './config';

/**
 * The imperative twin: the two carets of one offset at a direction boundary. `rect` is the side the
 * affinity names; `secondary` is the other side, and is `undefined` away from a boundary.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:editing-bidi-caret', ThreeConfig);
  const amiri = glyph.fontFace(AMIRI, { format: slug });
  await amiri.load();

  const text = three.createText({
    font: amiri,
    text: PASSAGE,
    style: { fontSize: FONT_SIZE, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  scene.add(text);

  const caret = text.caret({ offset: BOUNDARY, affinity: 'downstream' });
  const primary = caret.rect; // on the Arabic letter's leading edge; caret.level is 1
  const secondary = caret.secondary; // where { offset: 4, affinity: 'upstream' } draws: after the space
  void [primary, secondary]; // draw each at (x, -(y + height / 2)) in the text's local space

  return () => {
    text.dispose();
    amiri.dispose();
    three.dispose();
  };
}
