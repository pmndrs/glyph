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
  ['direct/ordered', '1e2d8a634ec167701b297bdb4b078a69829796399ece317a143c3f1e566b50f6'],
  ['direct/stable', 'c200e06ab9532f36978508647d9563d8277c09eb875b9432b31ff4636db02971'],
  ['indexed/ordered', 'c4867a1e5a5384751112266e116d04bea9905e8689b92b14dfecc142eb94fabf'],
  ['indexed/stable', '11c6f5ba4dc9ad637481a3ed8b4c1aa05c0f3396422a8b7ba39079e9aba31fb6'],
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
