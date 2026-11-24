import { glyph, type TextAnchorY } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { HEIGHT } from './scene';

/**
 * The imperative twin: where each `anchor.y` token falls, measured from the
 * top of the paragraph box in paragraph-local units (+Y down).
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-anchor-references', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Glyph\nbox',
    style: { fontSize: 1.15, lineHeight: 1.25, color: '#e7ecf6' },
    constraints: { height: { mode: 'exact', size: HEIGHT } },
  });
  text.position.set(-4.7, HEIGHT / 2, 0);
  scene.add(text);

  const layout = text.measure();
  const references: Record<TextAnchorY, number> = {
    top: 0,
    middle: layout.height / 2,
    bottom: layout.height,
    'first-baseline': layout.firstBaseline,
    'last-baseline': layout.lastBaseline,
    'alphabetic-baseline': layout.alphabeticBaseline,
    'ideographic-baseline': layout.ideographicBaseline,
    'cap-height-top': layout.capHeightTop,
    'x-height-top': layout.xHeightTop,
  };
  void references; // draw a guide at y = -value in the text's local frame
  glyph.shape();

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
