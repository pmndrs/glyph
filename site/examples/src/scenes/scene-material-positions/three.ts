import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial, type ThreeTextMaterialContext } from '@pmndrs/glyph/three';
import { color, mix, step } from 'three/tsl';
import type { Node, Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: one band material per position node. Move either
 * Text and only the `paragraphPosition` bands move with it.
 */
const FONT_SIZE = 0.44;
const LINE_HEIGHT = 1.3;
const PERIOD = FONT_SIZE * LINE_HEIGHT * 2;

const striped = (pick: (context: ThreeTextMaterialContext) => Node<'vec3'>) =>
  defineTextMaterial((context) => {
    const material = context.createDefaultMaterial();
    const band = step(0.5, pick(context).y.div(PERIOD).fract());
    material.colorNode = mix(color('#70d6ff'), color('#ffd166'), band);
    return material;
  });

const byParagraph = striped((context) => context.paragraphPosition);
const byDraw = striped((context) => context.position);

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:scene-material-positions', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = [byParagraph, byDraw].map((material, index) => {
    const text = three.createText({
      font: inter,
      text: 'Bands from a position node show which space the node is in.',
      material,
      style: { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT },
      layout: { wrap: 'word', align: 'center' },
      constraints: { width: { mode: 'exact', size: 3.6 }, anchor: { x: 'center', y: 'middle' } },
    });
    text.position.set(index === 0 ? -2.8 : 2.8, 0.3, 0);
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
