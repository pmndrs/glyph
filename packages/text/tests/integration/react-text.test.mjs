import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import React, { createRef, StrictMode } from 'react';

import { Text as CoreText, defineFont } from '../../dist/v0.js';
import { Text as R3fText, TextGroup as R3fTextGroup, useFont as useV1Font } from '../../dist/r3f.js';
import { Text, lazyRaster, useFont } from '../../dist/react.js';
import { bitmap as bitmapTechnique } from '../../dist/raster/bitmap-technique.js';
import { bitmap } from '../../dist/raster/bitmap.js';
import { Text as ThreeV1Text } from '../../dist/three.js';

const restoreR3fEnvironment = installR3fEnvironment();
const { default: ReactThreeTestRenderer } = await import('@react-three/test-renderer');
after(restoreR3fEnvironment);

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const shaperUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);

test('React Text flattens spans, retains its Object3D identity, forwards its ref, and disposes', async () => {
  const restoreFetch = installFileFetch();
  const font = defineFont(fixtureUrl.href, bitmap({ strikes: [16] }));
  const loaded = await useFont.preload(font);
  const reference = createRef();
  const layouts = [];
  const render = (
    suffix,
    color,
    {
      position = [0, 0, 0],
      rotation = [0, 0, 0],
      scale = [1, 1, 1],
      name = 'initial headline',
      visible = true,
      frustumCulled = true,
      renderOrder = 600,
    } = {},
  ) =>
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        Text,
        {
          font,
          fontSize: 16,
          position,
          rotation,
          scale,
          name,
          visible,
          frustumCulled,
          renderOrder,
          ref: reference,
          onLayout: (layout) => layouts.push(layout),
        },
        'Fast ',
        React.createElement(Text, { color }, suffix),
      ),
    );

  let renderer;
  try {
    await ReactThreeTestRenderer.act(async () => {
      renderer = await ReactThreeTestRenderer.create(render('office', '#ff8a00'));
    });
    assert.ok(
      reference.current instanceof CoreText,
      `forwarded ref resolved to ${reference.current?.constructor?.name ?? String(reference.current)}`,
    );
    assert.equal(reference.current.isObject3D, true, 'Text remains a Three.js Object3D');
    assert.equal(reference.current.isGroup, undefined, 'Text does not introduce nested Group ordering');
    reference.current.updateMatrixWorld();
    assert.equal(reference.current.children.length, 1);
    assert.equal(reference.current.layout?.glyphIds.length, 11);
    assert.equal(reference.current.children[0]?.children[0]?.renderOrder, 600);
    assert.equal(layouts.length, 1);

    const object = reference.current;
    const initialLayout = object.layout;
    const initialBatch = object.children[0];
    await renderer.update(
      render('office', '#00aaff', {
        position: [2, 1, 0],
        rotation: [0, 0.5, 0],
        scale: [2, 3, 4],
        name: 'updated headline',
        visible: false,
        frustumCulled: false,
        renderOrder: 700,
      }),
    );
    object.updateMatrixWorld();
    assert.equal(reference.current, object, 'React updates retain the core object identity');
    assert.equal(object.layout, initialLayout, 'paint and transform changes do not reflow');
    assert.equal(object.children[0], initialBatch, 'Object3D changes retain the raster batch');
    assert.deepEqual(object.position.toArray(), [2, 1, 0]);
    assert.deepEqual(object.rotation.toArray(), [0, 0.5, 0, 'XYZ']);
    assert.deepEqual(object.scale.toArray(), [2, 3, 4]);
    assert.equal(object.name, 'updated headline');
    assert.equal(object.visible, false);
    assert.equal(object.frustumCulled, false);
    assert.equal(object.renderOrder, 700);
    assert.equal(initialBatch.children[0]?.renderOrder, 700, 'the retained draw mesh receives the new Text order');

    await renderer.update(render('accurate', '#00aaff', { position: [2, 1, 0] }));
    object.updateMatrixWorld();
    assert.notEqual(object.layout, initialLayout, 'text changes replace the layout generation');
    assert.equal(object.layout?.glyphIds.length, 13);
    assert.equal(layouts.length, 2);

    await assert.rejects(
      ReactThreeTestRenderer.create(
        React.createElement(Text, { font }, React.createElement(Text, { renderOrder: 1 }, 'invalid inline order')),
      ),
      /nested Text does not accept renderOrder/,
    );

    await renderer.unmount();
    renderer = undefined;
    await Promise.resolve();
    assert.throws(() => object.setProperties({ opacity: 1 }), /disposed/);
  } finally {
    if (renderer !== undefined) await renderer.unmount();
    await Promise.resolve();
    loaded.font.dispose();
    useFont.clear(font);
    restoreFetch();
  }
});

test('target-v1 R3F TextGroup and nested Text retain Three objects without Strict Mode font leaks', async () => {
  const restoreFetch = installFileFetch();
  const request = {
    input: { baked: fixtureUrl.href },
    raster: { technique: bitmapTechnique, options: { strikes: [16] } },
  };
  const font = await useV1Font.preload(request);
  const groupReference = createRef();
  const textReference = createRef();
  const render = (suffix) =>
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        R3fTextGroup,
        { technique: bitmapTechnique, ref: groupReference },
        React.createElement(
          R3fText,
          { font, ref: textReference },
          'Fast ',
          React.createElement(R3fText, { paint: { color: '#ff00ff' } }, suffix),
        ),
      ),
    );

  let renderer;
  try {
    await ReactThreeTestRenderer.act(async () => {
      renderer = await ReactThreeTestRenderer.create(render('text'));
    });
    assert.ok(textReference.current instanceof ThreeV1Text);
    groupReference.current.updateMatrixWorld();
    assert.equal(textReference.current.layout?.glyphIds.length, 9);
    assert.deepEqual(
      textReference.current.spans.map(({ start, end }) => [start, end]),
      [[5, 9]],
    );
    const retained = textReference.current;

    await renderer.update(render('type'));
    groupReference.current.updateMatrixWorld();
    assert.equal(textReference.current, retained);
    assert.equal(retained.text, 'Fast type');

    await renderer.unmount();
    renderer = undefined;
    assert.equal(retained.disposed, true);
    font.dispose();
    useV1Font.clear(request);
  } finally {
    if (renderer !== undefined) await renderer.unmount();
    if (!font.disposed) font.dispose();
    useV1Font.clear(request);
    restoreFetch();
  }
});

test('lazyRaster participates in the real React Text dependency and draw path', async () => {
  const restoreFetch = installFileFetch();
  const raster = lazyRaster(async () => bitmap({ strikes: [16] }).module);
  const font = defineFont(fixtureUrl.href, {
    module: raster,
    options: { strikes: [16] },
  });
  let importPromise;
  try {
    const unexpectedlyReadyText = new CoreText({ text: 'lazy raster', font, fontSize: 16 });
    unexpectedlyReadyText.dispose();
  } catch (error) {
    importPromise = error;
  }
  assert.ok(importPromise instanceof Promise, 'a valid lazy token preserves its Suspense promise');
  await importPromise;

  const loaded = await useFont.preload(font);
  const reference = createRef();
  let renderer;
  try {
    await ReactThreeTestRenderer.act(async () => {
      renderer = await ReactThreeTestRenderer.create(
        React.createElement(Text, { font, fontSize: 16, ref: reference }, 'lazy raster'),
      );
    });
    reference.current.updateMatrixWorld();
    assert.equal(reference.current.children.length, 1);
  } finally {
    if (renderer !== undefined) await renderer.unmount();
    await Promise.resolve();
    loaded.font.dispose();
    useFont.clear(font);
    restoreFetch();
  }
});

test('Text preserves a raster descriptor failure when validating a font token', () => {
  const failure = new Error('fixture descriptor failure');
  const raster = bitmap({ strikes: [16] }).module;
  const invalid = defineFont(fixtureUrl.href, {
    module: {
      ...raster,
      descriptor() {
        throw failure;
      },
    },
    options: { strikes: [16] },
  });

  assert.throws(() => new CoreText({ text: 'invalid raster', font: invalid }), failure);
});

function installFileFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === shaperUrl.href) {
      init?.signal?.throwIfAborted();
      return new Response(await readFile(shaperUrl), { status: 200 });
    }
    if (url === fixtureUrl.href) {
      init?.signal?.throwIfAborted();
      return new Response(await readFile(fixtureUrl), { status: 200 });
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function installR3fEnvironment() {
  const originalSelf = globalThis.self;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  globalThis.self = globalThis;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return () => {
    globalThis.self = originalSelf;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  };
}
