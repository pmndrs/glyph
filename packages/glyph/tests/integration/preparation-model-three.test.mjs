import '../support/wasm-crossings.mjs';

import { readFile } from 'node:fs/promises';

import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';
import { preparationModel } from '../support/preparation-model.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
await glyph.init();
const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
let nextHandle = 1;

preparationModel('Three', async (labels) => {
  const handle = glyph.handle(`three:preparation-model:${String(nextHandle++)}`, ThreeConfig);
  const scene = new THREE.Scene();
  const objects = labels.map((text) => {
    const object = handle.createText({ font, text });
    scene.add(object);
    return object;
  });
  return {
    texts: objects.map((object) => ({
      object,
      value: () => object.text,
      set: (text) => {
        object.text = text;
      },
      setStyle: (style) => {
        object.style = style;
      },
      read: () => object.measure(),
      committed: () => object.commitState().status === 'committed',
    })),
    frame: () => scene.updateMatrixWorld(true),
    unmount: () => handle.dispose(),
  };
});
