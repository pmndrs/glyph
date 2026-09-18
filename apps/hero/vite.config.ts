/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { defaultClientConditions, defineConfig } from 'vite';

/** Third-party notices bundled with the build: every font and model the hero ships. */
const NOTICES = [
  { name: 'Noto Sans Symbols 2', url: new URL('./fonts/star-symbols/OFL.txt', import.meta.url) },
  { name: 'Geist 1.7.2', url: new URL('./fonts/geist-1.7.2/OFL.txt', import.meta.url) },
  { name: 'Source Serif 4', url: new URL('../../benches/fixtures/fonts/source-serif-4.005/OFL.md', import.meta.url) },
  {
    name: 'Dancing Script',
    url: new URL('../../benches/fixtures/fonts/dancing-script-3.000/OFL.txt', import.meta.url),
  },
  { name: 'DotGothic16', url: new URL('../../benches/fixtures/fonts/dot-gothic-16/OFL.txt', import.meta.url) },
  {
    name: 'Font Awesome Free 6.7.2',
    url: new URL('../../benches/fixtures/fonts/font-awesome-free-6.7.2/LICENSE.txt', import.meta.url),
  },
  // CC-BY-4.0: the credit line inside must travel with the build.
  { name: 'Cute Home Robot by Yandrack', url: new URL('./assets/cute_home_robot/license.txt', import.meta.url) },
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
