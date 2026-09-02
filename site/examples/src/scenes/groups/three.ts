import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: a `TextGroup` parents the ring so one rotation moves
 * every label; the root — the handle itself — owns the one planner they share.
 */
const COUNT = 48;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:groups', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const ring = three.createTextGroup({ renderOrder: 1 });
  const labels = Array.from({ length: COUNT }, (_, index) => {
    const angle = (index / COUNT) * Math.PI * 2;
    const label = three.createText({
      font: inter,
      text: `label ${String(index + 1).padStart(2, '0')}`,
      style: { fontSize: 0.16, color: index % 6 === 0 ? '#ffd166' : '#e7ecf6' },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 1.2 } },
    });
    label.position.set(Math.cos(angle) * 2.4 - 0.6, Math.sin(angle) * 2.4 + 0.08, 0);
    label.rotation.z = angle;
    ring.add(label);
    return label;
  });
  scene.add(ring);

  // Rotating the group is a transform-only change: no shaping, no Wasm.
  let frame = 0;
  const tick = (): void => {
    ring.rotation.z += 0.002;
    frame = requestAnimationFrame(tick);
  };
  glyph.shape();
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const label of labels) label.dispose();
    ring.dispose();
    inter.dispose();
    three.dispose();
  };
}
