import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FLOW_PROSE } from '../layout-kit/prose';
import { flowFor } from './scene';

/**
 * The imperative twin: `flow` is assigned whole. Regions are matched by
 * `key`, so only the region whose geometry changed is composed again.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-flow-regions', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const text = three.createText({
    font: inter,
    text: FLOW_PROSE,
    style: { fontSize: 0.2, lineHeight: 1.35, color: '#e7ecf6' },
    flow: flowFor(2.4),
  });
  text.position.set(-4.95, 2.4, 0);
  scene.add(text);

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    text.flow = flowFor(2.4 + Math.sin(elapsed * 0.45) * 0.9);
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
