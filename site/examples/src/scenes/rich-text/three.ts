import { glyph, txt } from '@pmndrs/glyph';
import { loadFont } from '@pmndrs/glyph/config/font-library';
import { ThreeConfig, defineTextMaterial, span } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/raster/slug';
import { color as tslColor } from 'three/tsl';
import type { Scene } from 'three/webgpu';

import { INTER, PLAYWRITE } from '../../fonts';

/**
 * The imperative twin: `txt` and `span` where React uses nested Text. A span
 * takes a loaded `Font`, styles, and — from `/three` — one material; the
 * document is the tree, and no offset is ever written by hand.
 *
 * A span's font shares the paragraph's raster format: the literal is typed by
 * one format, so both faces here are Slug. Mix formats with a stack on the
 * paragraph, not through spans.
 */
const tint = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph') material.colorNode = tslColor('#70d6ff').mul(context.shader.opacity);
  return material;
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:rich-text', ThreeConfig);
  // A span takes an immutable Font, which the face path does not hand out; the integrator loader does.
  const [inter, script] = await Promise.all([loadFont(INTER, slug), loadFont(PLAYWRITE, slug)]);

  const accent = span({ color: '#ffd166' });
  const caps = span({ letterSpacing: 0.08, features: [{ tag: 'smcp' }] });
  const hand = span(script, { fontSize: 0.6 });
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
    script.dispose();
    inter.dispose();
    three.dispose();
  };
}
