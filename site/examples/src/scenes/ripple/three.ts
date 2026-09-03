import { glyph, txt } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { span, ThreeConfig } from '@pmndrs/glyph/three';
import type { Renderer, Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { PAPER, PAPER_DIM } from '../../theme';
import { COLUMN, FONT_SIZE, LINE_HEIGHT } from './config';
import { rippleInk } from './materials';

/**
 * The imperative twin: one paragraph, `set({ text })` on every tick the typist advances, and the
 * same material doing the wave. The tick writes text and nothing else — the displacement is in the
 * material's graph, so it runs on the GPU whether or not this frame changed a character.
 */
export async function mount(scene: Scene, renderer: Renderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:ripple', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: [msdf] });
  await inter.load();
  void renderer;

  const caret = span({ color: PAPER_DIM });
  const line = handle.createText({
    font: inter.msdf,
    material: rippleInk,
    text: '',
    style: { fontSize: FONT_SIZE, color: PAPER, lineHeight: LINE_HEIGHT },
    layout: { wrap: 'word', align: 'center' },
    constraints: { width: { mode: 'exact', size: COLUMN.width } },
  });
  line.position.set(...COLUMN.position);
  scene.add(line);

  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  const tick = (): void => {
    elapsed += 1 / 60;
    const next = passageFrame(elapsed);
    const passage = passageAt(next.passage);
    if (next.shown !== shown) {
      shown = next.shown;
      const { before, current } = splitCurrentWord(passage.slice(0, shown));
      const tail = shown < passage.length ? '|' : '';
      line.set({ text: txt`${before}${current}${caret`${tail}`}` });
    }
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    line.dispose();
    inter.dispose();
    handle.dispose();
  };
}
