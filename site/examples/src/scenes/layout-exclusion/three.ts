import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FLOW_PROSE } from '../layout-kit/prose';
import { disc, flowAround, RADIUS } from './scene';

/**
 * The imperative twin: a new `flow` each frame with the same region and
 * exclusion keys. A stable key lets the engine treat it as the same shape
 * that moved.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-exclusion', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const text = three.createText({
    font: inter,
    text: FLOW_PROSE,
    style: { fontSize: 0.2, lineHeight: 1.35, color: '#e7ecf6' },
    flow: flowAround(disc(4.1, 1.6, RADIUS)),
  });
  text.position.set(-4.1, 1.85, 0);
  scene.add(text);

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    text.flow = flowAround(disc(4.1 + Math.sin(elapsed * 0.4) * 2.6, 1.6 + Math.sin(elapsed * 0.67) * 0.7, RADIUS));
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
