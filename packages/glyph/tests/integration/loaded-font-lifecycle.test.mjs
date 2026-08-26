import assert from 'node:assert/strict';
import test from 'node:test';

import { LoadedFontImpl, observeLoadedFontDispose } from '../../dist/loaded-font.js';

test('loaded-font disposal remains total when one observer fails', () => {
  let observerAttempts = 0;
  let successfulObserverCalls = 0;
  let releaseCalls = 0;
  const font = new LoadedFontImpl({
    runtime: {},
    font: {},
    technique: {},
    raster: undefined,
    data: {},
    release: () => {
      releaseCalls += 1;
    },
  });
  observeLoadedFontDispose(font, () => {
    observerAttempts += 1;
    if (observerAttempts === 1) throw new Error('injected observer failure');
  });
  observeLoadedFontDispose(font, () => {
    successfulObserverCalls += 1;
  });

  const warnings = [];
  const originalWarn = console.warn;
  try {
    console.warn = (...values) => warnings.push(values.join(' '));
    assert.doesNotThrow(() => font.dispose());
    assert.equal(successfulObserverCalls, 1, 'one observer cannot prevent the remaining observers');
    assert.equal(releaseCalls, 1, 'one observer cannot prevent resource release');
    assert.doesNotThrow(() => font.dispose());
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(observerAttempts, 2, 'repeated disposal retries only the observer that failed');
  assert.equal(successfulObserverCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.ok(warnings.some((warning) => warning.includes('injected observer failure')));
});
