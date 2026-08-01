import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterBatchStage } from '@pmndrs/text';

test('raster stages publish once and transfer ownership before abort', () => {
  let commits = 0;
  let releases = 0;
  const batch = { dispose() {} };
  const stage = defineRasterBatchStage(
    batch,
    () => {
      commits += 1;
    },
    () => {
      releases += 1;
    },
  );

  assert.equal(stage.batch, batch);
  stage.commit();
  stage.commit();
  stage.abort();
  assert.equal(commits, 1);
  assert.equal(releases, 0);
});

test('raster-stage abort is idempotent and prevents later publication', () => {
  let commits = 0;
  let releases = 0;
  const stage = defineRasterBatchStage(
    { dispose() {} },
    () => {
      commits += 1;
    },
    () => {
      releases += 1;
    },
  );

  stage.abort();
  stage.abort();
  stage.commit();
  assert.equal(commits, 0);
  assert.equal(releases, 1);
});
