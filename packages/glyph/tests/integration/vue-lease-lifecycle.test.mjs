/** Tres's custom renderer owns Three-object disposal through `remove()`; the Vue adapter must balance every Glyph lease across that, mirror the R3F contract, and survive Tres disposing the whole scene on canvas unmount. */
import { mountTres, nextTick } from '../support/vue-tres-host.mjs';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { h, shallowRef } from 'vue';

import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';

import { GlyphProvider, Text, TextGroup, clearFont, preloadFont, useFont } from '@pmndrs/glyph/vue';
import { clearBitmap, preloadBitmap, useBitmap } from '@pmndrs/glyph/vue/bitmap';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const multiFormatFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
await glyph.init();
const vueHandle = glyph.handle('three:vue-lease-tests', ThreeConfig);
after(() => vueHandle.dispose());

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

/** Capture the wrapper's exposed Three object through a component ref. */
function capture() {
  const holder = { component: undefined };
  return {
    ref: (component) => {
      holder.component = component ?? holder.component;
    },
    get instance() {
      return holder.component?.instance;
    },
  };
}

function nearestScene(object) {
  for (let current = object; current !== null; current = current.parent) {
    if (current.isScene === true) return current;
  }
  return undefined;
}

/** Resolution of a FontFace load is observed by the adapter one microtask later; flush that and Vue's render queue. */
async function settle() {
  await Promise.resolve();
  await nextTick();
}

test('mounting and unmounting a Vue Text returns every paragraph lease', async () => {
  const fixture = await loadFixture();
  try {
    const host = await mountTres(() =>
      h(GlyphProvider, { handle: vueHandle }, () =>
        h(
          Text,
          {
            font: fixture.font,
            textStyle: { fontSize: 20, lineHeight: 1.25 },
            constraints: { width: { mode: 'exact', size: 300 } },
            layout: { wrap: 'word' },
          },
          () => 'leased',
        ),
      ),
    );
    assert.equal(vueHandle.textCount, 1);
    await host.unmount();
    assert.equal(vueHandle.textCount, 0);
  } finally {
    fixture.dispose();
  }
});

test('Text and TextGroup share the built-in default handle without a provider', async () => {
  const fixture = await loadFixture();
  const group = capture();
  const text = capture();
  try {
    const host = await mountTres(() =>
      h(TextGroup, { ref: group.ref }, () => h(Text, { font: fixture.font, ref: text.ref }, () => 'default')),
    );
    assert.ok(group.instance !== undefined, 'the default handle must construct the retained Three group');
    assert.ok(text.instance !== undefined, 'the default handle must construct the retained Three text');
    assert.equal(text.instance.parent, group.instance, 'Tres inserts the Text below its TextGroup');
    assert.equal(text.instance.text, 'default');
    const mountedText = text.instance;
    const mountedGroup = group.instance;
    await host.unmount();
    assert.equal(mountedText.disposed, true);
    assert.equal(mountedGroup.disposed, true);
  } finally {
    fixture.dispose();
  }
});

test('TextGroup material prop updates the retained Three material property', async () => {
  const fixture = await loadFixture();
  const first = defineTextMaterial((context) => context.createDefaultMaterial());
  const second = defineTextMaterial((context) => context.createDefaultMaterial());
  const material = shallowRef(first);
  const group = capture();
  const host = await mountTres(() =>
    h(TextGroup, { material: material.value, ref: group.ref }, () => h(Text, { font: fixture.font }, () => 'material')),
  );
  try {
    assert.equal(group.instance.material, first);
    material.value = second;
    await nextTick();
    assert.equal(group.instance.material, second);
  } finally {
    await host.unmount();
    fixture.dispose();
  }
});

test('a nested Text flattens into the outer paragraph without a second Three object', async () => {
  const fixture = await loadFixture();
  const text = capture();
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: vueHandle }, () =>
      h(Text, { font: fixture.font, ref: text.ref }, () => [
        'Hello ',
        h(Text, { textStyle: { color: '#ff2f00' } }, () => 'world'),
      ]),
    ),
  );
  try {
    assert.equal(text.instance.text, 'Hello world');
    assert.equal(vueHandle.textCount, 1);
  } finally {
    await host.unmount();
    fixture.dispose();
  }
});

test('a root textStyle list reaches the Three Text as a list', async () => {
  const fixture = await loadFixture();
  const text = capture();
  const textStyle = [{ fontSize: 16, lineHeight: 1.25 }, false, { fontSize: 24 }];
  const host = await mountTres(() => h(Text, { font: fixture.font, textStyle, ref: text.ref }, () => 'list'));
  try {
    assert.deepEqual(text.instance.style, { fontSize: 24, lineHeight: 1.25 });
  } finally {
    await host.unmount();
    fixture.dispose();
  }
});

test('a reactive style change applies through exactly one set call', async () => {
  const fixture = await loadFixture();
  const style = shallowRef({ fontSize: 16 });
  const text = capture();
  const host = await mountTres(() =>
    h(Text, { font: fixture.font, textStyle: style.value, ref: text.ref }, () => 'set'),
  );
  try {
    const object = text.instance;
    let calls = 0;
    const originalSet = object.set;
    object.set = function countedSet(...args) {
      calls += 1;
      return Reflect.apply(originalSet, this, args);
    };
    style.value = { fontSize: 24 };
    await nextTick();
    assert.equal(calls, 1);
    assert.deepEqual(object.style, { fontSize: 24 });
    // An identical snapshot must not republish.
    style.value = { fontSize: 24 };
    await nextTick();
    assert.equal(calls, 1);
  } finally {
    await host.unmount();
    fixture.dispose();
  }
});

test('Text waits for an unloaded FontFace selection and constructs once it loads', async () => {
  const face = glyph.fontFace(new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' }), {
    format: bitmap({ strikes: [16] }),
  });
  assert.equal(face.bitmap.isLoaded(), false);
  const text = capture();
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: vueHandle }, () => h(Text, { font: face.bitmap, ref: text.ref }, () => 'pending')),
  );
  try {
    assert.equal(text.instance, undefined, 'no Three object exists before the selection loads');
    await face.bitmap.load();
    await settle();
    assert.ok(text.instance !== undefined, 'the paragraph constructs after the load the adapter started');
    assert.equal(text.instance.text, 'pending');
  } finally {
    await host.unmount();
    face.dispose();
  }
  assert.equal(vueHandle.textCount, 0);
});

test('GlyphProvider resolves a scoped string alias and never disposes a caller-owned FontFace', async () => {
  const face = glyph.fontFace(new Blob([await readFile(multiFormatFontUrl)], { type: 'model/gltf-binary' }), {
    format: msdf,
  });
  const text = capture();
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: vueHandle, fontFaces: { Inter: face } }, () =>
      h(Text, { font: 'Inter', ref: text.ref }, () => 'named'),
    ),
  );
  try {
    await face.load();
    await settle();
    assert.ok(text.instance !== undefined);
  } finally {
    await host.unmount();
    assert.equal(face.disposed, false, 'the provider must not dispose a caller-owned FontFace declaration');
    face.dispose();
  }
});

test('GlyphProvider disposes declarations it creates from source forms', async () => {
  const input = new Blob([await readFile(multiFormatFontUrl)], { type: 'model/gltf-binary' });
  const created = captureCreatedFontFaces();
  const text = capture();
  try {
    const host = await mountTres(() =>
      h(GlyphProvider, { handle: vueHandle, fontFaces: { Inter: { src: input, format: msdf } } }, () =>
        h(Text, { font: 'Inter', ref: text.ref }, () => 'provider source'),
      ),
    );
    assert.equal(created.faces.length, 1);
    const owned = created.faces[0];
    await owned.load();
    await settle();
    assert.ok(text.instance !== undefined);
    assert.equal(owned.disposed, false);
    await host.unmount();
    assert.equal(owned.disposed, true, 'the provider must dispose declarations it creates from source forms');
  } finally {
    created.restore();
  }
});

test('Text and TextGroup reject a handle prop', async () => {
  const fixture = await loadFixture();
  try {
    await assert.rejects(
      mountTres(() => h(Text, { font: fixture.font, handle: vueHandle }, () => 'invalid')),
      /Vue Text does not accept a handle prop/,
    );
    await assert.rejects(
      mountTres(() => h(TextGroup, { handle: vueHandle })),
      /Vue TextGroup does not accept a handle prop/,
    );
  } finally {
    fixture.dispose();
  }
  assert.equal(vueHandle.textCount, 0);
});

test('GlyphProvider rejects a handle change instead of rebinding mounted objects', async () => {
  const replacement = glyph.handle('three:vue-provider-replacement-test', ThreeConfig);
  const fixture = await loadFixture();
  const handle = shallowRef(vueHandle);
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: handle.value }, () => h(Text, { font: fixture.font }, () => 'stable provider')),
  );
  try {
    handle.value = replacement;
    await nextTick();
    assert.equal(host.errors.length, 1);
    assert.match(String(host.errors[0]), /GlyphProvider handle and fontFaces are immutable/);
    assert.equal(vueHandle.textCount, 1, 'the mounted paragraph stays on its original root');
    assert.equal(replacement.textCount, 0);
  } finally {
    await host.unmount();
    fixture.dispose();
    replacement.dispose();
  }
  assert.equal(vueHandle.textCount, 0);
});

test('GlyphProvider selects one terminal named root without rebinding the anonymous root', async () => {
  const fixture = await loadFixture();
  const hud = vueHandle('hud');
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: hud }, () => h(Text, { font: fixture.font }, () => 'named root')),
  );
  try {
    assert.equal(hud.textCount, 1);
    assert.equal(vueHandle.textCount, 0, 'the handle continues to front only its anonymous root');
  } finally {
    await host.unmount();
    fixture.dispose();
  }
  assert.equal(hud.textCount, 0);
});

test('GlyphProvider string shorthand selects a named root on the built-in default handle', async () => {
  const fixture = await loadFixture();
  const host = await mountTres(() =>
    h(GlyphProvider, { handle: 'provider-string-root' }, () => h(Text, { font: fixture.font }, () => 'named')),
  );
  try {
    host.scene.updateMatrixWorld(true);
    assert.ok(host.scene.children.some(({ name }) => name === '@pmndrs/glyph:provider-string-root'));
  } finally {
    await host.unmount();
    fixture.dispose();
  }
});

test('provider-free canvases isolate independent Glyph roots', async () => {
  const fixture = await loadFixture();
  const first = capture();
  const second = capture();
  const firstHost = await mountTres(() => h(Text, { font: fixture.font, ref: first.ref }, () => 'first'));
  const secondHost = await mountTres(() => h(Text, { font: fixture.font, ref: second.ref }, () => 'second'));
  let firstDrawRoot;
  let secondDrawRoot;
  try {
    const firstScene = nearestScene(first.instance);
    const secondScene = nearestScene(second.instance);
    assert.ok(firstScene !== undefined && secondScene !== undefined);
    assert.notEqual(firstScene, secondScene);
    glyph.shape();
    firstDrawRoot = firstScene.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    secondDrawRoot = secondScene.children.find((child) => child.name.startsWith('@pmndrs/glyph:'));
    assert.ok(firstDrawRoot !== undefined && secondDrawRoot !== undefined);
    assert.notEqual(firstDrawRoot, secondDrawRoot, 'each TresCanvas selects one independent Glyph root');

    await firstHost.unmount();
    assert.equal(second.instance.disposed, false, 'unmounting one canvas leaves the other paragraph alive');
    assert.equal(secondDrawRoot.parent, secondScene, 'the second canvas keeps its Glyph root');
  } finally {
    await secondHost.unmount();
    fixture.dispose();
  }
  assert.equal(firstDrawRoot?.parent, null, 'the first canvas releases its default Glyph root');
  assert.equal(secondDrawRoot?.parent, null, 'the second canvas releases its default Glyph root');
});

test('useFont owns a mounted lease that the component scope releases', async () => {
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const text = capture();
  let ready;
  let fontRef;
  const Consumer = {
    setup() {
      const loaded = useFont(input, { format: bitmap({ strikes: [16] }) });
      ready = loaded.ready;
      fontRef = loaded.font;
      return () =>
        loaded.font.value === undefined ? null : h(Text, { font: loaded.font.value, ref: text.ref }, () => 'hooked');
    },
  };
  const host = await mountTres(() => h(GlyphProvider, { handle: vueHandle }, () => h(Consumer)));
  try {
    assert.equal(fontRef.value, undefined, 'the font is unavailable until the load settles');
    await ready;
    await settle();
    assert.ok(fontRef.value !== undefined);
    assert.equal(fontRef.value.disposed, false);
    assert.ok(text.instance !== undefined);
    assert.equal(vueHandle.textCount, 1);
  } finally {
    await host.unmount();
  }
  assert.equal(vueHandle.textCount, 0);
  assert.equal(fontRef.value?.disposed ?? true, true, 'the mounted lease is released with the component scope');
});

test('preloadFont and the composable share one default-handle resource', async () => {
  const input = new Blob([await readFile(fontUrl)], { type: 'model/gltf-binary' });
  const options = { strikes: [16] };
  const preload = preloadBitmap(input, options);
  assert.equal(preloadBitmap(input, options), preload, 'preload shares one pending operation');
  await preload;
  assert.equal(preloadBitmap(input, options), preload, 'preload keeps the same fulfilled operation');
  let ready;
  let fontRef;
  const Consumer = {
    setup() {
      const loaded = useBitmap(input, options);
      ready = loaded.ready;
      fontRef = loaded.font;
      return () => null;
    },
  };
  const host = await mountTres(() => h(Consumer));
  try {
    await ready;
    await settle();
    const mounted = fontRef.value;
    assert.ok(mounted !== undefined);
    clearBitmap(input, options);
    assert.equal(mounted.disposed, false, 'clear releases the preload owner, not the mounted composable lease');
  } finally {
    await host.unmount();
  }
  assert.equal(fontRef.value?.disposed ?? true, true);
});

test('a rejected preload is shared, releases its declaration, and a later preload retries', async () => {
  const input = new Blob([new Uint8Array([0])], { type: 'model/gltf-binary' });
  const config = { format: bitmap({ strikes: [16] }) };
  const createdFaces = captureCreatedFontFaces();
  try {
    const failed = preloadFont(input, config);
    assert.equal(preloadFont(input, config), failed, 'concurrent callers share the failing operation');
    await assert.rejects(failed);
    assert.equal(createdFaces.faces[0].disposed, true, 'a cached rejection must not retain its failed declaration');
    const retry = preloadFont(input, config);
    assert.notEqual(retry, failed, 'a later explicit preload replaces the settled rejected operation');
    await assert.rejects(retry);
    assert.equal(createdFaces.faces.length, 2, 'retry must create exactly one fresh declaration');
    assert.equal(createdFaces.faces[1].disposed, true, 'the retry rejection must also release its declaration');
    clearFont(input, config);
  } finally {
    createdFaces.restore();
  }
});

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
