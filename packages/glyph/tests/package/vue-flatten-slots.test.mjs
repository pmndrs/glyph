/** Nested Vue `<Text>` VNodes flatten into one string plus ordered inherited spans without mounting; the walker sees the same VNode shapes the template compiler and `h()` produce. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Comment, Fragment, createTextVNode, h } from 'vue';

import { flattenVueText } from '../../dist/vue/internal/flatten-slots.js';

const TextComponent = { name: 'GlyphVueTextFixture' };
const Foreign = { name: 'Foreign' };
const fontFaceSelection = { face: { disposed: false }, format: 'msdf' };
const options = {
  isText: (type) => type === TextComponent,
  resolveFont: (selection) => (selection === 'Inter' ? fontFaceSelection : selection),
  isFontFaceSelection: (value) => value === fontFaceSelection,
};

test('strings, numbers, and text VNodes concatenate in order', () => {
  const result = flattenVueText(['Hello ', 42, createTextVNode(' world')], options);
  assert.equal(result.text, 'Hello 42 world');
  assert.deepEqual(result.spans, []);
  assert.deepEqual(result.fontFaces, []);
});

test('fragments and nested arrays flatten while comments are skipped', () => {
  const result = flattenVueText([h(Fragment, null, ['a', ['b', h(Comment, null, 'v-if placeholder')]]), 'c'], options);
  assert.equal(result.text, 'abc');
});

test('a nested Text with a string child becomes one styled span', () => {
  const result = flattenVueText(['Typed ', h(TextComponent, { style: { color: '#ff00ff' } }, 'span')], options);
  assert.equal(result.text, 'Typed span');
  assert.deepEqual(result.spans, [{ start: 6, end: 10, style: { color: '#ff00ff' } }]);
});

test('a nested Text with slot children inherits and merges the enclosing style', () => {
  const result = flattenVueText(
    [
      h(
        TextComponent,
        { style: { fontSize: 20, color: 'red' } },
        {
          default: () => ['outer ', h(TextComponent, { style: { color: 'blue' } }, 'inner')],
        },
      ),
    ],
    options,
  );
  assert.equal(result.text, 'outer inner');
  assert.deepEqual(result.spans, [
    { start: 0, end: 11, style: { fontSize: 20, color: 'red' } },
    { start: 6, end: 11, style: { fontSize: 20, color: 'blue' } },
  ]);
});

test('a nested Text without style, font, or material contributes text but no span', () => {
  const result = flattenVueText([h(TextComponent, null, ['plain'])], options);
  assert.equal(result.text, 'plain');
  assert.deepEqual(result.spans, []);
});

test('an empty nested Text contributes no span even when styled', () => {
  const result = flattenVueText(['a', h(TextComponent, { style: { color: 'red' } }), 'b'], options);
  assert.equal(result.text, 'ab');
  assert.deepEqual(result.spans, []);
});

test('nested string fonts resolve once through the resolver and are collected', () => {
  const result = flattenVueText(
    [h(TextComponent, { font: 'Inter' }, 'one'), h(TextComponent, { font: 'Inter' }, 'two')],
    options,
  );
  assert.deepEqual(result.fontFaces, [fontFaceSelection]);
  assert.equal(result.spans.length, 2);
  assert.equal(result.spans[0].font, fontFaceSelection);
  assert.equal(result.spans[1].font, fontFaceSelection);
});

test('key and ref props on a nested Text are not treated as box properties', () => {
  const result = flattenVueText([h(TextComponent, { key: 'k', ref: 'r', style: { color: 'red' } }, 'x')], options);
  assert.deepEqual(result.spans, [{ start: 0, end: 1, style: { color: 'red' } }]);
});

test('a box property on a nested Text throws and names the camel-cased property', () => {
  assert.throws(
    () => flattenVueText([h(TextComponent, { position: [1, 2, 3] }, 'x')], options),
    /nested Vue Text cannot use the box property position/,
  );
  assert.throws(
    () => flattenVueText([h(TextComponent, { 'raster-pixel-ratio': 2 }, 'x')], options),
    /nested Vue Text cannot use the box property rasterPixelRatio/,
  );
});

test('a foreign component child throws', () => {
  assert.throws(
    () => flattenVueText([h(Foreign, null, 'x')], options),
    /Vue Text children must be text, numbers, arrays, or nested Text components/,
  );
});

test('span boundaries resolve onto the grapheme cluster grid', () => {
  // U+0301 combines with the preceding "a"; the styled span must absorb the whole cluster.
  const result = flattenVueText([h(TextComponent, { style: { color: 'red' } }, 'a'), '\u0301bc'], options);
  assert.equal(result.text, 'a\u0301bc');
  assert.deepEqual(result.spans, [{ start: 0, end: 2, style: { color: 'red' } }]);
});
