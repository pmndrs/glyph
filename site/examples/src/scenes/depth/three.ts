import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { Mesh, MeshStandardNodeMaterial, SphereGeometry, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: the same factory, handed to `createText` as `material`.
 * Only `depthTest` changes; `depthWrite` stays off so the transparent quad
 * never writes a rectangle into the depth buffer.
 */
const inScene = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  return material;
});

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:depth', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const ball = new Mesh(
    new SphereGeometry(0.9, 48, 32),
    new MeshStandardNodeMaterial({ color: '#ffd166', metalness: 0.1, roughness: 0.35 }),
  );

  const occluded = three.createText({
    font: inter,
    material: inScene,
    text: 'occluded',
    style: { fontSize: 1.05, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 5 } },
  });
  occluded.position.set(-5.25, 0.55, 0);

  const overlaid = three.createText({
    font: inter,
    text: 'overlaid',
    style: { fontSize: 1.05, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 5 } },
  });
  overlaid.position.set(0.25, 0.55, 0);

  scene.add(ball, occluded, overlaid);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const t = elapsed * 0.6;
    ball.position.set(Math.sin(t) * 3.4, 0.15, Math.cos(t) * 1.4);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    occluded.dispose();
    overlaid.dispose();
    ball.geometry.dispose();
    ball.material.dispose();
    inter.dispose();
    three.dispose();
  };
}
