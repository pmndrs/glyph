import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/** The imperative twin of `scene.tsx`: the same paragraph, measured and centred on ink. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:first-text', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const label = three.createText({
    font: inter,
    text: 'The quick brown fox jumps over the lazy dog',
    style: { fontSize: 0.6, color: '#ffd166', letterSpacing: 0.02 },
    layout: { wrap: 'word', align: 'center' },
    constraints: { width: { mode: 'at-most', size: 6 } },
  });
  scene.add(label);

  // Measurement answers for desired state before anything is shaped for the GPU.
  const ink = label.measure().inkBounds;
  if (ink !== undefined) label.position.set(-(ink.x + ink.width / 2), ink.y + ink.height / 2, 0);

  glyph.shape();

  return () => {
    label.dispose();
    inter.dispose();
    three.dispose();
  };
}
