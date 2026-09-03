import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, worldToLocalMatrix } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Matrix4, Quaternion, Vector3, type Scene } from 'three/webgpu';

import { PLAYWRITE } from '../../fonts';

/**
 * The imperative twin: shape once so the word commits, break it apart, hide
 * the source, and animate the copy. Bulk writes invert the root once and go
 * through `worldToLocalMatrix`; `setWorldMatrixAt` is the one-off form.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:break-apart', ThreeConfig);
  const script = glyph.fontFace(PLAYWRITE, { format: slug });
  await script.load();

  const word = three.createText({
    font: script,
    text: 'glyph',
    style: { fontSize: 1.6, color: '#e7ecf6' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  word.position.set(-4.5, 0.8, 0);
  scene.add(word);
  glyph.shape(); // the copy needs a committed paragraph to copy from

  const [glyphs, decorations] = word.breakApart();
  scene.add(glyphs);
  if (decorations !== undefined) scene.add(decorations);
  word.visible = false;

  const inverse = new Matrix4();
  const world = new Matrix4();
  const local = new Matrix4();
  const p = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const out = (Math.sin(elapsed) + 1) / 2;
    glyphs.updateMatrixWorld();
    inverse.copy(glyphs.matrixWorld).invert();
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      if (rest === undefined) continue;
      rest.originalMatrix.decompose(p, q, s);
      p.y += out * (0.4 + (i % 3) * 0.3);
      world.compose(p, q, s).premultiply(glyphs.matrixWorld);
      worldToLocalMatrix(inverse, world, local);
      glyphs.setMatrixAt(i, local);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    glyphs.dispose();
    decorations?.dispose();
    word.dispose();
    script.dispose();
    three.dispose();
  };
}
