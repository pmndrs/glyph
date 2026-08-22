import assert from 'node:assert/strict';
import test from 'node:test';

import { fontBakeDescriptor, soleCoreFontArtifact } from '../../dist/internal/core-bake-policy.js';

test('constructs the one canonical V0 face descriptor', () => {
  assert.deepEqual(fontBakeDescriptor(17), { formatVersion: 0, fontFaceIndex: 17 });
});

test('returns only a sole authoritative core font artifact', () => {
  const artifact = { role: 'font', id: 'core', bytes: new Uint8Array(), sha256: 'hash' };
  assert.equal(soleCoreFontArtifact({ artifacts: [artifact] }), artifact);

  assert.throws(() => soleCoreFontArtifact({ artifacts: [] }), /exactly one core font artifact/);
  assert.throws(() => soleCoreFontArtifact({ artifacts: [artifact, artifact] }), /exactly one core font artifact/);
  assert.throws(
    () => soleCoreFontArtifact({ artifacts: [{ ...artifact, role: 'raster' }] }),
    /exactly one core font artifact/,
  );
});
