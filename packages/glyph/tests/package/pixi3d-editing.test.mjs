// `Pixi3DText.replace` is the Three edit, not a second one: the same host function checks the range, states it
// to the engine and rebases the spans, so a PixiJS 3D text and a Three text given the same content and the same
// edits answer every caret alike.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph, GlyphInputError, span, txt } from '@pmndrs/glyph';
import { definePixi3DConfig, TextOffsetError } from '@pmndrs/glyph/pixi3d';
import { TextOffsetError as ThreeTextOffsetError } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';

const fontFixture = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const shaperWasm = new URL('../../dist/text-shaper.wasm', import.meta.url);

let nextHandle = 1;

async function loadFont(testContext) {
  const font = glyph.fontFace(new Blob([await readFile(fontFixture)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  testContext.after(() => font.dispose());
  return font;
}

async function pixiText(testContext, font, options) {
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle(`pixi3d:editing:${String(nextHandle++)}`, definePixi3DConfig());
  const text = handle.createText({ font, ...options });
  testContext.after(() => {
    text.dispose();
    handle.dispose();
  });
  return text;
}

async function threeText(testContext, font, options) {
  const three = await createThreeTestHandle(testContext);
  const scene = new THREE.Scene();
  const group = three.createTextGroup();
  const text = three.createText({ font, ...options });
  scene.add(group);
  group.add(text);
  scene.updateMatrixWorld(true);
  testContext.after(() => {
    text.dispose();
    group.dispose();
  });
  return text;
}

const plain = (input) => (typeof input === 'string' ? input : input.text);

test('a mid-paragraph edit leaves a PixiJS 3D text with the carets a Three text reports', async (t) => {
  const font = await loadFont(t);
  const big = span({ fontSize: 24 });
  const options = {
    text: txt`The quick brown ${big`fox jumps`} over the lazy dog, twice over.`,
    style: { fontSize: 16 },
    constraints: { width: { mode: 'at-most', size: 160 } },
  };
  const pixi = await pixiText(t, font, options);
  const three = await threeText(t, font, options);
  const edits = [
    [10, 10, 'red '], // an insertion before the span
    [29, 29, 'ing'], // at the span's end: the span grows over it
    [4, 9, ''], // a deletion that rewraps every later line
    [12, 20, 'cat leaps'], // a replacement that straddles the span's start
  ];
  for (const [start, end, insert] of edits) {
    pixi.replace(start, end, insert);
    three.replace(start, end, insert);
    assert.equal(plain(pixi.text), three.text);
    // Three keeps its spans private; the sizes the engine shaped show both rebased them alike.
    assert.deepEqual(
      [...pixi.glyphs().glyphFontSizes],
      [...three.glyphs().glyphFontSizes],
      `styling after replace(${start}, ${end})`,
    );
    const length = plain(pixi.text).length;
    for (let offset = 0; offset <= length; offset += 1) {
      for (const affinity of ['upstream', 'downstream']) {
        assert.deepEqual(
          pixi.caret({ offset, affinity }),
          three.caret({ offset, affinity }),
          `caret ${affinity} ${offset} after replace(${start}, ${end})`,
        );
      }
    }
  }
  assert.equal(pixi.text.text, 'The  red brocat leapsumpsing over the lazy dog, twice over.');
  assert.ok(pixi.caret({ offset: pixi.text.text.length, affinity: 'upstream' }).line > 0, 'the text wraps');
});

test('a refused replace throws the TextOffsetError Three throws and changes nothing', async (t) => {
  assert.equal(TextOffsetError, ThreeTextOffsetError, 'one error class, exported from both integrations');
  const font = await loadFont(t);
  const text = await pixiText(t, font, { text: 'a\u{1f44d}\u{1f3fd}b', style: { fontSize: 16 } });
  const refused = (call, expected) =>
    assert.throws(call, (error) => {
      assert.ok(error instanceof TextOffsetError);
      assert.equal(error.code, 'invalid-offset');
      assert.deepEqual(
        {
          method: error.method,
          argument: error.argument,
          offset: error.offset,
          reason: error.reason,
          textLength: error.textLength,
          before: error.before,
          after: error.after,
        },
        expected,
      );
      return true;
    });
  refused(() => text.replace(3, 5, 'x'), {
    method: 'replace',
    argument: 'start',
    offset: 3,
    reason: 'inside-grapheme',
    textLength: 6,
    before: 1,
    after: 5,
  });
  refused(() => text.replace(5, 1, 'x'), {
    method: 'replace',
    argument: 'end',
    offset: 1,
    reason: 'reversed',
    textLength: 6,
    before: 1,
    after: 1,
  });
  refused(() => text.replace(0, 7, 'x'), {
    method: 'replace',
    argument: 'end',
    offset: 7,
    reason: 'out-of-range',
    textLength: 6,
    before: 6,
    after: undefined,
  });
  refused(() => text.replace(1.5, 5, 'x'), {
    method: 'replace',
    argument: 'start',
    offset: 1.5,
    reason: 'not-integer',
    textLength: 6,
    before: 1,
    after: 5,
  });
  assert.equal(text.text, 'a\u{1f44d}\u{1f3fd}b', 'a refused replace changes nothing');
  assert.throws(() => text.replace(0, 1, 7), /insert must be a string/);
  text.replace(1, 5, '');
  assert.equal(text.text, 'ab');
});

test('the shared span vectors hold on a PixiJS 3D text, in the host and in the engine', async (t) => {
  const vectors = JSON.parse(await readFile(new URL('../fixtures/span-rebase-vectors.json', import.meta.url), 'utf8'));
  assert.ok(vectors.cases.length > 20);
  const font = await loadFont(t);
  const text = await pixiText(t, font, { text: 'a', style: { fontSize: 16 } });
  for (const {
    name,
    span: [start, end],
    replace,
    inserted,
    result,
  } of vectors.cases) {
    const length = Math.max(end, replace[1]) + 2;
    text.text = { text: 'a'.repeat(length), spans: [{ start, end, style: { fontSize: 24 } }] };
    text.replace(replace[0], replace[1], 'b'.repeat(inserted));
    const spans = typeof text.text === 'string' ? [] : text.text.spans;
    assert.deepEqual(spans.length === 0 ? null : [spans[0].start, spans[0].end], result, name);
    // One glyph per letter: the engine styles exactly the units the host's span names.
    const sizes = [...text.glyphs().glyphFontSizes];
    const expected = Array.from({ length: plain(text.text).length }, (_, index) =>
      result !== null && index >= result[0] && index < result[1] ? 24 : 16,
    );
    assert.deepEqual(sizes, expected, `${name}: engine styling`);
  }
});

test('PixiJS 3D text refuses invalid caller input with GlyphInputError, as Three does', async (t) => {
  const font = await loadFont(t);
  await glyph.init({ wasm: await readFile(shaperWasm) });
  const handle = glyph.handle(`pixi3d:editing:${String(nextHandle++)}`, definePixi3DConfig());
  t.after(() => handle.dispose());
  const inputError = (path) => (error) => {
    assert.ok(error instanceof GlyphInputError, `${error?.name}: ${error?.message}`);
    assert.equal(error.code, 'invalid-input');
    assert.deepEqual(error.path, path);
    assert.ok(error.cause instanceof TypeError || error.cause instanceof RangeError);
    return true;
  };
  assert.throws(() => handle.createText({ font, text: 7 }), inputError(['text']));
  assert.throws(() => handle.createText({ font, text: 'a', material: {} }), inputError(['material']));
  assert.throws(() => handle.createText({ font, text: 'a', style: { fontSize: Number.NaN } }), inputError([]));

  const text = handle.createText({ font, text: 'kept' });
  t.after(() => text.dispose());
  assert.throws(() => text.update(7), inputError([]));
  assert.throws(() => text.update({ style: { fontSize: -1 } }), inputError(['style']));
  assert.throws(() => text.update({ material: undefined }), inputError(['material']));
  assert.throws(() => text.update({ text: 'both', layout: { maxLines: 0 } }), inputError([]));
  assert.equal(text.text, 'kept', 'a refused update changes nothing');
});
