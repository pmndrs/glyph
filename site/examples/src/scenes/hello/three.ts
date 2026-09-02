import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin of `scene.tsx`. Typechecked beside it, never run here:
 * it exists so the page can show the three.js parallel of the React scene.
 *
 * R3F did four things for the component that are explicit here: `glyph.init()`,
 * a handle, the FontFace load, and `glyph.shape()` before every render.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:hello', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const label = three.createText({
    font: inter,
    text: 'Hello world',
    style: { fontSize: 0.8, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 8 } },
  });
  label.position.set(-4, 0.4, 0);
  scene.add(label);
  glyph.shape(); // then renderer.render(scene, camera)

  return () => {
    label.dispose();
    inter.dispose();
    three.dispose();
  };
}
