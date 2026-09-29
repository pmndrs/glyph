import { defineConfig } from '@pmndrs/labs';

export default defineConfig({
  benchDir: '.',
  benchMatch: '**/*.bench.ts',
  resultsDir: '../.cache/labs-internal',
  blocks: 8,
  blockTime: 0.5,
  minSamples: 20,
  alpha: 0.05,
  minDelta: 0.05,
});
