import { glyph } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BANDS, FONT_SIZE, GLYPH, SWEEP } from './config';
import { anatomyInk, sweep } from './materials';

/** The imperative twin: the same material on one large Slug glyph, and the sweep uniform stepped per frame. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:slug-anatomy', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: slug });
  await Inter.load();

  const letter = three.createText({
    font: Inter,
    text: GLYPH,
    material: anatomyInk,
    style: { fontSize: FONT_SIZE, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 8 } },
  });
  letter.position.set(-4, 2.55, 0);
  scene.add(letter);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    sweep.value = Math.floor(elapsed / SWEEP) % BANDS;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    letter.dispose();
    Inter.dispose();
    three.dispose();
  };
}
