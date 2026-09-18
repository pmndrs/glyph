import { readFile } from 'node:fs/promises';

import { assert, bench, group } from '@pmndrs/labs';

import { captureKernelWorkloads } from '../../packages/glyph/scripts/support/engine-kernel-fixture.mts';
import {
  createKernelLabSession,
  kernelLabOperations,
} from '../../packages/glyph/scripts/support/engine-kernel-runner.mjs';

// Discoverable selectors: @kernel @exhaustive @scalar @auto @explicit @pack @breakMasksX1 @breakMasksX2
// @breakMasksX4 @breakMasksX8 @bidiMasksX1 @bidiMasksX2 @bidiMasksX4 @bidiMasksX8 @flaggedScanX1
// @flaggedScanX2 @flaggedScanX4 @flaggedScanX8 @transitionScanX1 @transitionScanX2 @transitionScanX4
// @transitionScanX8 @transitionUniformX1 @transitionUniformX2 @transitionUniformX4 @transitionUniformX8
// @transitionMixedX1 @transitionMixedX2 @transitionMixedX4 @transitionMixedX8 @codec @chunk32 @chunk64
// @chunk128 @i64Chunk64x1 @i64Chunk64x2 @i64Chunk64x4 @i64Chunk64x8

const artifactRoot = new URL('../../packages/glyph/rust/shaper/target/kernel-lab/', import.meta.url);
const variants = ['scalar', 'auto', 'explicit'] as const;
const targets = [22_000, 86_000] as const;

group('retained-engine kernels @kernel @exhaustive', () => {
  for (const variant of variants) {
    for (const target of targets) {
      for (const operation of kernelLabOperations) {
        bench(`${variant} ${String(target)} ${operation} @${variant} @${operation}`, async function* () {
          const [workload] = await captureKernelWorkloads([target]);
          assert(workload !== undefined, 'kernel workload must exist');
          const wasm = await readFile(new URL(`${variant}.wasm`, artifactRoot));
          const session = await createKernelLabSession(wasm, variant, workload);
          const status = yield () => session.run(operation);
          assert.equal(status, 0);
          const hash = await session.verify();
          assert(hash.length > 0, 'kernel output hash must exist');
          session.dispose();
        });
      }
    }
  }
});
