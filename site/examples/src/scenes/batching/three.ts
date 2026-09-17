import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { color as tslColor } from 'three/tsl';
import { Group, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: `handle(name)` returns an idempotent named root and
 * `root.createTextGroup()` is the batching boundary. Children are planned in
 * order, so a material change is a draw boundary; sort by material and the
 * runs fold.
 */
const COLUMNS = 5;
const ROWS = 6;

const tint = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind === 'glyph') material.colorNode = tslColor('#70d6ff').mul(context.shader.opacity);
  return material;
});

const tinted = (index: number): boolean => index % 2 === 1;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:batching', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const field = (root: ReturnType<typeof handle>, order: readonly number[], x: number) => {
    const group = root.createTextGroup();
    for (const [slot, index] of order.entries()) {
      const label = root.createText({
        font: inter,
        ...(tinted(index) ? { material: tint } : {}),
        text: String(index + 1).padStart(2, '0'),
        style: { fontSize: 0.34, color: '#e7ecf6' },
        layout: { align: 'center', wrap: 'none' },
        constraints: { width: { mode: 'exact', size: 0.9 } },
      });
      label.position.set((slot % COLUMNS) * 0.9, 2.4 - Math.floor(slot / COLUMNS) * 0.62, 0);
      group.add(label);
    }
    const holder = new Group();
    holder.position.x = x;
    holder.add(group);
    return { holder, group };
  };

  const interleaved = Array.from({ length: COLUMNS * ROWS }, (_, index) => index);
  const sorted = [...interleaved].sort((a, b) => Number(tinted(a)) - Number(tinted(b)));
  const left = field(handle('interleaved'), interleaved, -5.1);
  const right = field(handle('sorted'), sorted, 0.6);
  scene.add(left.holder, right.holder);
  glyph.shape();

  return () => {
    left.group.dispose();
    right.group.dispose();
    inter.dispose();
    handle.dispose();
  };
}
