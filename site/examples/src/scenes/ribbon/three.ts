import { glyph } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph/raster/slug';
import { ThreeConfig, type Glyphs } from '@pmndrs/glyph/three';
import { Group, Matrix4, Mesh, Vector3, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { bandGeometry } from '../../lib/band';
import { curvePath, placeOnPath } from '../../lib/paths';
import { CURVE, LINE, REPEATS, RIBBON } from './config';
import { ribbonInk, ribbonMaterial } from './materials';

/**
 * The imperative twin: a flat band on an open curve facing the camera, one
 * line of text shaped once, copied out with `breakApart()` on commit, and
 * every frame each glyph is laid across the band by its advance plus time.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:ribbon', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: slug });
  await Inter.load();

  const path = curvePath(CURVE, new Vector3(0, 0, 1));
  const stage = new Group();
  const ribbon = new Mesh(bandGeometry(path, RIBBON.width, 480, false), ribbonMaterial());
  const line = three.createText({
    font: Inter,
    text: LINE.repeat(REPEATS),
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
    stage.rotation.y = Math.sin(elapsed * 0.3) * RIBBON.sway;
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
        // -π/2 lays the glyph across the band's width, centred on it, lifted a little toward the viewer.
        glyphs.setMatrixAt(
          i,
          placeOnPath(path, s, -Math.PI / 2, -RIBBON.size * 0.36, rest.originalMatrix, matrix, 0.03),
        );
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
