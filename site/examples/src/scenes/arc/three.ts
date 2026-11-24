import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Matrix4, Quaternion, Vector3, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: shape once so the line commits, take its measured
 * `contentWidth` as the circumference, break it apart, and write one matrix per glyph
 * in `Glyphs`-local space — no world-space round trip is needed when the
 * ring itself is what moves.
 */
const TEXT = 'one matrix per glyph * breakApart() * one matrix per glyph * breakApart() * ';

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:arc', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const line = three.createText({
    font: inter,
    text: TEXT,
    style: { fontSize: 0.46, color: '#e7ecf6', letterSpacing: 0.01 },
    layout: { align: 'start', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 30 } },
  });
  line.position.set(0, 0.15, 0);
  scene.add(line);
  glyph.shape();

  const radius = line.measure().contentWidth / (Math.PI * 2);
  const [glyphs, decorations] = line.breakApart();
  scene.add(glyphs);
  if (decorations !== undefined) scene.add(decorations);
  line.visible = false;
  glyphs.rotation.x = 0.32;

  const m = new Matrix4();
  const home = new Vector3();
  const q = new Quaternion();
  const s = new Vector3();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  for (let i = 0; i < glyphs.count; i += 1) {
    const rest = glyphs.measurements[i];
    if (rest === undefined) continue;
    rest.originalMatrix.decompose(home, q, s);
    const angle = home.x / radius;
    turn.setFromAxisAngle(up, angle);
    m.compose(new Vector3(Math.sin(angle) * radius, home.y, Math.cos(angle) * radius), turn.multiply(q), s);
    glyphs.setMatrixAt(i, m);
  }

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    glyphs.rotation.y = -elapsed * 0.35;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    glyphs.dispose();
    decorations?.dispose();
    line.dispose();
    inter.dispose();
    three.dispose();
  };
}
