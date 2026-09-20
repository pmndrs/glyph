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

let nextHandle = 1;

function createLabels(count: number) {
  const root = glyph.handle(
    `labs:adapter-publication:${String(nextHandle++)}`,
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
  return { labels, root, scene, textGroup };
}

function disposeLabels(created: ReturnType<typeof createLabels>): void {
  created.textGroup.dispose();
  for (const label of created.labels) label.dispose();
  created.root.dispose();
}

group('allocation-light adapter publication @publication', () => {
  bench('normalize 1000 equivalent retained label updates @cached', function* () {
    const count = 1_000;
    const created = createLabels(count);

    const textCount = yield () => {
      for (const label of created.labels) {
        label.style = { fontSize: 16 };
        label.layout = { wrap: 'word' };
        label.constraints = { width: { mode: 'exact', size: 160 } };
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, count);

    disposeLabels(created);
  });

  bench('create, first-publish, and dispose 1000-label root @cold', function* () {
    const count = 1_000;
    const textCount = yield () => {
      const created = createLabels(count);
      const published = created.textGroup.textCount;
      disposeLabels(created);
      return published;
    };
    assert.equal(textCount, count);
  });
});
