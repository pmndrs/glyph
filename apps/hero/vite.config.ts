/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { defaultClientConditions, defineConfig } from 'vite';

/** Third-party notices bundled with the build: every font the hero ships. */
const FIXTURES = '../../benches/fixtures/fonts';
const NOTICES = [
  { name: 'Geist 1.7.2', url: new URL('./fonts/geist-1.7.2/OFL.txt', import.meta.url) },
  { name: 'Source Serif 4.005', url: new URL(`${FIXTURES}/source-serif-4.005/OFL.md`, import.meta.url) },
  { name: 'Amiri 1.002', url: new URL(`${FIXTURES}/amiri-1.002/OFL.txt`, import.meta.url) },
  { name: 'Noto Sans Devanagari', url: new URL(`${FIXTURES}/noto-sans-devanagari/OFL.txt`, import.meta.url) },
  { name: 'Noto Sans Thai', url: new URL('./fonts/noto-sans-thai/OFL.txt', import.meta.url) },
  { name: 'Noto Sans CJK JP 2.004', url: new URL(`${FIXTURES}/noto-sans-cjk-2.004/LICENSE.txt`, import.meta.url) },
] as const;

export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: 'notices',
      async generateBundle() {
        const notices = await Promise.all(
          NOTICES.map(async ({ name, url }) => `${name}\n${'='.repeat(name.length)}\n\n${await readFile(url, 'utf8')}`),
        );
        this.emitFile({ type: 'asset', fileName: 'notices.txt', source: notices.join('\n\n') });
      },
    },
  ],
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
