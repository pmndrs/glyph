import assert from 'node:assert/strict';
import test from 'node:test';

import { bakeProgressMessage, isBakeProgressMessageV0 } from '../../dist/internal/bake-progress-protocol.js';

test('bake progress protocol accepts bounded typed progress', () => {
  const progress = bakeProgressMessage(7, 'raster', 'rasterizing', 42, 100);
  assert.equal(isBakeProgressMessageV0(progress), true);
});

test('bake progress protocol rejects impossible and unknown progress', () => {
  assert.equal(
    isBakeProgressMessageV0({
      type: 'bake-progress-v0',
      id: 1,
      stage: 'raster',
      phase: 'rasterizing',
      completed: 101,
      total: 100,
    }),
    false,
  );
  assert.equal(
    isBakeProgressMessageV0({
      type: 'bake-progress-v0',
      id: 1,
      stage: 'shader',
      phase: 'rasterizing',
      completed: 1,
      total: 2,
    }),
    false,
  );
});
