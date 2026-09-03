import { glyph } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { ThreeConfig } from '@pmndrs/glyph/three';
import {
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  RenderTarget,
  Scene,
  type WebGPURenderer,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { DEPTH, FONT_SIZE, HOLD, TILE, WORDS } from './config';
import { heightInk, slabMaterial } from './materials';

/**
 * The imperative twin: a named root for the tile scene, a text with the
 * height material on it, a render target the slab reads, and a loop that
 * renders the tile before the caller renders the scene.
 */
export async function mount(scene: Scene, renderer: WebGPURenderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:relief', ThreeConfig);
  const tileRoot = handle('tile');
  const Inter = glyph.fontFace(INTER, { format: msdf });
  await Inter.load();

  const tileScene = new Scene();
  const camera = new OrthographicCamera(-TILE.width / 2, TILE.width / 2, TILE.height / 2, -TILE.height / 2, -10, 10);
  camera.position.z = 5;
  const target = new RenderTarget(TILE.width * TILE.pixelsPerUnit, TILE.height * TILE.pixelsPerUnit);
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  const word = tileRoot.createText({
    font: Inter,
    text: WORDS[0],
    material: heightInk,
    style: { fontSize: FONT_SIZE, color: '#ffffff', letterSpacing: 0.04 },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: TILE.width } },
  });
  word.position.set(-TILE.width / 2, FONT_SIZE / 2 + 0.35, 0);
  tileScene.add(word);

  const slab = new Mesh(
    new PlaneGeometry(TILE.width * 0.9, TILE.height * 0.9, 300, 100),
    slabMaterial(target.texture, DEPTH),
  );
  slab.rotation.x = -0.35;
  const light = new PointLight('#fff1dc', 12, 14, 2);
  scene.add(slab, light);
  glyph.shape();

  let shown: string = WORDS[0];
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const next = WORDS[Math.floor(elapsed / HOLD) % WORDS.length] ?? WORDS[0];
    if (next !== shown) {
      shown = next;
      word.set({ text: shown });
    }
    const a = elapsed * 0.7;
    light.position.set(Math.cos(a) * 4.5, 2.2 + Math.sin(a * 0.5) * 0.6, 2.6 + Math.sin(a) * 1.6);
    glyph.shape();
    renderer.setRenderTarget(target);
    renderer.render(tileScene, camera);
    renderer.setRenderTarget(null);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    word.dispose();
    target.dispose();
    slab.geometry.dispose();
    slab.material.dispose();
    Inter.dispose();
    handle.dispose();
  };
}
