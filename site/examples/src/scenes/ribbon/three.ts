import { glyph } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig, type Glyphs } from '@pmndrs/glyph/three';
import { Group, Matrix4, Mesh, TubeGeometry, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { curvePath, placeOnPath } from '../../lib/paths';
import { CURVE, LINE, RIBBON } from './config';
import { ribbonInk, ribbonMaterial } from './materials';

/**
 * The imperative twin: a tube on the curve, one line of text shaped once,
 * copied out with `breakApart()` on commit, and every frame each glyph is
 * placed on the same curve by its advance plus time.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:ribbon', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: slug });
  await Inter.load();

  const path = curvePath(CURVE);
  const stage = new Group();
  stage.rotation.set(0.22, 0, 0.06);
  const ribbon = new Mesh(new TubeGeometry(CURVE, 480, RIBBON.radius, 14, true), ribbonMaterial());
  const line = three.createText({
    font: Inter,
    text: LINE.repeat(3),
    material: ribbonInk,
    style: { fontSize: RIBBON.size, color: '#e7ecf6', letterSpacing: RIBBON.letterSpacing },
    layout: { wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 200 } },
  });
  stage.add(ribbon, line);
  scene.add(stage);
  glyph.shape();

  let glyphs: Glyphs | undefined;
  let width = 0;
  const matrix = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    if (glyphs === undefined && line.commitState().status === 'committed') {
      [glyphs] = line.breakApart();
      width = line.measure().contentWidth;
      line.visible = false;
      stage.add(glyphs);
    }
    if (glyphs !== undefined) {
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / width) + elapsed * RIBBON.speed;
        glyphs.setMatrixAt(i, placeOnPath(path, s, 0, RIBBON.radius + 0.02, rest.originalMatrix, matrix));
      }
    }
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    glyphs?.dispose();
    line.dispose();
    ribbon.geometry.dispose();
    ribbon.material.dispose();
    Inter.dispose();
    three.dispose();
  };
}
