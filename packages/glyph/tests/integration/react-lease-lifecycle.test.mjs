/** r3f's reconciler owns disposal via idle-deferred, error-swallowing `disposeOnIdle`; `IS_REACT_ACT_ENVIRONMENT` forces it synchronous here so assertions see settled state, and StrictMode's doubled mount/unmount means leases must balance across it. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { Fragment, StrictMode, Suspense, createElement, useLayoutEffect } from 'react';

import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { glyph, GlyphFontError } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';

import { GlyphProvider, Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import * as THREE from 'three/webgpu';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const multiFormatFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
await glyph.init();
const r3fHandle = glyph.handle('three:react-lease-tests', ThreeConfig);
after(() => r3fHandle.dispose());

// Three's WebGPU renderer needs a host context node lacks; a minimal scheduler lets it
// construct and tear down without actually rendering.
globalThis.self ??= globalThis;
// A no-op scheduler: the renderer may start its loop, but nothing is ever driven, so the
// process stays quiescent and exits. These tests assert lifecycle accounting, never frames.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;

async function loadFixture() {
  const face = glyph.fontFace(new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  await face.bitmap.load();
  return {
    font: face.bitmap,
    dispose() {
      face.dispose();
    },
  };
}

test('Text and TextGroup share the built-in Three handle without a provider', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const mountedText = [];
  const mountedGroup = [];
  try {
    const renderer = await create(
      createElement(
        TextGroup,
        { ref: (object) => void (object != null && mountedGroup.push(object)) },
        createElement(
          Text,
          { font: fixture.font, ref: (object) => void (object != null && mountedText.push(object)) },
          'default',
        ),
      ),
    );
    assert.equal(mountedGroup.length > 0, true, 'the default handle must construct the retained Three group');
    assert.equal(mountedText.length > 0, true, 'the default handle must construct the retained Three text');
    await renderer.unmount();

    fixture.dispose();
    assert.equal(mountedText.at(-1)?.disposed, true);
    assert.equal(mountedGroup.at(-1)?.disposed, true);
  } finally {
    fixture.dispose();
  }
});

test('R3F TextGroup material props update the retained Three material property', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const first = defineTextMaterial((context) => context.createDefaultMaterial());
  const second = defineTextMaterial((context) => context.createDefaultMaterial());
  let group;
  const tree = (material) =>
    createElement(
      TextGroup,
      { material, ref: (value) => void (group = value ?? group) },
      createElement(Text, { font: fixture.font }, 'material'),
    );
  const renderer = await create(tree(first));
  try {
    assert.equal(group?.material, first);
    await renderer.update(tree(second));
    assert.equal(group?.material, second);
  } finally {
    await renderer.unmount();
    fixture.dispose();
  }
});

test('provider-free R3F roots isolate independent Canvas stores', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  let firstText;
  let secondText;
  let firstDrawRoot;
  let secondDrawRoot;
  const first = await create(
    createElement(Text, { font: fixture.font, ref: (value) => void (firstText = value ?? firstText) }, 'first'),
  );
  const second = await create(
    createElement(Text, { font: fixture.font, ref: (value) => void (secondText = value ?? secondText) }, 'second'),
  );
  try {
    assert.ok(firstText !== undefined && secondText !== undefined);
    const firstScene = nearestScene(firstText);
    const secondScene = nearestScene(secondText);
    assert.ok(firstScene !== undefined && secondScene !== undefined);
    assert.notEqual(firstScene, secondScene);
    glyph.shape();
    firstDrawRoot = firstScene.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    secondDrawRoot = secondScene.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    assert.ok(firstDrawRoot !== undefined && secondDrawRoot !== undefined);
    assert.notEqual(firstDrawRoot, secondDrawRoot, 'each R3F store selects one independent Glyph root');
    assert.notEqual(firstDrawRoot.name, secondDrawRoot.name, 'generated root labels remain stable customization keys');
  } finally {
    await first.unmount();
    await second.unmount();
    await Promise.resolve();
    fixture.dispose();
  }
  assert.equal(firstDrawRoot?.parent, null, 'the first Canvas releases its default Glyph root');
  assert.equal(secondDrawRoot?.parent, null, 'the second Canvas releases its default Glyph root');
});

test('GlyphProvider resolves a scoped string through its lazy fontFaces table', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(multiFormatFontUrl)], { type: 'model/gltf-binary' });
  const face = glyph.fontFace(input, { format: msdf });
  let mounted = false;
  const tree = createElement(
    GlyphProvider,
    {
      handle: r3fHandle,
      fontFaces: { Inter: face },
      fallback: null,
    },
    createElement(
      Text,
      {
        font: 'Inter',
        name: 'named-font',
        ref: (object) => void (mounted = object !== null),
      },
      'named',
    ),
  );
  const renderer = await create(tree);
  try {
    await face.load();
    await renderer.update(tree);
    await waitFor(() => mounted);
    assert.equal(mounted, true);
  } finally {
    await renderer.unmount();
    assert.equal(face.disposed, false, 'the provider must not dispose a caller-owned FontFace declaration');
    face.dispose();
  }
});

test('GlyphProvider reuses equal inline source tables and releases its declarations after StrictMode unmount', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(multiFormatFontUrl)], { type: 'model/gltf-binary' });
  const createdFaces = captureCreatedFontFaces();
  let mountedFont;
  try {
    const tree = () =>
      createElement(
        StrictMode,
        null,
        createElement(
          GlyphProvider,
          { handle: r3fHandle, fontFaces: { Inter: { src: input, format: msdf } }, fallback: null },
          createElement(
            Text,
            { font: 'Inter', ref: (object) => void (mountedFont = object?.font ?? mountedFont) },
            'provider source',
          ),
        ),
      );
    const renderer = await create(tree());
    await createdFaces.faces[0].load();
    await renderer.update(tree());
    await waitFor(() => mountedFont !== undefined);
    assert.equal(createdFaces.faces.length, 1, 'StrictMode must reuse the provider declaration from its stable table');
    const ownedFace = createdFaces.faces[0];
    assert.equal(ownedFace.disposed, false);
    await renderer.unmount();
    await Promise.resolve();
    assert.equal(ownedFace.disposed, true, 'the provider must dispose declarations it creates from source forms');
  } finally {
    createdFaces.restore();
  }
});

test('Text suspends on an existing unloaded FontFace selection', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const face = glyph.fontFace(input, { format: bitmap({ strikes: [16] }) });
  assert.equal(face.bitmap.isLoaded(), false);
  let mounted = false;
  const tree = createElement(
    Suspense,
    { fallback: null },
    createElement(
      Text,
      { font: face.bitmap, ref: (object) => void (mounted = object !== null) },
      'suspended selection',
    ),
  );
  const renderer = await create(tree);
  try {
    await face.bitmap.load();
    await renderer.update(tree);
    await waitFor(() => mounted);
    assert.equal(face.bitmap.isLoaded(), true);
  } finally {
    await renderer.unmount();
    face.dispose();
  }
});

test('nested Text suspends on a provider FontFace alias before publishing the paragraph', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const fixture = await loadFixture();
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const nestedFace = glyph.fontFace(input, { format: bitmap({ strikes: [16] }) });
  let mounted = false;
  const tree = createElement(
    GlyphProvider,
    { handle: r3fHandle, fontFaces: { Accent: nestedFace }, fallback: null },
    createElement(
      Text,
      { font: fixture.font, ref: (object) => void (mounted = object !== null) },
      'outer ',
      createElement(Text, { font: 'Accent' }, 'nested'),
    ),
  );
  const renderer = await create(tree);
  try {
    await nestedFace.load();
    await renderer.update(tree);
    await waitFor(() => mounted);
    assert.equal(nestedFace.isLoaded(), true, 'the nested alias is loaded before the paragraph is published');
  } finally {
    await renderer.unmount();
    nestedFace.dispose();
    fixture.dispose();
  }
});

test('nested font prefetch observes rejection while an earlier font suspends', async () => {
  const { create } = await import('@react-three/test-renderer/webgpu');
  const outerRead = Promise.withResolvers();
  const invalidRead = Promise.withResolvers();
  class DeferredBlob extends Blob {
    arrayBuffer() {
      return outerRead.promise;
    }
  }
  class InvalidBlob extends Blob {
    arrayBuffer() {
      invalidRead.resolve();
      return Promise.resolve(new Uint8Array([0]).buffer);
    }
  }
  const outer = glyph.fontFace(new DeferredBlob([], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  const nested = glyph.fontFace(new InvalidBlob([], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  const unhandled = [];
  const observeUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', observeUnhandled);
  const tree = () =>
    createElement(
      GlyphProvider,
      { handle: r3fHandle, fallback: null },
      createElement(Text, { font: outer.bitmap }, 'outer ', createElement(Text, { font: nested.bitmap }, 'nested')),
    );
  let renderer;
  try {
    renderer = await create(tree());
    await invalidRead.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, [], 'speculative nested loads must always observe their rejection');

    outerRead.resolve(bytesToArrayBuffer(await readFile(fontUrl)));
    await outer.bitmap.load();
  } finally {
    process.off('unhandledRejection', observeUnhandled);
    await renderer?.unmount();
    outer.dispose();
    nested.dispose();
  }
});

test('Text and TextGroup reject untyped object-level handle selection', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  try {
    await assert.rejects(
      () => create(createElement(Text, { font: fixture.font, handle: r3fHandle }, 'invalid')),
      /R3F Text does not accept a handle prop/,
    );
    await assert.rejects(
      () => create(createElement(TextGroup, { handle: r3fHandle })),
      /R3F TextGroup does not accept a handle prop/,
    );
  } finally {
    fixture.dispose();
  }
  assert.equal(r3fHandle.textCount, 0);
});

test('GlyphProvider rejects a handle change instead of rebinding mounted objects', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const replacement = glyph.handle('three:react-provider-replacement-test', ThreeConfig);
  const fixture = await loadFixture();
  const child = createElement(Text, { font: fixture.font }, 'stable provider');
  const renderer = await create(createElement(GlyphProvider, { handle: r3fHandle }, child));
  try {
    await assert.rejects(
      () => renderer.update(createElement(GlyphProvider, { handle: replacement }, child)),
      /GlyphProvider handle and fontFaces are immutable/,
    );
  } finally {
    await renderer.unmount();
    fixture.dispose();
    replacement.dispose();
  }
  assert.equal(r3fHandle.textCount, 0);
});

test('GlyphProvider string shorthand selects a named root on the built-in default handle', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const renderer = await create(
    createElement(
      GlyphProvider,
      { handle: 'provider-string-root' },
      createElement(Text, { font: fixture.font }, 'named'),
    ),
  );
  try {
    const scene = renderer.scene.instance;
    scene.updateMatrixWorld(true);
    assert.ok(scene.children.some(({ name }) => name === '@pmndrs/glyph:provider-string-root'));
  } finally {
    await renderer.unmount();
    fixture.dispose();
  }
});

test('an R3F portal selects a distinct terminal root for its target Scene', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const { createPortal } = await import('@react-three/fiber/webgpu');
  const fixture = await loadFixture();
  const world = r3fHandle('portal-world');
  const hud = r3fHandle('portal-hud');
  const hudScene = new THREE.Scene();
  let worldText;
  let hudText;
  const renderer = await create(
    createElement(
      Fragment,
      null,
      createElement(
        GlyphProvider,
        { handle: world },
        createElement(Text, { font: fixture.font, ref: (value) => void (worldText = value ?? worldText) }, 'world'),
      ),
      createPortal(
        createElement(
          GlyphProvider,
          { handle: hud },
          createElement(Text, { font: fixture.font, ref: (value) => void (hudText = value ?? hudText) }, 'hud'),
        ),
        hudScene,
      ),
    ),
  );
  try {
    assert.ok(worldText !== undefined && hudText !== undefined);
    const worldScene = nearestScene(worldText);
    assert.ok(worldScene !== undefined);
    worldScene.updateMatrixWorld(true);
    hudScene.updateMatrixWorld(true);
    assert.equal(world.textCount, 1);
    assert.equal(hud.textCount, 1);
    assert.equal(r3fHandle.textCount, 0, 'the named providers never rebind the anonymous root');
    assert.equal(r3fHandle('portal-world'), world, 'React and imperative Three select the same named root');
    assert.equal(r3fHandle('portal-hud'), hud, 'portal selection remains idempotent through the owning handle');
    assert.ok(worldScene.getObjectByName('@pmndrs/glyph:portal-world'));
    assert.ok(hudScene.getObjectByName('@pmndrs/glyph:portal-hud'));
    assert.notEqual(worldScene, hudScene);
  } finally {
    try {
      await renderer.unmount();
      assert.equal(world.textCount, 0);
      assert.equal(hud.textCount, 0);
    } finally {
      fixture.dispose();
      world.dispose();
      hud.dispose();
    }
  }
});

test('StrictMode mount and replay balance every paragraph lease', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const { font } = fixture;
  try {
    const renderer = await create(
      createElement(
        StrictMode,
        null,
        createElement(
          GlyphProvider,
          { handle: r3fHandle },
          createElement(
            Text,
            {
              font,
              style: { fontSize: 20, lineHeight: 1.25 },
              constraints: { width: { mode: 'exact', size: 300 } },
              layout: { wrap: 'word' },
            },
            'strict lease',
          ),
        ),
      ),
    );
    await renderer.unmount();

    fixture.dispose();
    assert.equal(r3fHandle.textCount, 0);
  } finally {
    fixture.dispose();
  }
});

test('a FontFace may dispose before React releases its mounted Text lease', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const { font } = fixture;
  const renderer = await create(
    createElement(
      GlyphProvider,
      { handle: r3fHandle },
      createElement(
        Text,
        {
          font,
          style: { fontSize: 20, lineHeight: 1.25 },
          constraints: { width: { mode: 'exact', size: 300 } },
          layout: { wrap: 'word' },
        },
        'still mounted',
      ),
    ),
  );

  fixture.dispose();
  assert.equal(font.face.disposed, true);
  assert.equal(r3fHandle.textCount, 1, 'the mounted Text remains retained by the selected handle root');
  await renderer.unmount();
  fixture.dispose();
  assert.equal(r3fHandle.textCount, 0);
});

test('preload, StrictMode consumers, clear, and remount share one font resource lifecycle', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const options = { strikes: [16] };
  const observed = new Map();
  const createdFaces = captureCreatedFontFaces();
  let renderer;
  let remounted;
  try {
    const preload = useBitmap.preload(input, options);
    assert.equal(
      useFont.preload(input, { format: bitmap(options) }),
      preload,
      'the convenience and generic APIs share one pending operation',
    );
    await preload;
    assert.equal(useBitmap.preload(input, options), preload, 'the fulfilled preload remains stable');

    renderer = await create(bitmapFontTree(input, options, observed, ['first', 'second']));
    await waitFor(() => observed.size === 2 && observed.get('first') !== observed.get('second'));
    const first = observed.get('first');
    const second = observed.get('second');
    const firstFace = createdFaces.faces[0];
    assert.ok(first !== undefined && second !== undefined && firstFace !== undefined);
    assert.equal(createdFaces.faces.length, 1, 'preload, render retries, and StrictMode share one declaration');

    await renderer.update(bitmapFontTree(input, options, observed, ['second']));
    await waitFor(() => first.disposed && observed.get('second') === second);
    assert.equal(second.disposed, false, 'removing one consumer leaves its sibling lease live');

    useBitmap.clear(input, options);
    await Promise.resolve();
    assert.equal(second.disposed, false, 'clear releases the Suspense owner, not a mounted lease');
    assert.equal(firstFace.disposed, false, 'the mounted lease retains its source declaration');

    await renderer.unmount();
    renderer = undefined;
    await Promise.resolve();
    assert.equal(observed.size, 0);
    assert.equal(second.disposed, true, 'the final hook unmount releases its immutable Font lease');
    assert.equal(firstFace.disposed, true, 'the final owner release disposes the first declaration');

    const retry = useBitmap.preload(input, options);
    assert.notEqual(retry, preload, 'clear evicts the fulfilled operation');
    await retry;
    remounted = await create(bitmapFontTree(input, options, observed, ['retry']));
    await waitFor(() => observed.has('retry'));
    assert.equal(createdFaces.faces.length, 2, 'retry creates exactly one new declaration');
    await remounted.unmount();
    remounted = undefined;
    useFont.clear(input, { format: bitmap(options) });
    await Promise.resolve();
    assert.equal(observed.size, 0);
    assert.equal(createdFaces.faces[1]?.disposed, true);
  } finally {
    if (renderer !== undefined) await renderer.unmount();
    if (remounted !== undefined) await remounted.unmount();
    useBitmap.clear(input, options);
    createdFaces.restore();
  }
});

test('a rejected hook resource stays stable for the error boundary and a later preload can retry', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const input = new Blob([new Uint8Array([0])], { type: 'model/gltf-binary' });
  const config = { format: bitmap({ strikes: [16] }) };
  const createdFaces = captureCreatedFontFaces();
  try {
    const failed = useFont.preload(input, config);
    assert.equal(useFont.preload(input, config), failed, 'concurrent callers share the failing operation');
    const rejection = await failed.then(
      () => assert.fail('the invalid font preload must reject'),
      (error) => error,
    );
    assert.equal(
      createdFaces.faces[0].disposed,
      true,
      'a cached rejection must not retain its failed core declaration',
    );
    let boundaryError;
    const renderer = await create(
      createElement(
        GlyphProvider,
        { fallback: null, errorFallback: (error) => void (boundaryError = error) },
        createElement(RejectedHookFont, { input, config }),
      ),
    );
    assert.equal(
      boundaryError,
      rejection,
      'the stable cached rejection must surface synchronously after its FontFace is released',
    );
    await renderer.unmount();
    const retry = useFont.preload(input, config);
    assert.notEqual(retry, failed, 'a later explicit preload replaces the settled rejected operation');
    await assert.rejects(retry);
    assert.equal(createdFaces.faces.length, 2, 'retry must create exactly one fresh declaration');
    assert.equal(createdFaces.faces[1].disposed, true, 'the retry rejection must also release its declaration');
    useFont.clear(input, config);
  } finally {
    createdFaces.restore();
  }
});

test('a GlyphProvider error fallback retries children only when its caller dismisses it', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  let broken = true;
  let rendered = false;
  let dismiss;
  const failure = new GlyphFontError('test-retry', 'retryable test failure');

  function RecoverableChild() {
    if (broken) throw failure;
    rendered = true;
    return null;
  }

  const tree = () =>
    createElement(
      GlyphProvider,
      {
        handle: r3fHandle,
        errorFallback: (error, retry) => {
          assert.equal(error, failure);
          dismiss = retry;
          return null;
        },
      },
      createElement(RecoverableChild),
    );

  const renderer = await create(tree());
  try {
    assert.equal(rendered, false);
    assert.equal(typeof dismiss, 'function');
    broken = false;
    dismiss();
    await renderer.update(tree());
    assert.equal(rendered, true, 'dismiss must retry the repaired child tree');
  } finally {
    await renderer.unmount();
  }
});

function bitmapFontTree(input, options, observed, names) {
  return createElement(
    StrictMode,
    null,
    createElement(
      Suspense,
      { fallback: null },
      names.map((name) => createElement(BitmapFontText, { input, key: name, name, observed, options })),
    ),
  );
}

function BitmapFontText({ input, name, observed, options }) {
  const font = useBitmap(input, options);
  useLayoutEffect(() => {
    observed.set(name, font);
    return () => {
      if (observed.get(name) === font) observed.delete(name);
    };
  }, [font, name, observed]);
  return createElement(Text, { font, name }, name);
}

function RejectedHookFont({ input, config }) {
  useFont(input, config);
  return null;
}

function nearestScene(object) {
  for (let current = object; current !== null; current = current.parent) {
    if (current.isScene === true) return current;
  }
  return undefined;
}

function bytesToArrayBuffer(value) {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

function captureCreatedFontFaces() {
  const fontFace = glyph.fontFace;
  const faces = [];
  glyph.fontFace = function capturedFontFace(...args) {
    const face = Reflect.apply(fontFace, glyph, args);
    faces.push(face);
    return face;
  };
  return {
    faces,
    restore() {
      glyph.fontFace = fontFace;
    },
  };
}
