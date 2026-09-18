/// <reference types="vitest/config" />
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { defaultClientConditions, defineConfig } from 'vite';

const FONT_LICENSES = [
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
] as const;

export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: 'font-notices',
      async generateBundle() {
        const notices = await Promise.all(
          FONT_LICENSES.map(
            async ({ name, url }) => `${name}\n${'='.repeat(name.length)}\n\n${await readFile(url, 'utf8')}`,
          ),
        );
        this.emitFile({ type: 'asset', fileName: 'font-notices.txt', source: notices.join('\n\n') });
      },
    },
  ],
  build: { target: 'es2022' },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
