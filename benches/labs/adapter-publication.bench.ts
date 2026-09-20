import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';
import * as THREE from 'three/webgpu';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

const glyphPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const threePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
)) as typeof import('@pmndrs/glyph/three');

const { bitmap, glyph } = glyphPackage;
const { defineThreeConfig } = threePackage;
const fontBytes = await readFile(new URL('../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url));

await glyph.init();
const font = glyph.fontFace(new Blob([new Uint8Array(fontBytes)], { type: 'model/gltf-binary' }), {
  format: bitmap({ strikes: [16] }),
});
await font.load();

group('allocation-light adapter publication @publication', () => {
  bench('normalize 1000 equivalent retained label updates @cached', function* () {
    const count = 1_000;
    const root = glyph.handle(
      'labs:adapter-publication:normalized-no-op',
      defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
    );
    const textGroup = root.createTextGroup();
    const scene = new THREE.Scene();
    const labels = Array.from({ length: count }, (_, index) =>
      root.createText({
        font,
        text: `label ${String(index).padStart(4, '0')}`,
        style: { fontSize: 16 },
        layout: { wrap: 'word' },
        constraints: { width: { mode: 'exact', size: 160 } },
      }),
    );
    textGroup.add(...labels);
    scene.add(textGroup);
    scene.updateMatrixWorld(true);
    if (textGroup.error !== undefined) throw textGroup.error;

    const textCount = yield () => {
      for (const label of labels) {
        label.style = { fontSize: 16 };
        label.layout = { wrap: 'word' };
        label.constraints = { width: { mode: 'exact', size: 160 } };
      }
      scene.updateMatrixWorld(true);
      if (textGroup.error !== undefined) throw textGroup.error;
      return textGroup.textCount;
    };
    assert.equal(textCount, count);

    textGroup.dispose();
    for (const label of labels) label.dispose();
    root.dispose();
  });
});
