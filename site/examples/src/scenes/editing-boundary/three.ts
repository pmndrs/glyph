import { glyph, msdf, type TextPosition } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: the word, sentence and line that contain one position, and the rectangles that cover
 * each. A double click passes the position `hitTest` returned for the pointer.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:editing-boundary', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Point at a word. The engine answers with the word, the sentence and the line that contain the position.',
    style: { fontSize: 0.46, color: '#e7ecf6', lineHeight: 1.45 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 8.6 } },
  });
  text.position.set(-4.3, 2.35, 0);
  scene.add(text);

  const position: TextPosition = text.hitTest({ x: 3, y: 0.9 }); // Text-local, +Y down
  for (const unit of ['word', 'sentence', 'line'] as const) {
    const range = text.boundary(position, unit);
    const rects = text.rangeRects(range.start, range.end);
    void rects; // one quad each at (x + width / 2, -(y + height / 2)) in the text's local space
  }

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
