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
import test from 'node:test';
import { StrictMode, createElement, useLayoutEffect } from 'react';

import { createFontLibrary } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { FontLoader } from '@pmndrs/glyph/three';
import '../support/browser-globals.mjs';

import { createUseFont, GlyphProvider, Text, useFont } from '@pmndrs/glyph/react';
import { threeRuntimeDomainReport } from '../../dist/three/runtime-domain.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

// Three's WebGPU renderer drives its animation loop through a host context that node does
// not provide. These tests assert lifecycle accounting, never rendering, so a minimal
// scheduler is enough to let the renderer construct and tear down.
globalThis.self ??= globalThis;
// A no-op scheduler: the renderer may start its loop, but nothing is ever driven, so the
// process stays quiescent and exits. These tests assert lifecycle accounting, never frames.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;

async function loadFixture() {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return {
    font,
    dispose() {
      font.dispose();
      loader.dispose();
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
        Text,
        {
          font,
          style: { fontSize: 20, lineHeight: 1.25 },
          contentBox: { width: { mode: 'exact', size: 300 }, wrap: 'word' },
        },
        'leased',
      ),
    );
    await renderer.unmount();

    fixture.dispose();
    assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
  } finally {
    fixture.dispose();
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
            Text,
            {
              font,
              style: { fontSize: 20, lineHeight: 1.25 },
              contentBox: { width: { mode: 'exact', size: 300 }, wrap: 'word' },
            },
            `cycle ${cycle}`,
          ),
        ),
      );
      await renderer.unmount();
    }

    fixture.dispose();
    assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
  } finally {
    fixture.dispose();
  }
});

test('user font and loader handles may dispose before React releases its Text lease', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const fixture = await loadFixture();
  const { font } = fixture;
  const renderer = await create(
    createElement(
      Text,
      {
        font,
        style: { fontSize: 20, lineHeight: 1.25 },
        contentBox: { width: { mode: 'exact', size: 300 }, wrap: 'word' },
      },
      'still mounted',
    ),
  );

  fixture.dispose();
  assert.equal(font.disposed, true);
  assert.equal(threeRuntimeDomainReport().active, true, 'the mounted Text keeps its renderer domain alive');
  await renderer.unmount();
  fixture.dispose();
  assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

test('library-bound React consumers receive independent Font leases under StrictMode', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const library = createFontLibrary();
  const fontHook = createUseFont(library);
  const request = {
    input: { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await fontHook.preload(request);
  const renderer = await create(hookFontTree(fontHook, request, observed, ['first', 'second']));
  try {
    await waitFor(() => observed.size === 2 && observed.get('first') !== observed.get('second'));
    const first = observed.get('first');
    const second = observed.get('second');
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(first.disposed, false);
    assert.equal(second.disposed, false);

    await renderer.update(hookFontTree(fontHook, request, observed, ['second']));
    await waitFor(() => first.disposed && observed.get('second') === second);
    assert.equal(second.disposed, false, 'unmounting one consumer must not dispose its sibling lease');
  } finally {
    await renderer.unmount();
    library.dispose();
  }
  assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

test('clearing a React font resource leaves its mounted consumer lease live', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const library = createFontLibrary();
  const fontHook = createUseFont(library);
  const request = {
    input: { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await fontHook.preload(request);
  const renderer = await create(hookFontTree(fontHook, request, observed, ['mounted']));
  try {
    await waitFor(() => observed.has('mounted'));
    const mounted = observed.get('mounted');
    assert.ok(mounted !== undefined);
    fontHook.clear(request);
    await Promise.resolve();
    assert.equal(mounted.disposed, false, 'clear releases the Suspense owner, not mounted leases');
  } finally {
    await renderer.unmount();
    library.dispose();
  }
  assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

test('a provider-scoped library survives StrictMode replay and releases its runtime domain', async () => {
  const { create, waitFor } = await import('@react-three/test-renderer/webgpu');
  const library = createFontLibrary();
  const request = {
    input: { baked: { bytes: await readFile(fontUrl), ownership: 'copy' } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  };
  const observed = new Map();
  await createUseFont(library).preload(request);
  const renderer = await create(
    createElement(
      StrictMode,
      null,
      createElement(
        GlyphProvider,
        { library },
        createElement(ProviderFontText, { name: 'provider', observed, request }),
      ),
    ),
  );
  await waitFor(() => observed.has('provider'));
  assert.equal(observed.get('provider')?.disposed, false);
  await renderer.unmount();
  library.dispose();
  assert.deepEqual(threeRuntimeDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

function hookFontTree(fontHook, request, observed, names) {
  return createElement(
    StrictMode,
    null,
    names.map((name) => createElement(HookFontText, { fontHook, key: name, name, observed, request })),
  );
}

function HookFontText({ fontHook, name, observed, request }) {
  const font = fontHook(request);
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
      contentBox: { width: { mode: 'exact', size: 300 }, wrap: 'word' },
    },
    name,
  );
}

function ProviderFontText({ name, observed, request }) {
  const font = useFont(request);
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
      contentBox: { width: { mode: 'exact', size: 300 }, wrap: 'word' },
    },
    name,
  );
}
