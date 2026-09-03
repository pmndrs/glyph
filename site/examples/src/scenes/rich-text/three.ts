import { glyph, txt } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial, span } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/raster/slug';
import { color as tslColor } from 'three/tsl';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: `txt` and `span` where React uses nested Text. A span
 * takes styles and — from `/three` — one material; the document is the tree,
 * and no offset is ever written by hand.
 *
 * The React scene also gives one run its own face. `span(font)` still takes
 * the immutable `Font` that D-326 made private, so this twin cannot; the run
 * is the paragraph's face until spans take a face member.
 */
const tint = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph') material.colorNode = tslColor('#70d6ff').mul(context.shader.opacity);
  return material;
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:rich-text', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: slug });
  await inter.load();

  const accent = span({ color: '#ffd166' });
  const caps = span({ letterSpacing: 0.08, features: [{ tag: 'smcp' }] });
  const hand = span({ fontSize: 0.6 });
  const tinted = span(tint);

  const paragraph = three.createText({
    font: inter,
    text: txt`A paragraph is one shaped unit, and a ${accent`span`} is a range inside it. It may change the font — ${hand`glyph`} — the ${caps`style`}, or the ${tinted`material`} — and inherit everything it does not name.`,
    style: { fontSize: 0.42, color: '#e7ecf6', lineHeight: 1.35 },
    layout: { wrap: 'word', align: 'center' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  paragraph.position.set(-4.5, 1.4, 0);
  scene.add(paragraph);
  glyph.shape();

  return () => {
    paragraph.dispose();
    inter.dispose();
    three.dispose();
  };
}
