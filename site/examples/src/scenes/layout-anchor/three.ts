import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ANCHORS, COLUMNS } from './scene';

/**
 * The imperative twin: `position` is where the anchor goes. `anchorOffset`
 * is the translation the anchor applied, in paragraph-local units (+Y down).
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-anchor', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const texts = ANCHORS.map((anchor, column) => {
    const text = three.createText({
      font: inter,
      text: 'Anchor\npoint',
      style: { fontSize: 0.62, lineHeight: 1.15, color: '#e7ecf6' },
      constraints: { anchor },
    });
    text.position.set(COLUMNS[column]!, 0, 0);
    text.rotation.z = 0.22; // rotates about the anchor, because the anchor is at the object's origin
    scene.add(text);
    const { anchorOffset, width, height } = text.measure();
    // The measured box in the text's local frame: x from anchorOffset.x, y (up) from -anchorOffset.y down.
    void [anchorOffset.x, -anchorOffset.y, width, height];
    return text;
  });
  glyph.shape();

  return () => {
    for (const text of texts) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
