import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, positionLocal, uniform } from 'three/tsl';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ROWS } from './scene';

/**
 * The imperative twin: `decoration` is a style like any other, and a material
 * factory sees decorations as their own branch. The gradient's phase is a
 * uniform, so animating it never touches the material.
 */
const phase = uniform(0);
const gradientLine = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'decoration') {
    const t = positionLocal.x.mul(0.25).add(phase).fract();
    material.colorNode = mix(color('#ff4dc4'), color('#70d6ff'), t).mul(context.shader.opacity);
  }
  return material;
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:decorations', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const rows = [
    ...ROWS.map(([, decoration]) => ({ decoration })),
    { decoration: { underline: true, thickness: 0.06 }, material: gradientLine },
  ];
  const texts = rows.map((row, index) => {
    const text = three.createText({
      font: inter,
      text: 'Sphinx of black quartz',
      style: { fontSize: 0.34, color: '#e7ecf6', lineHeight: 1.1, decoration: row.decoration },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 7 } },
      ...('material' in row ? { material: row.material } : {}),
    });
    text.position.set(-3.2, 2.2 - index * 0.5 + 0.18, 0);
    return text;
  });
  scene.add(...texts);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    phase.value = elapsed * 0.3;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const text of texts) text.dispose();
    inter.dispose();
    three.dispose();
  };
}
