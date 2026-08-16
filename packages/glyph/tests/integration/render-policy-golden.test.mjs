import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';

/**
 * Byte identity for the DSL-authored Three render policy. Register numbering is
 * program-private, so the DSL port re-pinned these digests once — with the
 * semantic-equivalence test proving the input tables, buffer schemas, and per-lane
 * store dataflow unchanged against the hand-numbered fixtures. From here, any
 * digest drift means the compiled wire records changed and must be re-justified.
 */
const GOLDEN = new Map([
  ['direct/ordered', 'd8c0dc43246ec9b75a0ba38ee7d75bfd4ce38667f8f1a4a2b39fe46f6aa66964'],
  ['direct/stable', '19bcd518b14608b123533eaebee66b5b6e8e509432f28b8f21d4aa16c68788c5'],
  ['indexed/ordered', '2da9a64cffb939c3020dcece3368010713835e7573a29674aa2e2c9c18e717a0'],
  ['indexed/stable', '9bada50f28f087b5f55df8ae502be6a059a144b0b6cb6c4f1e3bae57055fd088'],
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
