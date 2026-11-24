import { glyph, span, txt } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BODY, CAP_SIZE, CAPS, WIDTH } from './scene';

/**
 * The imperative twin: the cap is a span with its own font size at the start
 * of the text; `layout.dropCap` reserves the body lines beside it.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-drop-cap', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = CAPS.map(([, dropCap], column) => {
    const text = three.createText({
      font: inter,
      text: txt`${span({ fontSize: CAP_SIZE, color: '#ffd166' })`A`}${BODY}`,
      style: { fontSize: 0.2, lineHeight: 1.35, color: '#e7ecf6' },
      layout: { dropCap: { marginInline: 0.06, ...dropCap } },
      constraints: { width: { mode: 'exact', size: WIDTH } },
    });
    text.position.set(-5.25 + column * 2.68, 1.25, 0);
    scene.add(text);
    return text;
  });
  glyph.shape();

  return () => {
    for (const text of texts) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
