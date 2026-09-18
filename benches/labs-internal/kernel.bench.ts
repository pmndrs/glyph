import { readFile } from 'node:fs/promises';

import { assert, bench, group } from '@pmndrs/labs';

import { captureKernelWorkloads } from '../../packages/glyph/scripts/support/engine-kernel-fixture.mts';
import {
  createKernelLabSession,
  kernelLabOperations,
} from '../../packages/glyph/scripts/support/engine-kernel-runner.mjs';

// Discoverable Labs selectors: @kernel @exhaustive @scalar @auto @explicit @pack

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
