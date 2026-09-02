import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Scene } from 'three/webgpu';

import { FontLoadError, glyph } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { defineThreeConfig, ThreeConfig } from '@pmndrs/glyph/three';
import '../support/browser-globals.mjs';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const bytes = await readFile(fontUrl);
const multiFormatBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
await glyph.init();

test('a loaded FontFace constructs an imperative Three Text and owns its hidden Font lease', async () => {
  const handle = glyph.handle('three:font-face-imperative', ThreeConfig);
  const face = glyph.fontFace(
    { baked: { bytes, ownership: 'copy' } },
    { family: 'FontFaceImperative', format: [bitmap({ strikes: [16] }), 'slug'] },
  );
  try {
    assert.equal(face.default, face);
    assert.equal(face.bitmap, face);
    assert.notEqual(face.slug, face);
    assert.equal(face.isLoaded(handle), false);
    assert.throws(
      () => handle.createText({ font: face, text: 'too early' }),
      (error) => error instanceof FontLoadError && error.code === 'FONT_FACE_NOT_LOADED',
    );

    const load = face.load(handle);
    assert.equal(face.load(handle), load, 'concurrent callers share one FontFace load operation');
    assert.equal(await load, face);
    assert.equal(face.load(handle), load, 'a loaded FontFace keeps the same settled promise');
    assert.equal(face.isLoaded(handle), true);
    const text = handle.createText({ font: face, text: 'loaded' });
    const mountedFont = text.font;
    const scene = new Scene();
    scene.add(text);
    assert.equal(text.parent, scene);
    assert.equal(mountedFont.technique, bitmap);

    face.dispose();
    assert.equal(mountedFont.disposed, false, 'Text retains its independent mounted Font lease');
    text.dispose();
    assert.equal(mountedFont.disposed, true);
  } finally {
    face.dispose();
    handle.dispose();
  }
});

test('one FontFace resolves its omitted format independently through each handle config', async () => {
  const msdfHandle = glyph.handle('three:font-face-default-msdf', ThreeConfig);
  const slugHandle = glyph.handle('three:font-face-default-slug', defineThreeConfig({ defaultFontFormat: 'slug' }));
  const face = glyph.fontFace(
    { baked: { bytes: multiFormatBytes, ownership: 'copy' } },
    { family: 'FontFaceHandleDefaults' },
  );
  let msdfText;
  let slugText;
  try {
    assert.equal(face.isLoaded(msdfHandle), false);
    assert.equal(face.isLoaded(slugHandle), false);
    const [first, second] = await Promise.all([face.load(msdfHandle), face.load(slugHandle)]);
    assert.equal(first, face);
    assert.equal(second, face);
    msdfText = msdfHandle.createText({ font: face, text: 'MSDF default' });
    slugText = slugHandle.createText({ font: face, text: 'Slug default' });
    assert.equal(msdfText.font.technique, msdf);
    assert.equal(slugText.font.technique, slug);
  } finally {
    msdfText?.dispose();
    slugText?.dispose();
    face.dispose();
    msdfHandle.dispose();
    slugHandle.dispose();
  }
});

test('FontFace family aliases reject collisions and Blob declarations load through the shared library', async () => {
  const handle = glyph.handle('three:font-face-blob', ThreeConfig);
  const first = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceBlob',
    format: bitmap({ strikes: [16] }),
  });
  try {
    assert.throws(() => glyph.fontFace('/other.font.glb', { family: 'FontFaceBlob' }), /already exists/);
    await first.load(handle);
    const text = handle.createText({ font: 'FontFaceBlob', text: 'blob' });
    assert.equal(text.font.technique, bitmap);
    text.dispose();
  } finally {
    first.dispose();
    handle.dispose();
  }
});
