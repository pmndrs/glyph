import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createFontStack,
  createRuntimeShaper,
  createTextRuntime,
  FontLeaseError,
  FontRegistry,
  span,
  txt,
} from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import { createTypeGpuTextEngine, defineTypeGpuRasterProgram } from '@pmndrs/text/typegpu';

const interUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const devanagariUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb',
  import.meta.url,
);

test('target-v1 runtime loads, falls back, batches, recovers capacity, and retains ownership', async () => {
  const [interBytes, devanagariBytes] = await Promise.all([readFile(interUrl), readFile(devanagariUrl)]);
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const [inter, devanagari] = await Promise.all([
    runtime.loadFont({
      input: { baked: dataUrl(interBytes) },
      raster: { technique: bitmap, options: { strikes: [16] } },
    }),
    runtime.loadFont({
      input: { baked: dataUrl(devanagariBytes) },
      raster: { technique: bitmap, options: { strikes: [16] } },
    }),
  ]);
  const uiFont = createFontStack(inter, devanagari);
  const warning = span(devanagari, { color: '#ff00ff', fontSize: 18 });
  const labels = runtime.createParagraphBatch({
    technique: bitmap,
    capacity: { size: 32, policy: 'fixed' },
  });
  const label = labels.add({
    font: uiFont,
    text: txt`Latin and fallback: देवनागरी; ${warning`styled`}`,
  });

  assert.throws(() => inter.dispose(), FontLeaseError);
  assert.equal(runtime.hasPendingChanges, true);
  const first = runtime.update();
  assert.equal(first.revision, 1);
  assert.equal(first.paragraphBatches.length, 1);
  assert.equal(labels.current.paragraphs.length, 1);
  assert.ok(labels.current.glyphBatches.length >= 2, 'fallback fonts must become separate physical glyph batches');
  assert.ok(labels.current.glyphRuns.length >= 2, 'fallback ordering must remain explicit in ordered runs');
  const firstInterKey = labels.current.glyphBatches.find((batch) => batch.font === inter).key;
  assert.equal(
    [...labels.current.paragraphs[0].layout.glyphIds].includes(0),
    false,
    'available fallback glyphs must replace primary .notdef glyphs',
  );
  assert.equal(runtime.update(), first, 'a clean synchronous update must preserve revision identity');

  const targetEvents = [];
  const attachment = labels.attach({
    technique: bitmap,
    stage(previous, next) {
      targetEvents.push(['stage', previous?.sourceRevision, next.revision]);
      return {
        status: 'ready',
        stage: {
          sourceRevision: next.revision,
          commit() {
            targetEvents.push(['commit', next.revision]);
            return {
              sourceRevision: next.revision,
              dispose() {
                targetEvents.push(['retire', next.revision]);
              },
            };
          },
          abort() {
            targetEvents.push(['abort', next.revision]);
          },
        },
      };
    },
    dispose() {
      targetEvents.push(['dispose-target']);
    },
  });
  assert.deepEqual(targetEvents, [], 'attachment observation must not stage engine work');
  attachment.prepare();
  assert.equal(attachment.candidate.sourceRevision, 1);
  attachment.commit();
  assert.equal(attachment.current.sourceRevision, 1);

  label.text = 'This replacement is intentionally longer than the fixed capacity.';
  label.text = 'The final desired replacement still exceeds thirty-two glyphs.';
  let overflow;
  try {
    runtime.update();
    assert.fail('fixed capacity should reject the prepared generation');
  } catch (error) {
    overflow = error;
  }
  assert.equal(overflow.kind, 'capacity-exceeded');
  assert.equal(overflow.batch, labels);
  assert.ok(overflow.required > 32);
  assert.equal(labels.preparationError, overflow);
  assert.equal(labels.hasPendingChanges, false, 'an unchanged failed generation must be latched');
  assert.equal(labels.current.revision, 1, 'failed preparation must preserve the complete prior revision');

  labels.setCapacity({ size: overflow.required, policy: 'fixed' });
  const recovered = runtime.update();
  assert.equal(recovered.revision, 2);
  assert.equal(labels.current.revision, 2);
  assert.equal(labels.has(label), true);
  assert.equal(labels.preparationError, undefined);
  const resizedInterKey = labels.current.glyphBatches.find((batch) => batch.font === inter).key;
  assert.notEqual(resizedInterKey, firstInterKey, 'explicit capacity replacement must retire physical keys');
  assert.equal(attachment.source.revision, 2);
  assert.equal(attachment.current.sourceRevision, 1, 'core publication must not mutate live target state');
  attachment.prepare();
  attachment.commit();
  assert.equal(attachment.current.sourceRevision, 2);
  assert.ok(targetEvents.some((event) => event[0] === 'retire' && event[1] === 1));

  const beforePaintStorage = labels.current.glyphBatches.find((batch) => batch.font === inter).storage;
  label.paint = { color: '#00ff00' };
  runtime.update();
  assert.equal(
    labels.current.glyphBatches.find((batch) => batch.font === inter).key,
    resizedInterKey,
    'compatible content updates must preserve physical batch-key identity',
  );

  label.order = 10;
  runtime.update();
  assert.ok(
    labels.current.glyphBatches.every((batch) => batch.dirtyRanges.length === 0),
    'order-only publication must not report canonical instance uploads',
  );
  assert.equal(
    labels.current.glyphBatches.find((batch) => batch.font === inter).storage,
    beforePaintStorage,
    'compatible batches must alternate retained staging storage instead of allocating every revision',
  );

  const snapshot = label.snapshotGlyphs();
  const movedX = snapshot.displayedX.slice();
  movedX[0] += 4;
  label.setGlyphOrigins({ topology: snapshot.topology, x: movedX, y: snapshot.displayedY });
  runtime.update();
  assert.equal(label.snapshotGlyphs().displayedX[0], movedX[0]);
  const movedBatch = labels.current.glyphBatches.find((batch) => batch.font === inter);
  assert.deepEqual(movedBatch.dirtyRanges, [{ start: 0, count: 1 }]);

  label.set({ text: 'Snapshot A', spans: [] });
  const preparingA = runtime.updateAsync();
  label.text = 'Desired state B remains pending';
  const outcomeA = await preparingA;
  assert.equal(outcomeA.status, 'published');
  assert.equal(label.committed.layout.glyphIds.length, 10, 'async preparation must use its call-time snapshot');
  assert.equal(labels.hasPendingChanges, true, 'later desired state must remain dirty after publishing the snapshot');
  runtime.update();
  assert.equal(label.committed.layout.glyphIds.length, 31);

  label.text = 'Superseded A';
  const supersededA = runtime.updateAsync();
  label.text = 'Synchronous B';
  runtime.update();
  const supersededOutcome = await supersededA;
  assert.equal(supersededOutcome.status, 'superseded');
  assert.equal(supersededOutcome.byRevision, supersededOutcome.revision + 1);
  assert.equal(label.committed.layout.glyphIds.length, 13);

  label.text = 'Callback publication';
  const progress = [];
  let callbackWasSynchronous = true;
  const callbackResult = await new Promise((resolve) => {
    const returned = runtime.updateAsync({ onProgress: (value) => progress.push(value) }, (result) => {
      assert.equal(callbackWasSynchronous, false);
      resolve(result);
    });
    assert.equal(returned, undefined, 'callback form must expose no Promise');
    callbackWasSynchronous = false;
  });
  assert.equal(callbackResult.ok, true);
  assert.equal(callbackResult.value.status, 'published');
  assert.deepEqual(
    progress.map(({ preparedParagraphs, totalParagraphs }) => [preparedParagraphs, totalParagraphs]),
    [
      [0, 1],
      [1, 1],
    ],
  );

  const aborted = new AbortController();
  aborted.abort('not needed');
  const abortedRevision = runtime.current;
  const abortedOutcome = await runtime.updateAsync({ signal: aborted.signal });
  assert.equal(abortedOutcome.status, 'aborted');
  assert.equal(abortedOutcome.reason, 'not needed');
  assert.equal(runtime.current, abortedRevision, 'aborted preparation must not publish');

  labels.setCapacity({ size: 1, policy: 'fixed' });
  label.text = 'Capacity failure';
  await assert.rejects(runtime.updateAsync(), (error) => {
    assert.equal(error.kind, 'capacity-exceeded');
    assert.equal(error.batch, labels);
    return true;
  });
  labels.setCapacity({ size: 64, policy: 'fixed' });
  runtime.update();

  labels.dispose();
  assert.equal(label.disposed, true);
  assert.deepEqual(targetEvents.at(-1), ['dispose-target']);
  inter.dispose();
  devanagari.dispose();
  runtime.dispose();
});

test('the maintained TypeGPU engine retains core handles and delegates exact target ownership', async () => {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const root = { device: {} };
  const events = [];
  const states = new Map();
  const program = defineTypeGpuRasterProgram({
    technique: bitmap,
    createTarget(options) {
      assert.equal(options.root, root);
      return {
        root,
        technique: bitmap,
        setParagraphState(paragraph, state) {
          events.push(['state', paragraph, state?.visible]);
          if (state === undefined) states.delete(paragraph);
          else states.set(paragraph, state);
        },
        stage(previous, next) {
          events.push(['stage', previous?.sourceRevision, next.revision]);
          return {
            status: 'ready',
            stage: {
              sourceRevision: next.revision,
              commit() {
                return {
                  sourceRevision: next.revision,
                  draws: Object.freeze([{ glyphs: next.glyphRuns.reduce((sum, run) => sum + run.count, 0) }]),
                  dispose() {
                    events.push(['retire', next.revision]);
                  },
                };
              },
              abort() {},
            },
          };
        },
        encode(_pass, revision, frame) {
          events.push(['encode', revision.sourceRevision, revision.draws[0]?.glyphs, frame.pixelRatio]);
        },
        dispose() {
          events.push(['dispose-target']);
        },
      };
    },
    dispose() {},
  });
  const engine = await createTypeGpuTextEngine({
    root,
    colorFormat: 'rgba8unorm',
    runtime: { registry, shaper },
  });
  const inter = await engine.loadFont({
    input: { baked: dataUrl(await readFile(interUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const labels = engine.createParagraphBatch({ technique: bitmap, program });
  const label = labels.add({ font: inter, text: 'TypeGPU' });
  const identity = label;

  engine.update();
  labels.encode(
    {},
    {
      viewProjection: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      viewport: [320, 200],
      pixelRatio: 2,
    },
  );
  assert.deepEqual(events.at(-1), ['encode', 1, 7, 2]);
  assert.equal(labels.current.sourceRevision, 1);

  label.setTransform([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
  label.visible = false;
  assert.equal(label, identity, 'renderer-owned transform changes must preserve the core paragraph handle');
  assert.equal(states.get(label.id).transform[12], 10);
  assert.equal(states.get(label.id).visible, false);
  assert.equal(engine.current.revision, 1, 'renderer-owned state must not schedule shaping');

  label.text = 'TypeGPU retained';
  engine.update();
  labels.encode(
    {},
    {
      viewProjection: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      viewport: [320, 200],
      pixelRatio: 1,
    },
  );
  assert.equal(labels.current.sourceRevision, 2);
  assert.ok(events.some((event) => event[0] === 'retire' && event[1] === 1));

  labels.dispose();
  assert.equal(label.disposed, true);
  assert.equal(states.size, 0);
  inter.dispose();
  engine.dispose();
  assert.deepEqual(events.at(-1), ['dispose-target']);
});

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
