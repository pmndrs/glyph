import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';

/**
 * Byte identity for the DSL-authored Three render policy. Register numbering is
 * program-private, so the DSL port re-pinned these digests once — with the
 * semantic-equivalence test proving the input tables, buffer schemas, and reviewed
 * per-lane effect conversion against the hand-numbered fixtures. From here, any
 * digest drift means the compiled wire records changed and must be re-justified.
 */
const GOLDEN = new Map([
  ['direct/ordered', 'ccfdc5d8bb1c296a766aa4484e05567114a06389e5326249b7a8280bd782543f'],
  ['direct/stable', '9946da49a10da6853f6b0d81fbf857afcbec3102e6915412d4e7330ea42dc17e'],
  ['indexed/ordered', '757ac3b50ce223cdf0e553afe33e61533b532a66bd688c34efd2d24cf9dd8892'],
  ['indexed/stable', 'ab2bb53c45191577e26c5356d662b1f8982eafaa1b54154a1cb2974fc33e67e9'],
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
