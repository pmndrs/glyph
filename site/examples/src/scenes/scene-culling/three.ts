import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { vec3 } from 'three/tsl';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin. Culling needs no call: every draw carries a bound
 * computed from the records it places. A material that moves vertices says
 * how far with `boundsPadding`; `frustumCulled = false` on a Text opts it out.
 */
const SHIFT = 4;

const declared = defineTextMaterial(
  (context) => {
    const material = context.createDefaultMaterial();
    material.positionNode = context.position.add(vec3(-SHIFT, 0, 0));
    return material;
  },
  { boundsPadding: SHIFT },
);

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:scene-culling', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  // Each `batching: 'group'` boundary is its own draw, culled on its own.
  const groups = ['label one', 'label two', 'label three'].map((text, index) => {
    const group = three.createTextGroup({ batching: 'group' });
    const label = three.createText({ font: inter, text, style: { fontSize: 0.42 } });
    group.add(label);
    group.position.set(8 * (index - 1), 2.35 - index * 0.6, 0);
    scene.add(group);
    return { group, label };
  });

  const shifted = three.createText({ font: inter, text: 'shifted', material: declared, style: { fontSize: 0.6 } });
  shifted.position.x = 6; // off-frame; the padded bound still reaches the displaced glyphs
  scene.add(shifted);

  const pinned = three.createText({ font: inter, text: 'always submitted', style: { fontSize: 0.3 } });
  pinned.frustumCulled = false;
  scene.add(pinned);
  glyph.shape();

  return () => {
    for (const { group, label } of groups) {
      label.dispose();
      group.dispose();
    }
    shifted.dispose();
    pinned.dispose();
    inter.dispose();
    three.dispose();
  };
}
