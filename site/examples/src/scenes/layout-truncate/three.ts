import { createFontStack, glyph, msdf, type Font } from '@pmndrs/glyph';
import { ThreeConfig, type Text } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ELLIPSIS, ELLIPSIS_MSDF } from '../layout-kit/fonts';
import { PROSE } from '../layout-kit/prose';
import { CAPPED, OVERFLOWS } from './scene';

/**
 * The imperative twin. The ellipsis is U+2026 shaped through the font stack,
 * so the stack needs a face that has it. Under the fixed height, `visible`
 * keeps the lines that fit and the one that crosses the foot of the box,
 * while `clip` and `ellipsis` keep only the lines that fit.
 * `measure().overflowed` reports that content did not fit under every value.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-truncate', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: msdf });
  const Ellipsis = glyph.fontFace(ELLIPSIS, { format: msdf(ELLIPSIS_MSDF) });
  await Promise.all([Inter.load(), Ellipsis.load()]);

  // A Text created from a FontFace selection binds a Font; the stack is built from those bindings.
  const latin = three.createText({ font: Inter.msdf, text: ' ' });
  const dots = three.createText({ font: Ellipsis.msdf, text: ' ' });
  const font = createFontStack(bound(latin), bound(dots));
  const style = { fontSize: 0.2, lineHeight: 1.35, color: '#e7ecf6' } as const;

  const boxed = OVERFLOWS.map((overflow, index) => {
    const text = three.createText({
      font,
      text: PROSE,
      style,
      layout: { overflow },
      constraints: { width: { mode: 'exact', size: 3.2 }, height: { mode: 'exact', size: 1.35 } },
    });
    text.position.set(-5.2 + index * 3.6, 2.35, 0);
    return text;
  });
  const capped = CAPPED.map(([, layout, direction], index) => {
    const text = three.createText({
      font,
      text: PROSE,
      style: [style, direction],
      layout,
      constraints: { width: { mode: 'exact', size: 3.2 } },
    });
    text.position.set(-5.2 + index * 3.6, -1.2, 0);
    return text;
  });
  const texts = [...boxed, ...capped];
  for (const text of texts) scene.add(text);
  const truncated = texts.map((text) => text.measure().overflowed); // true for all six
  void truncated;
  glyph.shape();

  return () => {
    for (const text of [...texts, latin, dots]) text.dispose();
    Inter.dispose();
    Ellipsis.dispose();
    three.dispose();
  };
}

/** The `Font` a Text created from a FontFace selection is bound to. */
function bound(text: Text<typeof msdf>): Font<typeof msdf> {
  const font = text.font;
  if ('fonts' in font) throw new TypeError('expected a single font');
  return font;
}
