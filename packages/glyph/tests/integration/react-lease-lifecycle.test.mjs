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
import { StrictMode, createElement } from 'react';

import { FontRegistry } from '@pmndrs/glyph';
import { createTextRuntime } from '@pmndrs/glyph/core';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import '../support/browser-globals.mjs';

import { Text } from '@pmndrs/glyph/react';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

const dataUrl = (bytes) => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;

// Three's WebGPU renderer drives its animation loop through a host context that node does
// not provide. These tests assert lifecycle accounting, never rendering, so a minimal
// scheduler is enough to let the renderer construct and tear down.
globalThis.self ??= globalThis;
// A no-op scheduler: the renderer may start its loop, but nothing is ever driven, so the
// process stays quiescent and exits. These tests assert lifecycle accounting, never frames.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => undefined;

/** Disposal reports outstanding leases through a warning; silence is the assertion. */
function captureWarnings(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => void warnings.push(args.join(' '));
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

async function loadRuntime() {
  const runtime = await createTextRuntime({
    registry: new FontRegistry(),
    wasm: await readFile(shaperWasmUrl),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return { runtime, font };
}

test('mounting and unmounting a React Text returns every paragraph lease', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const { runtime, font } = await loadRuntime();
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

    // If the reconciler released the lease, teardown has nothing to force-release and
    // says nothing. A warning here means the adapter leaked a paragraph lease.
    const { warnings } = captureWarnings(() => runtime.dispose());
    assert.deepEqual(
      warnings.filter((line) => line.includes('live paragraph lease')),
      [],
      'unmounting must return the paragraph lease before the runtime is torn down',
    );
  } finally {
    if (!font.disposed) runtime.dispose();
  }
});

test('StrictMode remount cycles balance their paragraph leases', async () => {
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const { runtime, font } = await loadRuntime();
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

    const { warnings } = captureWarnings(() => runtime.dispose());
    assert.deepEqual(
      warnings.filter((line) => line.includes('live paragraph lease')),
      [],
      'three StrictMode mount/unmount cycles must leave no outstanding lease',
    );
  } finally {
    if (!font.disposed) runtime.dispose();
  }
});

test('a runtime torn down before its paragraphs unmount stays quiet on the second pass', async () => {
  // The deferred-disposal ordering, driven through React rather than by hand: the
  // application tears the runtime down while the tree is still mounted, and the
  // reconciler disposes afterwards. Teardown force-releases and says so once; the
  // unmount that follows must not throw, because r3f would swallow the error and the
  // same code path is fatal in plain Three.
  const { create } = (await import('@react-three/test-renderer/webgpu')).default;
  const { runtime, font } = await loadRuntime();
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

  const { warnings } = captureWarnings(() => runtime.dispose());
  assert.ok(
    warnings.some((line) => line.includes('live paragraph lease')),
    'tearing down under a live tree must report the force-release',
  );
  await renderer.unmount();
  assert.equal(font.disposed, true);
});
