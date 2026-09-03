import { glyph, loadFont, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import {
  Group,
  Matrix4,
  Mesh,
  OrthographicCamera,
  RenderTarget,
  Scene,
  TorusKnotGeometry,
  type Renderer,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { circle, placeOnPath } from './knot';
import { pathInk, surfaceMaterial, surfaceScroll } from './materials';
import {
  RADIUS,
  REPEAT,
  RINGS,
  RING_TEXT,
  SURFACE,
  TUBE,
  passageAt,
  passageFrame,
  splitCurrentWord,
  wordIndexAt,
} from './scene';

/**
 * The imperative twin: a second Scene on a named root renders to a
 * RenderTarget before the main scene each frame; the tube wears its texture;
 * the rings are shaped once, broken apart, and placed by matrix; the strip is
 * `set({ text })` on every tick with the current word as a `span`.
 */
export async function mount(scene: Scene, renderer: Renderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:kinetic', ThreeConfig);
  const inter = await loadFont({ baked: INTER }, slug);
  const accent = span({ color: '#ffd166' });

  // The surface scene, on its own root: a root spans at most one Scene.
  const surface = new Scene();
  const camera = new OrthographicCamera(
    -SURFACE.width / 2,
    SURFACE.width / 2,
    SURFACE.height / 2,
    -SURFACE.height / 2,
    -10,
    10,
  );
  camera.position.z = 5;
  const target = new RenderTarget(SURFACE.width * SURFACE.pixelsPerUnit, SURFACE.height * SURFACE.pixelsPerUnit);
  const strip = handle('surface').createText({
    font: inter,
    text: '',
    style: { fontSize: 2.6, color: '#ffffff', letterSpacing: 0.02 },
    layout: { wrap: 'none', align: 'end' },
    constraints: { width: { mode: 'exact', size: SURFACE.width - 2 } },
  });
  strip.position.set(-SURFACE.width / 2 + 1, 1.3, 0);
  surface.add(strip);

  const knot = new Group();
  knot.position.set(1.6, 0.2, -1.2);
  const tube = new Mesh(new TorusKnotGeometry(RADIUS, TUBE, 320, 32, 2, 3), surfaceMaterial(target.texture, REPEAT));
  knot.add(tube);

  const rings = RINGS.map((spec) => {
    const holder = new Group();
    holder.position.set(1.6, 0.2, -1.2);
    holder.rotation.set(spec.tilt[0], spec.tilt[1], spec.tilt[2]);
    const band = handle.createText({
      font: inter,
      material: pathInk,
      text: RING_TEXT,
      style: { fontSize: spec.size, color: '#c9d3e8', letterSpacing: 0.06 },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 40 } },
    });
    holder.add(band);
    return { holder, band, path: circle(spec.radius), speed: spec.speed };
  });

  const spotlight = new Group();
  spotlight.position.set(-3.1, 2.05, 0.6);
  const spot = handle.createText({
    font: inter,
    text: '',
    style: { fontSize: 0.9, color: '#ffd166', letterSpacing: -0.02 },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 6 } },
  });
  spot.position.set(-3, 0.45, 0);
  spotlight.add(spot);

  scene.add(knot, ...rings.map((ring) => ring.holder), spotlight);
  glyph.shape(); // the bands commit here, so they can be copied
  const copies = rings.map((ring) => {
    const [glyphs] = ring.band.breakApart();
    ring.holder.add(glyphs);
    ring.band.visible = false;
    return { ...ring, glyphs, width: ring.band.measure().contentWidth };
  });

  const m = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  let lastWord = -1;
  let wordStarted = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    surfaceScroll.value = elapsed * 0.04;
    knot.rotation.set(0.9, elapsed * 0.12, 0.15);
    for (const ring of copies) {
      const offset = elapsed * ring.speed;
      for (let i = 0; i < ring.glyphs.count; i += 1) {
        const rest = ring.glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = (rest.originalMatrix.elements[12] ?? 0) * (ring.path.length / ring.width) + offset;
        ring.glyphs.setMatrixAt(i, placeOnPath(ring.path, s, 0, 0, rest.originalMatrix, m));
      }
    }

    const next = passageFrame(elapsed);
    const source = passageAt(next.passage);
    if (next.shown !== shown) {
      shown = next.shown;
      const typed = source.slice(0, shown);
      const { before, current } = splitCurrentWord(typed.slice(-46));
      strip.set({ text: txt`${before}${accent`${current}`}` });
      spot.set({ text: splitCurrentWord(typed).current });
    }
    const word = wordIndexAt(source, next.shown);
    if (word !== lastWord) {
      lastWord = word;
      wordStarted = elapsed;
    }
    spotlight.scale.setScalar(1 + 0.35 * Math.exp(-7 * (elapsed - wordStarted)));

    glyph.shape(); // every dirty root, both scenes, one call
    renderer.setRenderTarget(target);
    renderer.render(surface, camera);
    renderer.setRenderTarget(null);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const ring of copies) {
      ring.glyphs.dispose();
      ring.band.dispose();
    }
    strip.dispose();
    spot.dispose();
    tube.geometry.dispose();
    tube.material.dispose();
    target.dispose();
    inter.dispose();
    handle.dispose();
  };
}
