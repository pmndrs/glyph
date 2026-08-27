import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type RuntimeFontBakeRequest } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { createTextRuntime } from '@pmndrs/glyph/core';
import { workerRasterKinds } from '@pmndrs/glyph/runtime-bake';
import { afterEach, test } from 'vitest';

import { glyphExample } from '../src/index.js';

const fixtureDirectory = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);
const shaperWasmUrl = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/**
 * The published external contract, end to end: an external technique's raster
 * never rides the Worker font-bake plan and instead bakes host-side through
 * the baker its own declaration names. The stub stands in for the Worker and
 * enforces its real contract by rejecting any kind outside the declared set;
 * it returns a core artifact baked from the same source so the host-side
 * attachment passes the provenance check.
 */
test('the example technique bakes host-side while the Worker plan stays first-party', async () => {
  const source = await readFile(new URL('Inter-Regular.ttf', fixtureDirectory));
  const outputRoot = await mkdtemp(join(tmpdir(), 'glyph-example-routing-'));
  cleanups.push(() => rm(outputRoot, { recursive: true, force: true }));
  const stubOutput = join(outputRoot, 'Inter-Regular.font.glb');
  await bakeFont({
    input: new URL('Inter-Regular.ttf', fixtureDirectory),
    output: stubOutput,
    font: { fontFaceIndex: 0 },
  });
  const artifact = await readFile(stubOutput);

  const runtime = await createTextRuntime({ wasm: await readFile(shaperWasmUrl) });
  cleanups.push(async () => runtime.dispose());
  const requests: RuntimeFontBakeRequest[] = [];
  const runtimeBake = async (request: RuntimeFontBakeRequest) => {
    for (const raster of request.rasters ?? []) {
      if (!workerRasterKinds.includes(raster.kind)) {
        throw new Error(`runtime font baker does not support raster kind ${raster.kind}`);
      }
    }
    requests.push(request);
    return new Uint8Array(artifact.buffer.slice(artifact.byteOffset, artifact.byteOffset + artifact.byteLength));
  };

  const [example] = await runtime.loadFont({
    input: {
      source: `data:font/ttf;base64,${source.toString('base64')}`,
      runtimeBake,
    },
    rasters: [{ technique: glyphExample, options: { paletteSeed: 17, inset: 0.1 } }],
  });

  assert.equal(requests.length, 1, 'the source load bakes its core through the Worker path once');
  assert.deepEqual(
    (requests[0]?.rasters ?? []).map(({ kind }) => kind),
    [],
    'the Worker plan carries no external kinds',
  );
  assert.equal(example.technique, glyphExample);
  assert.ok(example.data, 'the external raster decodes from its host-baked artifact');
  example.dispose();
});
