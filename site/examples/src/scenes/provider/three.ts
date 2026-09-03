import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: `handle(name)` is the named root a provider string
 * selects, and the same name is the same root. Every root attaches one draw
 * object named `@pmndrs/glyph:<name>` to the scene it draws in; a text on the
 * handle itself draws on its anonymous root.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:provider', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const left = three('left');
  const right = three('right');
  const again = three('left'); // idempotent: the same root, not a second one
  void (again === left);

  const style = { fontSize: 0.5, color: '#e7ecf6' };
  const a = left.createText({
    font: inter,
    text: 'handle("left")',
    style: { ...style, color: '#ffd166' },
    layout: { wrap: 'none' },
  });
  const b = right.createText({
    font: inter,
    text: 'handle("right")',
    style: { ...style, color: '#70d6ff' },
    layout: { wrap: 'none' },
  });
  const c = again.createText({
    font: inter,
    text: 'handle("left") again: the same root',
    style: { ...style, color: '#ffd166' },
    layout: { wrap: 'none' },
  });
  const d = three.createText({ font: inter, text: 'the anonymous root', style, layout: { wrap: 'none' } });
  a.position.set(-5.2, 1.9, 0);
  b.position.set(0.6, 1.9, 0);
  c.position.set(-5.2, 1.0, 0);
  d.position.set(-5.2, -0.1, 0);
  scene.add(a, b, c, d);
  glyph.shape();

  // Read the roots back off the scene: one object per root, one child per planned draw.
  const roots: string[] = [];
  scene.traverse((object) => {
    if (object.name.startsWith('@pmndrs/glyph:')) roots.push(`${object.name} (${object.children.length})`);
  });
  void roots; // three entries: left, right, anonymous

  return () => {
    for (const text of [a, b, c, d]) text.dispose();
    inter.dispose();
    three.dispose(); // disposes its roots with it
  };
}
