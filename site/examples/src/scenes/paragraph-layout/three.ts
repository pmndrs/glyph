import { glyph, ParagraphLayout } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: three named layout rules, one breathing box. Only
 * `constraints` is reassigned per frame; assigning a value equal to the
 * current one is a no-op, and a changed box reflows on the next `shape()`.
 */
const PROSE =
  'Text goes through five stages, each owned by the layer best placed to do it exactly once. JavaScript owns Unicode analysis and the render loop. Rust owns shaping, layout, and the plan.';

const rules = ParagraphLayout.create({
  ragged: { wrap: 'word', align: 'start' },
  justified: { wrap: 'word', align: 'justify', lastLine: 'auto' },
  capped: { wrap: 'word', align: 'start', maxLines: 4, overflow: 'ellipsis' },
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:paragraph-layout', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const paragraphs = [rules.ragged, rules.justified, rules.capped].map((layout, index) => {
    const paragraph = three.createText({
      font: inter,
      text: PROSE,
      style: { fontSize: 0.2, color: index === 1 ? '#ffd166' : '#e7ecf6', lineHeight: 1.3 },
      layout,
      constraints: { width: { mode: 'exact', size: 3 }, height: { mode: 'at-most', size: 3.2 } },
    });
    paragraph.position.set(-5.4 + index * 3.7, 2.2, 0);
    scene.add(paragraph);
    return paragraph;
  });

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const width = 2.6 + Math.sin(elapsed * 0.6) * 0.7;
    for (const paragraph of paragraphs) {
      paragraph.constraints = { width: { mode: 'exact', size: width }, height: { mode: 'at-most', size: 3.2 } };
    }
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const paragraph of paragraphs) paragraph.dispose();
    inter.dispose();
    three.dispose();
  };
}
