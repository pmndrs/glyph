import { glyph, TextStyle } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: named rules from `TextStyle.create`, one override per
 * row, merged through the property list at the `style` boundary.
 */
const styles = TextStyle.create({
  base: { fontSize: 0.36, color: '#e7ecf6', lineHeight: 1.1 },
  caption: { fontSize: 0.14, color: '#97a1b4', letterSpacing: 0.02 },
});

const ROWS = [
  ['fontSize', { fontSize: 0.52 }],
  ['letterSpacing', { letterSpacing: 0.06 }],
  ['wordSpacing', { wordSpacing: 0.25 }],
  ['color', { color: '#ffd166' }],
  ['outline', { outline: { color: '#0a0c12', width: 0.02 }, color: '#ffffff' }],
  ['shadow', { shadow: { color: [0, 0, 0, 0.6], offset: [0.03, -0.03] } }],
  ['decoration', { decoration: { underline: true } }],
  ['features', { features: [{ tag: 'smcp' }, { tag: 'tnum' }] }],
  ['opacity', { opacity: 0.6 }],
] as const;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:styling', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const created = ROWS.flatMap(([name, override], index) => {
    const y = 2.2 - index * 0.55;
    const caption = three.createText({
      font: inter,
      text: name,
      style: styles.caption,
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 2 } },
    });
    caption.position.set(-5.2, y + 0.08, 0);
    const sample = three.createText({
      font: inter,
      text: 'Sphinx of black quartz 1234',
      style: [styles.base, override],
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 7 } },
    });
    sample.position.set(-3.2, y + 0.18, 0);
    return [caption, sample];
  });
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
