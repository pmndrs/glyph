import { glyph, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import {
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  TorusKnotGeometry,
  type Renderer,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { groundMaterial, surfaceMaterial, surfaceScroll } from './materials';
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { RADIUS, REPEAT, STRIP, STRIP_FONT, TUBE } from './config';

/**
 * The imperative twin: a second Scene on a named root renders the typed
 * passage to a wide RenderTarget before the main scene each frame; the knot
 * wears its texture; the strip and the passage line are `set({ text })` on
 * every tick.
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
    style: { fontSize: STRIP_FONT, color: '#ffffff', letterSpacing: 0.04, lineHeight: 1 },
    layout: { wrap: 'none', align: 'end' }, // the newest word at the strip's right edge
    constraints: { width: { mode: 'exact', size: STRIP.width } },
  });
  strip.position.set(-STRIP.width / 2, STRIP_FONT / 2, 0);
  tile.add(strip);

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

  scene.add(ground, knot, line);
  let frame = 0;
  let elapsed = 0;
  let shown = -1;
  const tick = (): void => {
    elapsed += 1 / 60;
    surfaceScroll.value = elapsed * 0.06;
    knot.rotation.set(0.95 + Math.sin(elapsed * 0.15) * 0.18, elapsed * 0.1, 0.25);

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
    for (const text of [strip, line]) text.dispose();
    for (const mesh of [tube, ground]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    target.dispose();
    inter.dispose();
    handle.dispose();
  };
}
