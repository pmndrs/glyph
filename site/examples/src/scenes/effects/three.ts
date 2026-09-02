import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { hueHex } from './scene';

/**
 * The imperative twin: outline and shadow are style, and a colour change is a
 * style assignment. A style colour is `#rrggbb`, `#rrggbbaa`, or a linear RGBA
 * tuple, so the animated hue is converted to hex before it is assigned.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:effects', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const outlined = three.createText({
    font: inter,
    text: 'outline',
    style: { fontSize: 0.9, color: '#e7ecf6', outline: { color: '#0a0c12', width: 0.05 } },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  outlined.position.set(-4.5, 1.9, 0);

  const shadowed = three.createText({
    font: inter,
    text: 'shadow',
    style: { fontSize: 0.9, color: '#e7ecf6', shadow: { color: [0, 0, 0, 0.7], offset: [0.06, -0.06] } },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  shadowed.position.set(-4.5, 0.6, 0);

  const animated = three.createText({
    font: inter,
    text: 'animated',
    style: { fontSize: 0.9, color: '#ffd166', outline: { color: '#0a0c12', width: 0.03 } },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  animated.position.set(-4.5, -0.7, 0);

  scene.add(outlined, shadowed, animated);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    // A colour is style; assigning it marks the paragraph dirty and the next shape() republishes it.
    animated.style = { ...animated.style, color: hueHex((elapsed * 24) % 360) };
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const text of [outlined, shadowed, animated]) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
