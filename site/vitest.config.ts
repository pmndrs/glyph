import { resolve } from 'node:path';

import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

import { glyphSourceAliases } from './scripts/glyph-source';

export default defineConfig({
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: glyphSourceAliases(resolve(import.meta.dirname, '../packages/glyph')),
  },
  test: {
    include: ['docs/components/**/*.test.ts', 'examples/src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
