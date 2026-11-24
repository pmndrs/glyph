import { glyph, TextStyle } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { LINE_HEIGHTS, LINES, ROWS, SAMPLE } from './scene';

/**
 * The imperative twin: one `createText` per row, each merging the base rule
 * with one override through the `style` property list.
 */
const styles = TextStyle.create({
  base: { fontSize: 0.3, color: '#e7ecf6' },
  caption: { fontSize: 0.14, color: '#97a1b4', letterSpacing: 0.02 },
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-style-basics', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const rows = ROWS.flatMap(([name, override], index) => {
    const y = 2.1 - index * 0.62;
    const label = three.createText({ font: inter, text: name, style: styles.caption, layout: { wrap: 'none' } });
    label.position.set(-5.2, y + 0.08, 0);
    const sample = three.createText({
      font: inter,
      text: SAMPLE,
      style: [styles.base, override],
      layout: { wrap: 'none' },
    });
    sample.position.set(-3.2, y + 0.18, 0);
    return [label, sample];
  });
  const paragraphs = LINE_HEIGHTS.flatMap((lineHeight, index) => {
    const y = 2.18 - index * 2.2;
    const label = three.createText({
      font: inter,
      text: `lineHeight: ${lineHeight}`,
      style: styles.caption,
      layout: { wrap: 'none' },
    });
    label.position.set(2.2, y, 0);
    const lines = three.createText({ font: inter, text: LINES, style: [styles.base, { lineHeight }] });
    lines.position.set(2.2, y - 0.34, 0);
    return [label, lines];
  });
  const created = [...rows, ...paragraphs];
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    for (const text of created) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
