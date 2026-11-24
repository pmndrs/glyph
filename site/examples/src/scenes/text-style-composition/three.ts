import { glyph, txt } from '@pmndrs/glyph';
import { span, ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { styles } from './scene';

/**
 * The imperative twin: the same rules through `createText`, a condition
 * re-evaluated by assigning `text.style`, and `txt`/`span` for the paragraph
 * whose spans inherit opacity and color independently.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-style-composition', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const lists = [styles.body, [styles.body, styles.emphasis], [styles.body, styles.emphasis, { opacity: 0.4 }]];
  const samples = lists.map((style, index) => {
    const text = three.createText({ font: inter, text: 'Reuse a rule', style, layout: { wrap: 'none' } });
    text.position.set(-4.6, 2.3 - index * 0.78, 0);
    return text;
  });

  const conditional = three.createText({ font: inter, text: 'Reuse a rule', style: styles.body });
  conditional.position.set(-4.6, -0.04, 0);
  let active = false;
  const timer = setInterval(() => {
    active = !active;
    conditional.style = [styles.body, active && styles.emphasis];
  }, 1200);

  const colored = span({ color: '#ffd166' });
  const opaque = span({ opacity: 1 });
  const paragraph = three.createText({
    font: inter,
    text: txt`The paragraph is dim, ${colored`a colored span stays dim`}, ${opaque`an opaque span keeps the color`}.`,
    style: [styles.body, { fontSize: 0.3, lineHeight: 1.4, opacity: 0.4 }],
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 9.2 } },
  });
  paragraph.position.set(-4.6, -1.06, 0);

  const created = [...samples, conditional, paragraph];
  for (const text of created) scene.add(text);
  glyph.shape();

  return () => {
    clearInterval(timer);
    for (const text of created) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
