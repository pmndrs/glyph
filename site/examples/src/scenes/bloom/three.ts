import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';
import { PostProcessing, type Camera, type Renderer, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: `PostProcessing` replaces `renderer.render`. The text
 * is in the scene pass like any mesh; bloom reads the pass texture and never
 * knows it is text. Render with `post.render()` after `glyph.shape()`.
 */
export async function mount(scene: Scene, camera: Camera, renderer: Renderer): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:bloom', ThreeConfig);
  const inter = glyph.fontFace({ baked: INTER });
  await inter.load();

  const headline = three.createText({
    font: inter,
    text: 'words that shine',
    style: { fontSize: 1.1, color: '#4b5568' },
    layout: { align: 'center', wrap: 'none' },
    constraints: { width: { mode: 'exact', size: 10 } },
  });
  headline.position.set(-5, 0.75, 0);
  scene.add(headline);
  glyph.shape();

  const scenePass = pass(scene, camera);
  const glow = bloom(scenePass.getTextureNode(), 0.9, 0.4, 0.55);
  const post = new PostProcessing(renderer);
  post.outputNode = scenePass.getTextureNode().add(glow);

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    glow.strength.value = 0.75 + Math.sin(elapsed * 1.4) * 0.45;
    glyph.shape();
    void post.render();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    post.dispose();
    headline.dispose();
    inter.dispose();
    three.dispose();
  };
}
