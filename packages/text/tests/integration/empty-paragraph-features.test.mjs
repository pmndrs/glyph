import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRuntimeShaper, createTextRuntime, FontRegistry } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';

const interUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

function dataUrl(bytes) {
  return `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
}

test('a paragraph-wide font feature survives empty text and still rejects an empty explicit range', async () => {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const inter = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(interUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  // An unbounded feature covers whatever it is applied to, so empty text makes it vacuous. A feature-styled
  // input field is created before its first character is typed, and that must not fail preparation.
  const field = batch.add({
    font: inter,
    text: '',
    style: { features: [{ tag: 'kern' }, { tag: 'liga' }] },
  });
  runtime.update();
  assert.equal(batch.preparationError, undefined, 'an unbounded feature must not fail an empty paragraph');
  assert.equal(batch.current.paragraphs[0].layout.glyphIds.length, 0);

  // The same paragraph shapes normally once it has text, proving the feature was carried rather than discarded.
  field.text = 'Waffle';
  runtime.update();
  assert.equal(batch.preparationError, undefined);
  assert.ok(batch.current.paragraphs[0].layout.glyphIds.length > 0);

  // An explicitly empty range is still a caller error rather than a vacuous no-op. Preparation reports it as a
  // typed failure and keeps the prior revision current, rather than throwing out of the synchronization call.
  const explicit = batch.add({
    font: inter,
    text: 'Waffle',
    style: { features: [{ tag: 'kern', start: 2, end: 2 }] },
  });
  const published = batch.current.revision;
  assert.throws(
    () => runtime.update(),
    (error) =>
      error.kind === 'preparation-failed' &&
      /feature kern must be a non-empty UTF-16 range/.test(String(error.cause?.message)),
  );
  assert.equal(batch.current.revision, published, 'a rejected feature range must preserve the prior revision');

  explicit.dispose();
  field.dispose();
  batch.dispose();
  runtime.dispose();
  inter.dispose();
});
