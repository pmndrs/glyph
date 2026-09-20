/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { defaultClientConditions, defineConfig } from 'vite';

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;
const FONT_LICENSE = new URL('../../benches/fixtures/fonts/inter-v4.1/LICENSE.txt', import.meta.url);

export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: 'font-notices',
      async generateBundle() {
        const license = await readFile(FONT_LICENSE, 'utf8');
        this.emitFile({ type: 'asset', fileName: 'font-notices.txt', source: `Inter 4.1\n=========\n\n${license}` });
      },
    },
  ],
  build: { target: 'es2022' },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
