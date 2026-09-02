import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { threeCodecBytes } from '../../dist/three/render-policy.js';

/**
 * Byte identity for the DSL-authored Three render policy. Register numbering is
 * program-private, so the DSL port re-pinned these digests once — with the
 * semantic-equivalence test proving the input tables, buffer schemas, and reviewed
 * per-lane effect conversion against the hand-numbered fixtures. From here, any
 * digest drift means the compiled wire records changed and must be re-justified.
 */
const GOLDEN = new Map([
  ['direct/ordered', '8152d186b66a43d09d256b8d558e647873eaeec87e4e2129c7a8ce6dd0cb381b'],
  ['direct/stable', 'd2cba1afda4d1abd4e63042540d960932b9a1c8931e32457024a234654f15e1c'],
  ['indexed/ordered', '3ab81a80506ed315c7527aaeaeef054b2c45b0c7ddbbf55e8719e428508bca1b'],
  ['indexed/stable', '60d56678500883ce24cb70df7ca4c3b76e6b40e28f7f6bffee08f32c04e1a0cd'],
]);

test('the Three render policy compiles to its golden bytes for every variant', () => {
  for (const transform of ['direct', 'indexed']) {
    for (const allocation of ['ordered', 'stable']) {
      const bytes = threeCodecBytes(undefined, transform, [], allocation);
      const digest = createHash('sha256').update(bytes).digest('hex');
      assert.equal(
        digest,
        GOLDEN.get(`${transform}/${allocation}`),
        `policy bytes changed for ${transform}/${allocation}`,
      );
    }
  }
});
