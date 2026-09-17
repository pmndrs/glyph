import { createElement } from 'react';
import * as THREE from 'three/webgpu';
import { glyph, bitmap } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/react';
import { createRoot, flushSync } from '@glyph-test/fiber';
import fontUrl from './inter-bitmap-16.font.glb?url';

window.r3fCompatibility = run();

async function run() {
  const query = new URLSearchParams(location.search);
  const webgpuEntry = query.get('entry') === 'webgpu';
  await glyph.init();
  const face = glyph.fontFace(fontUrl, { format: bitmap({ strikes: [16] }) });
  await face.bitmap.load();
  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, forceWebGL: query.get('backend') === 'webgl2' });
  const camera = new THREE.OrthographicCamera(-16, 240, 64, -64, 0.1, 100);
  camera.position.z = 10;
  const root = createRoot(canvas);
  const target = new THREE.RenderTarget(256, 128);
  let text;
  let group;
  try {
    const factory = async () => {
      await renderer.init();
      return renderer;
    };
    await root.configure({
      ...(webgpuEntry ? { renderer: factory } : { gl: factory }),
      camera,
      frameloop: 'never',
      dpr: 1,
      size: { width: 256, height: 128, top: 0, left: 0 },
    });
    const backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    if (backend !== query.get('backend')) throw new Error(`Expected ${query.get('backend')}, got ${backend}`);
    let committed = Promise.withResolvers();
    const tree = (content) =>
      createElement(
        TextGroup,
        {
          ref: (value) => {
            if (value) group = value;
          },
        },
        createElement(
          Text,
          {
            font: face.bitmap,
            style: { fontSize: 16, color: '#ffffff' },
            ref: (value) => {
              if (value) {
                text = value;
                committed.resolve();
              }
            },
          },
          content,
        ),
      );
    let store;
    flushSync(() => {
      store = root.render(tree('W'));
    });
    await committed.promise;
    const firstText = text;
    const scene = store.getState().scene;
    const initial = await capture();
    committed = Promise.withResolvers();
    flushSync(() => root.render(tree('WWW')));
    await committed.promise;
    if (text !== firstText) throw new Error('Text was replaced on update');
    const updated = await capture();
    if (initial.litPixels === 0 || updated.litPixels <= initial.litPixels)
      throw new Error(`Text did not render and grow: ${JSON.stringify({ initial, updated })}`);
    return { backend, initial, updated, retainedText: true };

    async function capture() {
      glyph.shape();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 128);
      let litPixels = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) litPixels++;
      return { litPixels };
    }
  } finally {
    text?.dispose();
    group?.dispose();
    flushSync(() => root.unmount());
    face.dispose();
    target.dispose();
    renderer.dispose();
  }
}
