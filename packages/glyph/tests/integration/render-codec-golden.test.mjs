import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { threeCodecBytes } from '../../dist/three/codec.js';

/**
 * Byte identity for the DSL-authored Three render codec. Register numbering is
 * program-private, so the DSL port re-pinned these digests once — with the
 * semantic-equivalence test proving the input tables, buffer schemas, and reviewed
 * per-lane effect conversion against the hand-numbered fixtures. From here, any
 * digest drift means the compiled wire records changed and must be re-justified.
 */
const GOLDEN = new Map([
  ['direct/ordered', 'a68f6e33b5f42a69c4121a2c5b04f52882cdd4e3e495ca85379749778685e56d'],
  ['direct/stable', '362ee48041766289d7e821eee6500b50ab15b547679ba38080e499a4c55af36d'],
  ['indexed/ordered', '423a2b19ce4bfbe77a7c4df6718563e8745d402c225b78c61074a607b2729799'],
  ['indexed/stable', 'b730bad00552d6e309591f0e2f937f7b9eb164d54f4fb355162b1bbafe7f893e'],
]);

test('the Three render codec compiles to its golden bytes for every variant', () => {
  for (const transform of ['direct', 'indexed']) {
    for (const allocation of ['ordered', 'stable']) {
      const bytes = threeCodecBytes(undefined, transform, [], allocation);
      const digest = createHash('sha256').update(bytes).digest('hex');
      assert.equal(
        digest,
        GOLDEN.get(`${transform}/${allocation}`),
        `codec bytes changed for ${transform}/${allocation}`,
      );
    }
  }
});
