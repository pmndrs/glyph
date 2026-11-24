import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { BufferAttribute, BufferGeometry, LineBasicNodeMaterial, LineSegments, type Scene } from 'three/webgpu';

import { FONT_SIZE, INTER_OUTLINES, OUTLINE_MSDF, STEPS, WORD } from './config';
import { outlineGeometry } from './outline';

/**
 * The imperative twin: read every glyph's outline from one `glyphs()` copy and draw it as line pieces, as
 * a child of the text so it shares the text's transform.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:inspect-outlines', ThreeConfig);
  // This file was baked with outlines; outlineAt() throws TypeError for a font baked without them.
  const outlined = glyph.fontFace(INTER_OUTLINES, { format: msdf(OUTLINE_MSDF) });
  await outlined.load();

  const text = three.createText({
    font: outlined,
    text: WORD,
    style: { fontSize: FONT_SIZE, color: '#e7ecf6', opacity: 0.16 },
    layout: { wrap: 'none' },
  });
  scene.add(text);

  const { segments } = outlineGeometry(text.glyphs(), STEPS);
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(segments, 3));
  const material = new LineBasicNodeMaterial({ color: '#ffd166' });
  text.add(new LineSegments(geometry, material));

  return () => {
    geometry.dispose();
    material.dispose();
    text.dispose();
    outlined.dispose();
    three.dispose();
  };
}
