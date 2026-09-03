import { glyph, loadFont, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { Group, Matrix4, Mesh, MeshStandardNodeMaterial, TorusKnotGeometry, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { placeOnKnot } from './knot';
import { knotInk, wave, waveTime } from './materials';
import { BAND, KNOT, RADIUS, ROWS, TUBE, passageAt, passageFrame, splitCurrentWord, wordIndexAt } from './scene';

/**
 * The imperative twin: three bands are shaped once, broken apart, and their
 * copies placed on the knot by matrix every frame; the passage is
 * `set({ text, constraints })` on every tick and reshaped by `glyph.shape()`
 * with the current word as a `span` inside the same literal.
 */
const INK_HEIGHT = TUBE + 0.12; // the baseline rides just above the surface; descenders still clear it
const FLOW = 0.9;

export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:kinetic', ThreeConfig);
  const [interSlug, interMsdf] = await Promise.all([
    loadFont({ baked: INTER }, slug),
    loadFont({ baked: INTER }, msdf),
  ]);

  const knot = new Group();
  knot.position.set(2.3, 0.4, -1.4);
  const tube = new Mesh(
    new TorusKnotGeometry(RADIUS, TUBE, 320, 32, 2, 3),
    new MeshStandardNodeMaterial({ color: '#141a26', metalness: 0.25, roughness: 0.5 }),
  );
  knot.add(tube);
  const bands = Array.from({ length: ROWS }, () => {
    const band = three.createText({
      font: interSlug,
      material: knotInk,
      text: BAND + BAND,
      style: { fontSize: 0.42, color: '#dfe6f5', letterSpacing: 0.04 },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 60 } },
    });
    knot.add(band);
    return band;
  });

  const spotlight = new Group();
  spotlight.position.set(-3, 2.05, 0.6);
  const spot = three.createText({
    font: interSlug,
    text: '',
    style: { fontSize: 0.9, color: '#ffd166', letterSpacing: -0.02 },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 6 } },
  });
  spot.position.set(-3, 0.45, 0);
  spotlight.add(spot);

  const flag = new Group();
  flag.position.set(-5.3, -0.7, 0.3);
  flag.rotation.set(0, 0.1, 0);
  const accent = span({ color: '#ffd166' });
  const dim = span({ color: '#97a1b4' });
  const passage = three.createText({
    font: interMsdf,
    material: wave,
    text: '',
    style: { fontSize: 0.34, color: '#e7ecf6', lineHeight: 1.3 },
    layout: { wrap: 'word', align: 'start' },
    constraints: { width: { mode: 'exact', size: 7 } },
  });
  flag.add(passage);
  scene.add(knot, spotlight, flag);
  glyph.shape(); // the bands commit here, so they can be copied

  const rows = bands.map((band) => {
    const [glyphs] = band.breakApart();
    knot.add(glyphs);
    band.visible = false;
    return { glyphs, width: band.measure().contentWidth };
  });

  const m = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  let width = 7;
  let lastWord = -1;
  let wordStarted = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    waveTime.value = elapsed;
    knot.rotation.set(0.9, elapsed * 0.12, 0.15);
    for (const [row, { glyphs, width: bandWidth }] of rows.entries()) {
      const angle = (row / ROWS) * Math.PI * 2;
      const offset = elapsed * FLOW + row * (KNOT.length / ROWS) * 0.37;
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = ((rest.originalMatrix.elements[12] ?? 0) * (KNOT.length / bandWidth) + offset) % KNOT.length;
        glyphs.setMatrixAt(i, placeOnKnot(KNOT, s, angle, INK_HEIGHT, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    const source = passageAt(next.passage);
    const nextWidth = 5 + Math.sin(elapsed * 0.6) * 0.6;
    const { before, current } = splitCurrentWord(source.slice(0, next.shown));
    const caret = next.shown < source.length ? '|' : '';
    if (next.shown !== shown || Math.abs(nextWidth - width) > 0.04) {
      shown = next.shown;
      width = nextWidth;
      passage.set({
        text: txt`${before}${accent`${current}`}${dim`${caret}`}`,
        constraints: { width: { mode: 'exact', size: width } },
      });
      spot.set({ text: current });
      glyph.shape();
    }
    const word = wordIndexAt(source, next.shown);
    if (word !== lastWord) {
      lastWord = word;
      wordStarted = elapsed;
    }
    spotlight.scale.setScalar(1 + 0.35 * Math.exp(-7 * (elapsed - wordStarted)));
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const { glyphs } of rows) glyphs.dispose();
    for (const text of [...bands, spot, passage]) text.dispose();
    tube.geometry.dispose();
    tube.material.dispose();
    interSlug.dispose();
    interMsdf.dispose();
    three.dispose();
  };
}
