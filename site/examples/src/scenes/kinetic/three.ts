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
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import {
  BIG_FONT,
  KNOT_POSITION,
  RADIUS,
  REPEAT,
  RINGS,
  RING_LETTER_SPACING,
  ringText,
  SMALL_FONT,
  SMALL_LANE_Y,
  SMALL_LETTER_SPACING,
  SMALL_REPEATS,
  SMALL_TEXT,
  STRIP,
  TUBE,
} from './config';

/**
 * After "Kinetic Typography with Three.js" by Mario Carrillo for Codrops
 * (2020, https://tympanus.net/codrops/2020/06/02/kinetic-typography-with-three-js/).
 *
 * The imperative twin: a second Scene on a named root renders the typed
 * passage and two small lanes to a RenderTarget before the main scene each
 * frame; the knot wears its texture; two rings are shaped once, broken
 * apart, and placed by matrix on tumbling circles; the strip and the passage
 * line are `set({ text })` on every tick.
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
  const camera = new OrthographicCamera(
    -STRIP.width / 2,
    STRIP.width / 2,
    STRIP.height / 2,
    -STRIP.height / 2,
    -10,
    10,
  );
  camera.position.z = 5;
  const target = new RenderTarget(
    Math.round(STRIP.width * STRIP.pixelsPerUnit),
    Math.round(STRIP.height * STRIP.pixelsPerUnit),
  );
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  const strip = handle('tile').createText({
    font: inter.slug,
    text: '',
    style: { fontSize: BIG_FONT, color: '#ffffff', letterSpacing: 0.04, lineHeight: 1 },
    layout: { wrap: 'none', align: 'end' }, // the newest word at the strip's right edge
    constraints: { width: { mode: 'exact', size: STRIP.width } },
  });
  strip.position.set(-STRIP.width / 2, BIG_FONT / 2, 0); // the middle lane
  tile.add(strip);
  const lanes = [SMALL_LANE_Y, -SMALL_LANE_Y].map((y, lane) => {
    const small = handle('tile').createText({
      font: inter.slug,
      text: SMALL_TEXT.repeat(SMALL_REPEATS),
      style: { fontSize: SMALL_FONT, color: '#9aa6be', letterSpacing: SMALL_LETTER_SPACING, lineHeight: 1 },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: STRIP.width * 2 } },
    });
    small.position.set(-STRIP.width / 2 - (lane === 0 ? 0 : STRIP.width * 0.37), y + SMALL_FONT / 2, 0);
    tile.add(small);
    return small;
  });

  const ground = new Mesh(new PlaneGeometry(60, 34), groundMaterial());
  ground.position.z = -9;
  const knot = new Group();
  knot.position.set(0, 0.1, -1);
  const tube = new Mesh(new TorusKnotGeometry(RADIUS, TUBE, 400, 40, 2, 3), surfaceMaterial(target.texture, REPEAT));
  knot.add(tube);

  const line = handle.createText({
    font: inter.msdf,
    text: '',
    style: { fontSize: 0.26, color: '#97a1b4', lineHeight: 1.3 },
    layout: { wrap: 'word', align: 'center' },
    constraints: { width: { mode: 'exact', size: 9 } },
  });
  line.position.set(-4.5, -2.25, 0.5);

  // Two rings on circles around the knot, shaped once and copied out; their groups tumble every frame.
  const rings = RINGS.map((ring) => {
    const orbit = new Group();
    orbit.position.set(KNOT_POSITION[0], KNOT_POSITION[1], KNOT_POSITION[2]);
    const band = handle.createText({
      font: inter.slug,
      material: pathInk,
      text: ringText(ring), // about the circle's length, so the advance-to-arc mapping stays near one
      style: { fontSize: ring.size, color: '#d3dbea', letterSpacing: RING_LETTER_SPACING },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 40 } },
    });
    orbit.add(band);
    return { ring, orbit, band, path: circle(ring.radius) };
  });
  scene.add(ground, knot, line, ...rings.map((r) => r.orbit));
  glyph.shape(); // the bands commit here, so they can be copied
  const copies = rings.map((r) => {
    const [glyphs] = r.band.breakApart();
    r.orbit.add(glyphs);
    r.band.visible = false;
    return { ...r, glyphs, width: r.band.measure().contentWidth };
  });
  const m = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  const tick = (): void => {
    elapsed += 1 / 60;
    surfaceScroll.value = elapsed * 0.06;
    knot.rotation.set(0.95 + Math.sin(elapsed * 0.15) * 0.18, elapsed * 0.1, 0.25);
    for (const { ring, orbit, glyphs, width, path } of copies) {
      const [wobble, turn] = ring.spin;
      orbit.rotation.set(
        0.9 + Math.sin(elapsed * wobble + ring.phase) * 0.7,
        elapsed * turn,
        Math.cos(elapsed * wobble * 0.7 + ring.phase) * 0.5,
      );
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = (rest.originalMatrix.elements[12] ?? 0) * (path.length / width) + elapsed * ring.speed;
        glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    const source = passageAt(next.passage);
    if (next.shown !== shown) {
      shown = next.shown;
      const typed = source.slice(0, shown);
      const { before, current } = splitCurrentWord(typed);
      const caret = shown < source.length ? '|' : '';
      strip.set({ text: txt`${before.toUpperCase()}${accent`${current.toUpperCase()}`}   ` });
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
    for (const { glyphs, band } of copies) {
      glyphs.dispose();
      band.dispose();
    }
    for (const text of [strip, ...lanes, line]) text.dispose();
    for (const mesh of [tube, ground]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    target.dispose();
    inter.dispose();
    handle.dispose();
  };
}
