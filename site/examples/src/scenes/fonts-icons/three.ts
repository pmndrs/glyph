import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { ICONS_MSDF, ICONS_MSDF_OPTIONS, INTER } from '../../fonts';

/**
 * The imperative twin: the icon subset is a FontFace like any other, and an
 * icon is the string holding its private-use code point. Each icon is its own
 * Text beside a caption set in Inter.
 */
const ICONS = [
  ['rocket', 0xf135],
  ['paintbrush', 0xf1fc],
  ['palette', 0xf53f],
  ['bolt', 0xf0e7],
  ['power-off', 0xf011],
  ['pen-to-square', 0xf044],
] as const;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:fonts-icons', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: msdf });
  // The format options must match the bake: this subset was baked with em-size 32 and pixel-range 6.
  const Icons = glyph.fontFace(ICONS_MSDF, { format: msdf(ICONS_MSDF_OPTIONS) });
  await Promise.all([Inter.load(), Icons.load()]);

  const created = ICONS.flatMap(([name, codePoint], index) => {
    const x = -4.8 + index * 1.6;
    const drawn = three.createText({
      font: Icons.msdf,
      text: String.fromCodePoint(codePoint),
      style: { fontSize: 0.8, color: '#e7ecf6' },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 1.6 } },
    });
    drawn.position.set(x, 1, 0);
    const caption = three.createText({
      font: Inter.msdf,
      text: `${name}\nU+${codePoint.toString(16).toUpperCase()}`,
      style: { fontSize: 0.16, color: '#97a1b4' },
      layout: { align: 'center' },
      constraints: { width: { mode: 'exact', size: 1.6 } },
    });
    caption.position.set(x, -0.1, 0);
    return [drawn, caption];
  });
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    Inter.dispose();
    Icons.dispose();
    three.dispose();
  };
}
