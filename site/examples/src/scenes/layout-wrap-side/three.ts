import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { LONG_PROSE } from '../layout-kit/prose';
import { flowBeside, PANEL, panelPosition, SIDES } from './scene';

/** The imperative twin: four texts, one per `wrapSide`, around the same rectangle. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-wrap-side', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = SIDES.map((wrapSide, index) => {
    const text = three.createText({
      font: inter,
      text: LONG_PROSE,
      style: { fontSize: 0.17, lineHeight: 1.35, color: '#e7ecf6' },
      flow: flowBeside(wrapSide, PANEL[0] / 2),
    });
    const [x, y] = panelPosition(index);
    text.position.set(x, y, 0);
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
