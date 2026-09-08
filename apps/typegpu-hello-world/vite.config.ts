import { readFile } from 'node:fs/promises';
import { defineConfig, defaultClientConditions } from 'vite';
import typegpu from 'unplugin-typegpu/vite';

export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    typegpu(),
    {
      name: 'font-license',
      async generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'font-notices.txt',
          source: await readFile(new URL('./assets/Inter-LICENSE.txt', import.meta.url), 'utf8'),
        });
      },
    },
  ],
  build: { target: 'es2022' },
});
