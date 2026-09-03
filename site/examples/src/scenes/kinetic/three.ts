import { glyph, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import {
  Group,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  TorusKnotGeometry,
  type Renderer,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { circle, placeOnPath } from '../../lib/paths';
import { groundMaterial, pathInk, surfaceMaterial, surfaceScroll } from './materials';
import { lastWord, passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { RADIUS, REPEAT, RING, RING_TEXT, TILE, TUBE } from './config';

/**
 * The imperative twin: a second Scene on a named root renders one word to a
 * RenderTarget before the main scene each frame; the knot wears its texture;
 * the ring is shaped once, broken apart, and placed by matrix; the tile and
 * the passage line are `set({ text })` on every tick.
 */
export async function mount(scene: Scene, renderer: Renderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:kinetic', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: [slug, msdf] });
  await inter.load();
  const accent = span({ color: '#ffd166' });
  const dim = span({ color: '#97a1b4' });

  // The tile scene, on its own root: a root spans at most one Scene.
  const tile = new Scene();
  const camera = new OrthographicCamera(-TILE.width / 2, TILE.width / 2, TILE.height / 2, -TILE.height / 2, -10, 10);
  camera.position.z = 5;
  const target = new RenderTarget(TILE.width * TILE.pixelsPerUnit, TILE.height * TILE.pixelsPerUnit);
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  const word = handle('tile').createText({
    font: inter.slug,
    text: '',
    style: { fontSize: 0.92, color: '#ffffff', letterSpacing: 0.02 },
    layout: { wrap: 'none', align: 'center' },
    constraints: { width: { mode: 'exact', size: TILE.width } },
  });
  word.position.set(-TILE.width / 2, 0.44, 0);
  tile.add(word);

  const ground = new Mesh(new PlaneGeometry(60, 34), groundMaterial());
  ground.position.z = -9;
  const knot = new Group();
  knot.position.set(0.3, 0.25, -1.4);
  const tube = new Mesh(new TorusKnotGeometry(RADIUS, TUBE, 400, 40, 2, 3), surfaceMaterial(target.texture, REPEAT));
  knot.add(tube);

  const orbit = new Group();
  orbit.position.set(0.3, 0.25, -1.4);
  orbit.rotation.set(RING.tilt[0], RING.tilt[1], RING.tilt[2]);
  const band = handle.createText({
    font: inter.slug,
    material: pathInk,
    text: RING_TEXT,
    style: { fontSize: RING.size, color: '#b6c0d6', letterSpacing: 0.08 },
    layout: { wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 40 } },
  });
  orbit.add(band);

  const line = handle.createText({
    font: inter.msdf,
    text: '',
    style: { fontSize: 0.26, color: '#97a1b4', lineHeight: 1.3 },
    layout: { wrap: 'word', align: 'start' },
    constraints: { width: { mode: 'exact', size: 7.5 } },
  });
  line.position.set(-5.2, -2.25, 0.5);

  scene.add(ground, knot, orbit, line);
  glyph.shape(); // the band commits here, so it can be copied
  const [glyphs] = band.breakApart();
  orbit.add(glyphs);
  band.visible = false;
  const bandWidth = band.measure().contentWidth;
  const path = circle(RING.radius);

  const m = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  const tick = (): void => {
    elapsed += 1 / 60;
    surfaceScroll.value = elapsed * 0.06;
    knot.rotation.set(0.85 + Math.sin(elapsed * 0.17) * 0.2, elapsed * 0.11, 0.2);
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      if (rest === undefined) continue;
      const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / bandWidth) + elapsed * RING.speed;
      glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
    }

    const next = passageFrame(elapsed);
    const source = passageAt(next.passage);
    if (next.shown !== shown) {
      shown = next.shown;
      const typed = source.slice(0, shown);
      const { before, current } = splitCurrentWord(typed);
      const caret = shown < source.length ? '|' : '';
      word.set({ text: (current || lastWord(before)).replace(/[^A-Za-z]/g, '').toUpperCase() });
      line.set({ text: txt`${before}${accent`${current}`}${dim`${caret}`}` });
    }

    glyph.shape(); // every dirty root, both scenes, one call
    renderer.setRenderTarget(target);
    renderer.render(tile, camera);
    renderer.setRenderTarget(null);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    glyphs.dispose();
    for (const text of [band, word, line]) text.dispose();
    for (const mesh of [tube, ground]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    target.dispose();
    inter.dispose();
    handle.dispose();
  };
}
