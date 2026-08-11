import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';

/**
 * The policy DSL must be a pure authoring-layer change: every variant of the Three
 * render policy compiles to byte-identical wire records before and after. These
 * digests were captured from the hand-numbered programContext programs; a digest
 * change here means the wire encoding changed, not just its authoring.
 */
const GOLDEN = new Map([
  ['direct/ordered', '974cfbfcb258a6fb064a65a9b74106482ca6ae58956bfb246058b7fbb0635b90'],
  ['direct/stable', 'ad1030dd5c3218b7335a6c35fe665cc85b14dab3ed32fb0f028261111823963b'],
  ['indexed/ordered', '7a234623f9935d21068801fb29f8e26c8dcdf1346e92a9e3c36617b18f837705'],
  ['indexed/stable', '7611048f41341bbf7962fd29ffe2b9a318e5e97cbece394043265df11c91cb6d'],
]);

test('the Three render policy compiles to its golden bytes for every variant', () => {
  for (const transform of ['direct', 'indexed']) {
    for (const allocation of ['ordered', 'stable']) {
      const bytes = threeRenderPolicyBytes(undefined, transform, [], allocation);
      const digest = createHash('sha256').update(bytes).digest('hex');
      assert.equal(
        digest,
        GOLDEN.get(`${transform}/${allocation}`),
        `policy bytes changed for ${transform}/${allocation}`,
      );
    }
  }
});
