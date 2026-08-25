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
  ['direct/ordered', 'bbf83dc7b2fd77300a5f48e7effa5070d92e34dcca6ffcb2191e8621eca331f1'],
  ['direct/stable', 'ad643b825a7a7ed7b48ae8b73d2fdb3808e6ba48e252a679e62090ff509cf972'],
  ['indexed/ordered', 'd2804f3ba5e5bfaad7b273a162db260d5bb5e0da1dadc5a647a6d942057f6e1f'],
  ['indexed/stable', '7be47defab2a20eb5515637a455b7fcc6827f4b971a0ebd81d87ab4d60b717c2'],
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
