import assert from 'node:assert/strict';
import test from 'node:test';

import { copyToOwnedArrayBuffer } from '../../dist/internal/owned-array-buffer.js';

test('copies only the visible bytes of a nonzero-offset view into owned storage', () => {
  const backing = Uint8Array.from([99, 10, 20, 30, 88]);
  const source = backing.subarray(1, 4);
  const copy = copyToOwnedArrayBuffer(source);

  assert.equal(copy.byteLength, 3);
  assert.deepEqual(new Uint8Array(copy), Uint8Array.from([10, 20, 30]));

  backing[2] = 77;
  assert.deepEqual(new Uint8Array(copy), Uint8Array.from([10, 20, 30]));
  new Uint8Array(copy)[0] = 55;
  assert.equal(source[0], 10);

  const transferable = copyToOwnedArrayBuffer(source);
  const transferred = structuredClone(transferable, { transfer: [transferable] });
  assert.equal(transferable.byteLength, 0);
  assert.deepEqual(new Uint8Array(transferred), source);
  assert.equal(source.buffer.byteLength, backing.byteLength);
});
