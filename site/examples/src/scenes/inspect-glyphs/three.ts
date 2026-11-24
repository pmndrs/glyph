import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: per-glyph boxes from the columns of `glyphs()`, in the paragraph's own space
 * (y-down from the box's top-left corner), and the same glyphs through the borrowed view.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:inspect-glyphs', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Typography',
    style: { fontSize: 1.5, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  scene.add(text);

  // Owned columns: one copy, kept as long as the caller likes.
  const layout = text.glyphs();
  const line = layout.lines[0]!;
  for (let index = 0; index < layout.glyphCount; index += 1) {
    const advanceBox = {
      x: layout.x[index]!,
      y: line.baseline - line.ascent,
      width: layout.glyphAdvances[index]!,
      height: line.lineHeight,
    };
    const inkBox = {
      x: layout.glyphInkX[index]!,
      y: layout.glyphInkY[index]!,
      width: layout.glyphInkWidths[index]!,
      height: layout.glyphInkHeights[index]!,
    };
    void [advanceBox, inkBox, layout.clusters[index]];
  }

  // Borrowed view: no copy of the layout; `glyphs` is valid only inside the callback.
  const widest = text.readGlyphs((glyphs) => {
    let advance = 0;
    for (let index = 0; index < glyphs.glyphCount; index += 1)
      advance = Math.max(advance, glyphs.glyphAt(index).advance);
    return advance;
  });
  void widest;

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
