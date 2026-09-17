import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    bail: 1,
    environment: 'node',
    fileParallelism: false,
    include: ['scripts/*.ci.vitest.mts'],
  },
});
