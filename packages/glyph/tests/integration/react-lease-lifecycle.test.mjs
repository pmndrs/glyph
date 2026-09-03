/**
 * React adapter lease accounting.
 *
 * The adapter holds no disposal code of its own: react-three-fiber's reconciler owns it,
 * calling `disposeOnIdle(child.object)` from `removeChild` unless `dispose={null}` opts
 * out. Two properties of that implementation make lease accounting worth asserting rather
 * than assuming. It defers disposal to idle priority, so a paragraph outlives its unmount
 * and can be disposed after the runtime an application tore down; and it swallows disposal
 * errors in a `try`/`catch`, so a throw there is invisible in React while being fatal in
 * plain Three. Under the test renderer `IS_REACT_ACT_ENVIRONMENT` is set, which makes r3f
 * dispose synchronously — so these assertions observe the settled state directly.
 *
 * StrictMode double-invokes component bodies and, in development, mounts, unmounts, and
 * remounts. A paragraph lease taken per mount and released per unmount must therefore
 * balance across the doubled lifecycle, or every StrictMode application would leak.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { Fragment, StrictMode, Suspense, createElement, useLayoutEffect } from 'react';

import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import '../support/browser-globals.mjs';

import { GlyphProvider, Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const multiFormatFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
await glyph.init();
const r3fHandle = glyph.handle('three:react-lease-tests', ThreeConfig);
after(() => r3fHandle.dispose());

// Three's WebGPU renderer drives its animation loop through a host context that node does
// not provide. These tests assert lifecycle accounting, never rendering, so a minimal
// scheduler is enough to let the renderer construct and tear down.
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

test('mounting and unmounting a React Text returns every paragraph lease', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const { font } = fixture;
  try {
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
          'leased',
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
    face.dispose();
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

test('GlyphProvider selects one terminal named root without rebinding the anonymous root', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const hud = r3fHandle('hud');
  const renderer = await create(
    createElement(GlyphProvider, { handle: hud }, createElement(Text, { font: fixture.font }, 'named root')),
  );
  try {
    assert.equal(hud.textCount, 1);
    assert.equal(r3fHandle.textCount, 0, 'the handle continues to front only its anonymous root');
    assert.equal(r3fHandle('hud'), hud, 'React uses the same idempotent named root as imperative Three');
  } finally {
    await renderer.unmount();
    fixture.dispose();
  }
  assert.equal(hud.textCount, 0);
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
    assert.equal(world.drawRoot.parent, worldScene);
    assert.equal(hud.drawRoot.parent, hudScene);
    assert.notEqual(world.drawRoot.parent, hud.drawRoot.parent);
  } finally {
    await renderer.unmount();
    fixture.dispose();
    world.dispose();
    hud.dispose();
  }
});

test('StrictMode remount cycles balance their paragraph leases', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const { font } = fixture;
  try {
    // StrictMode double-invokes and, in development, mounts/unmounts/remounts. Repeating
    // the whole cycle several times would compound any per-mount imbalance into a warning
    // naming the accumulated count, so a clean teardown after the last cycle is a
    // statement about every cycle.
    for (let cycle = 0; cycle < 3; cycle += 1) {
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
              `cycle ${cycle}`,
            ),
          ),
        ),
      );
      await renderer.unmount();
    }

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

test('R3F-cached React consumers receive independent Font leases under StrictMode', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const request = {
    input: new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' }),
    raster: { raster: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await preloadRequest(request);
  const renderer = await create(hookFontTree(request, observed, ['first', 'second']));
  try {
    await waitFor(() => observed.size === 2 && observed.get('first') !== observed.get('second'));
    const first = observed.get('first');
    const second = observed.get('second');
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.disposed, false);
    assert.equal(second.disposed, false);

    await renderer.update(hookFontTree(request, observed, ['second']));
    await waitFor(() => first.disposed && observed.get('second') === second);
    assert.equal(second.disposed, false, 'unmounting one consumer must not dispose its sibling lease');
  } finally {
    await renderer.unmount();
    clearRequest(request);
  }
  assert.equal(observed.size, 0);
});

test('clearing a React font resource leaves its mounted consumer lease live', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const request = {
    input: new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' }),
    raster: { raster: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await preloadRequest(request);
  const renderer = await create(hookFontTree(request, observed, ['mounted']));
  try {
    await waitFor(() => observed.has('mounted'));
    const mounted = observed.get('mounted');
    assert.ok(mounted !== undefined);
    clearRequest(request);
    await Promise.resolve();
    assert.equal(mounted.disposed, false, 'clear releases the Suspense owner, not mounted leases');
  } finally {
    await renderer.unmount();
  }
  assert.equal(observed.size, 0);
});

test('the generic useFont cache survives StrictMode replay and releases its runtime domain', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const request = {
    input: new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' }),
    raster: { raster: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await preloadRequest(request);
  const renderer = await create(
    createElement(
      StrictMode,
      null,
      createElement(Suspense, { fallback: null }, createElement(HookFontText, { name: 'generic', observed, request })),
    ),
  );
  await waitFor(() => observed.has('generic'));
  assert.equal(observed.get('generic')?.disposed, false);
  await renderer.unmount();
  clearRequest(request);
  assert.equal(observed.size, 0);
});

test('technique convenience preload and hook share the R3F resource', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const options = { strikes: [16] };
  const observed = new Map();
  const preload = useBitmap.preload(input, options);
  assert.equal(useBitmap.preload(input, options), preload, 'preload shares one pending operation');
  await preload;
  assert.equal(useBitmap.preload(input, options), preload, 'preload keeps the same fulfilled operation');
  const renderer = await create(
    createElement(
      Suspense,
      { fallback: null },
      createElement(BitmapFontText, { input, name: 'bitmap', observed, options }),
    ),
  );
  try {
    await waitFor(() => observed.has('bitmap'));
    const mounted = observed.get('bitmap');
    assert.ok(mounted !== undefined);
    useBitmap.clear(input, options);
    assert.equal(mounted.disposed, false, 'clear releases the preload owner, not the mounted hook lease');
  } finally {
    await renderer.unmount();
  }
  assert.equal(observed.size, 0);
});

test('a rejected preload is evicted so the next call creates a new operation', async () => {
  const input = new Blob([new Uint8Array([0])], { type: 'model/gltf-binary' });
  const config = { format: bitmap({ strikes: [16] }) };
  const failed = useFont.preload(input, config);
  assert.equal(useFont.preload(input, config), failed, 'concurrent callers share the failing operation');
  await assert.rejects(failed);
  const retry = useFont.preload(input, config);
  assert.notEqual(retry, failed, 'the call after rejection receives a new operation');
  await assert.rejects(retry);
  useFont.clear(input, config);
});

test('clearing a loaded R3F font resource permits a later preload and mount', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const options = { strikes: [16] };
  const config = { format: { raster: bitmap, options } };
  const firstPreload = useFont.preload(input, config);
  await firstPreload;
  const firstObserved = new Map();
  const firstRequest = { input, raster: { raster: bitmap, options } };
  const firstRenderer = await create(hookFontTree(firstRequest, firstObserved, ['first']));
  await waitFor(() => firstObserved.has('first'));
  await firstRenderer.unmount();
  useFont.clear(input, config);
  const secondPreload = useFont.preload(input, config);
  assert.notEqual(secondPreload, firstPreload, 'clear evicts the fulfilled preload operation');
  await secondPreload;
  const observed = new Map();
  const request = { input, raster: { raster: bitmap, options } };
  const renderer = await create(hookFontTree(request, observed, ['retry']));
  await waitFor(() => observed.has('retry'));
  await renderer.unmount();
  useFont.clear(input, config);
  assert.equal(observed.size, 0);
});

function hookFontTree(request, observed, names) {
  return createElement(
    StrictMode,
    null,
    createElement(
      Suspense,
      { fallback: null },
      names.map((name) => createElement(HookFontText, { key: name, name, observed, request })),
    ),
  );
}

function HookFontText({ name, observed, request }) {
  const font = useFont(request.input, {
    format: { raster: request.raster.raster, options: request.raster.options },
  });
  useLayoutEffect(() => {
    observed.set(name, font);
    return () => {
      if (observed.get(name) === font) observed.delete(name);
    };
  }, [font, name, observed]);
  return createElement(
    Text,
    {
      font,
      name,
      style: { fontSize: 20, lineHeight: 1.25 },
      constraints: { width: { mode: 'exact', size: 300 } },
      layout: { wrap: 'word' },
    },
    name,
  );
}

function preloadRequest(request) {
  return useFont.preload(request.input, {
    format: { raster: request.raster.raster, options: request.raster.options },
  });
}

function clearRequest(request) {
  useFont.clear(request.input, {
    format: { raster: request.raster.raster, options: request.raster.options },
  });
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

function nearestScene(object) {
  for (let current = object; current !== null; current = current.parent) {
    if (current.isScene === true) return current;
  }
  return undefined;
}
