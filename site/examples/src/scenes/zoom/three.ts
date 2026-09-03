import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { Group, type Scene } from 'three/webgpu';

import { INTER, INTER_STRIKES } from '../../fonts';

/** The imperative twin: one raster per format, magnified by a group's scale under an orthographic camera. */
const SIZE = 32;

export async function mount(scene: Scene, width: number, height: number): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:zoom', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: [msdf, slug, bitmap(INTER_STRIKES)] });
  await Inter.load();

  const formats = [
    ['bitmap', Inter.bitmap],
    ['msdf', Inter.msdf],
    ['slug', Inter.slug],
  ] as const;
  const columnWidth = width / formats.length;
  const columns = formats.map(([label, font], index) => {
    const column = new Group();
    column.position.x = -width / 2 + columnWidth * (index + 0.5);
    const caption = three.createText({
      font: Inter.msdf,
      text: label.toUpperCase(),
      style: { fontSize: 12, color: '#97a1b4', letterSpacing: 1 },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: columnWidth } },
    });
    caption.position.set(-columnWidth / 2, height / 2 - 24, 0);
    const zoomed = new Group();
    const word = three.createText({
      font,
      text: 'Zoom',
      style: { fontSize: SIZE, color: '#e7ecf6', lineHeight: 1 },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 400 } },
    });
    word.position.set(-200, SIZE / 2, 0);
    zoomed.add(word);
    column.add(caption, zoomed);
    return { column, zoomed, texts: [caption, word] };
  });
  for (const { column } of columns) scene.add(column);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const scale = 2 ** (Math.sin(elapsed * 0.45) * 2);
    for (const { zoomed } of columns) zoomed.scale.setScalar(scale);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const { texts } of columns) for (const text of texts) text.dispose();
    Inter.dispose();
    three.dispose();
  };
}
