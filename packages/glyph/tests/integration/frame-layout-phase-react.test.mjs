// The react-three-fiber side of the two-step frame: the canvas prepares before it renders, an imperative
// setter asks an on-demand canvas for a frame, and an in-canvas boundary contains an invalid prop.
import { crossingsOf } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement, Suspense } from 'react';
import { create } from '@react-three/test-renderer/webgpu';
import { glyph, GlyphInputError } from '@pmndrs/glyph';
import { GlyphErrorBoundary, Text as ReactText } from '@pmndrs/glyph/react';
import { adapterFont } from '../support/adapter-behavior.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.self ??= globalThis;
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;
await glyph.init();

test('React: the canvas prepares before it renders, and a setter asks an on-demand canvas for a frame', async () => {
  const adapter = await adapterFont();
  let label;
  const seen = [];
  const renderer = await create(
    createElement(
      Suspense,
      { fallback: null },
      createElement(
        ReactText,
        {
          font: adapter.face,
          ref: (value) => {
            if (value !== null) label = value;
          },
          onLayout: (text, layout) => seen.push([text, layout.glyphCount, text.commitState().status]),
        },
        'label',
      ),
    ),
    { frameloop: 'demand' },
  );
  try {
    const scene = renderer.scene.instance;
    assert.equal(scene.children[0].name, '@pmndrs/glyph-prepare', 'the root learned its Scene when the Text mounted');
    // One frame of the canvas: the layout callback runs while the text is still unpublished, then it is drawn.
    assert.deepEqual(await crossingsOfAsync(() => renderer.advanceFrames(1, 0.016)), {
      engine_prepare_batch: 1,
      // The callback reads `glyphCount`, a glyph fact the batch's summary computes on first read.
      engine_measure_paragraph: 1,
      engine_update_batch: 1,
    });
    assert.deepEqual(seen, [[label, label.measure().glyphCount, 'pending']]);
    assert.equal(label.commitState().status, 'committed');

    // The canvas state object is read at call time; replacing its function in place re-renders nothing.
    const state = label.__r3f.root.getState();
    const invalidate = state.invalidate;
    let invalidations = 0;
    state.invalidate = (...parameters) => {
      invalidations += 1;
      return invalidate(...parameters);
    };
    label.text = 'set through the ref';
    assert.ok(invalidations >= 1, 'an imperative setter asks the on-demand canvas for a frame');
    state.invalidate = invalidate;
  } finally {
    await renderer.unmount();
    adapter.dispose();
  }
});

test('React: an onLayout prop positions the first frame exactly', async () => {
  const adapter = await adapterFont();
  let label;
  const renderer = await create(
    createElement(
      Suspense,
      { fallback: null },
      createElement(
        ReactText,
        {
          font: adapter.face,
          ref: (value) => {
            if (value !== null) label = value;
          },
          onLayout: (text, layout) => {
            text.position.x = -layout.width / 2;
          },
        },
        'centred on its own width',
      ),
    ),
    { frameloop: 'demand' },
  );
  try {
    await renderer.advanceFrames(1, 0.016);
    const width = label.measure().width;
    assert.ok(width > 0);
    assert.equal(label.matrixWorld.elements[12], -width / 2, 'the first rendered frame uses the callback position');
    assert.equal(label.commitState().status, 'committed');
    const table = [];
    renderer.scene.instance.traverse((object) => {
      const transforms = object.geometry?.attributes?._pmndrsGlyphTransforms;
      if (transforms !== undefined) table.push(...transforms.array);
    });
    assert.ok(table.includes(-width / 2), 'and the published transform table carries it');
  } finally {
    await renderer.unmount();
    adapter.dispose();
  }
});

test('React: GlyphErrorBoundary keeps an invalid Text from unmounting the canvas', async () => {
  const adapter = await adapterFont();
  const caught = [];
  let sibling;
  const tree = (style) =>
    createElement(
      Suspense,
      { fallback: null },
      createElement(
        GlyphErrorBoundary,
        { fallback: null, onError: (error) => caught.push(error) },
        createElement(ReactText, { font: adapter.face, style }, 'guarded'),
      ),
      createElement(
        ReactText,
        {
          font: adapter.face,
          ref: (value) => {
            if (value !== null) sibling = value;
          },
        },
        'sibling',
      ),
    );
  const consoleError = console.error;
  console.error = () => undefined;
  const renderer = await create(tree({ fontSize: 16 }), { frameloop: 'never' });
  try {
    await renderer.update(tree({ fontSize: Number.NaN }));
    assert.equal(caught.length, 1);
    assert.ok(caught[0] instanceof GlyphInputError);
    assert.deepEqual(caught[0].path, ['style']);
    assert.equal(sibling.disposed, false, 'the rest of the canvas is still mounted');
    renderer.scene.instance.updateMatrixWorld(true);
    assert.equal(sibling.commitState().status, 'committed');
  } finally {
    console.error = consoleError;
    await renderer.unmount();
    adapter.dispose();
  }
});

async function crossingsOfAsync(operation) {
  let pending;
  const crossings = crossingsOf(() => {
    pending = operation();
  });
  await pending;
  return crossings;
}
