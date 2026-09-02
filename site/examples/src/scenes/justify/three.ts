import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Group, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BODY, JUSTIFY, LEDE } from './scene';

/**
 * The imperative twin: `set({ constraints })` replaces the width, `shape()`
 * reflows both paragraphs, and `measure().height` — which carries the lede's
 * `spaceAfter` — places the body under it.
 */
const FONT_SIZE = 0.27;
const LINE_HEIGHT = 1.3;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:justify', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const page = new Group();
  page.position.set(-4, 2.1, 0);
  const lede = three.createText({
    font: inter,
    text: LEDE,
    style: { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, color: '#e7ecf6' },
    layout: { wrap: 'word', align: 'justify', justify: JUSTIFY, spaceAfter: FONT_SIZE * 0.8 },
    constraints: { width: { mode: 'exact', size: 8 } },
  });
  const body = three.createText({
    font: inter,
    text: BODY,
    style: { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, color: '#97a1b4', wordSpacing: FONT_SIZE * 0.05 },
    layout: {
      wrap: 'word',
      align: 'justify',
      justify: JUSTIFY,
      firstLineIndent: FONT_SIZE * 1.5,
      columns: { count: 2, gap: FONT_SIZE * 1.2 },
      overflow: 'clip',
    },
    constraints: { width: { mode: 'exact', size: 8 }, height: { mode: 'exact', size: FONT_SIZE * LINE_HEIGHT * 9 } },
  });
  page.add(lede, body);
  scene.add(page);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  let width = 8;
  const tick = (): void => {
    elapsed += 1 / 60;
    const next = 7.6 + Math.sin(elapsed * 0.35) * 1.4;
    if (Math.abs(next - width) > 0.03) {
      width = next;
      page.position.x = -width / 2;
      // `set` replaces a property group wholesale; the height constraint travels with the new width.
      lede.set({ constraints: { width: { mode: 'exact', size: width } } });
      body.set({ constraints: { ...body.constraints, width: { mode: 'exact', size: width } } });
      glyph.shape();
      body.position.y = -lede.measure().height;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    lede.dispose();
    body.dispose();
    inter.dispose();
    three.dispose();
  };
}
