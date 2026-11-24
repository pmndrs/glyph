import { createFontStack, glyph, msdf, type Font } from '@pmndrs/glyph';
import { ThreeConfig, type Text } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { CHORUS, CHORUS_MSDF, INTER } from '../../fonts';

/**
 * The imperative twin. `createFontStack` takes loaded `Font` values. A Text
 * created from a FontFace selection binds one, and `text.font` returns it, so
 * each fallback face is bound by a small caption first and the stack is built
 * from those bindings. The captions own the fonts: they stay alive as long as
 * the stacked text does.
 */
const SAMPLE = 'glyph 字形 אות Ω';

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:fonts-fallback', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: msdf });
  const Japanese = glyph.fontFace(CHORUS.japanese, { format: msdf(CHORUS_MSDF) });
  const Hebrew = glyph.fontFace(CHORUS.hebrew, { format: msdf(CHORUS_MSDF) });
  await Promise.all([Inter.load(), Japanese.load(), Hebrew.load()]);

  const alone = three.createText({ font: Inter.msdf, text: SAMPLE, style: { fontSize: 0.95, color: '#e7ecf6' } });
  const japanese = three.createText({ font: Japanese.msdf, text: '字形', style: { fontSize: 0.2 } });
  const hebrew = three.createText({ font: Hebrew.msdf, text: 'אות', style: { fontSize: 0.2 } });

  const stacked = three.createText({
    font: createFontStack(bound(alone), bound(japanese), bound(hebrew)),
    text: SAMPLE,
    style: { fontSize: 0.95, color: '#e7ecf6' },
    layout: { wrap: 'none' },
  });
  alone.position.set(-4.6, 1.7, 0);
  stacked.position.set(-4.6, -0.8, 0);
  japanese.position.set(-4.6, -2.4, 0);
  hebrew.position.set(-3.6, -2.4, 0);

  // Inter alone leaves six clusters on `.notdef`; the stack leaves one, the omega.
  const missing = [alone.measure().missingGlyphCount, stacked.measure().missingGlyphCount];
  void missing;

  const created = [alone, japanese, hebrew, stacked];
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    stacked.dispose();
    for (const text of [alone, japanese, hebrew]) text.dispose();
    for (const face of [Inter, Japanese, Hebrew]) face.dispose();
    three.dispose();
  };
}

/** The `Font` a Text created from a FontFace selection is bound to. */
function bound(text: Text<typeof msdf>): Font<typeof msdf> {
  const font = text.font;
  if ('fonts' in font) throw new TypeError('expected a single font');
  return font;
}
