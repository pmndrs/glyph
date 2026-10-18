import templateCompilerOptions from '@tresjs/core/template-compiler-options';
import vue from '@vitejs/plugin-vue';
import { readFile } from 'node:fs/promises';
import { defaultClientConditions, defineConfig } from 'vite';

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;
const FONT_LICENSES = [
  {
    name: 'Inter 4.1',
    url: new URL('../../benches/fixtures/fonts/inter-v4.1/LICENSE.txt', import.meta.url),
  },
  {
    name: 'Font Awesome Free 6.7.2',
    url: new URL('../../benches/fixtures/fonts/font-awesome-free-6.7.2/LICENSE.txt', import.meta.url),
  },
] as const;

export default defineConfig({
  // The `source` condition runs the adapter from `packages/glyph/src`, so a source edit reloads the playground.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  plugins: [
    // Tres tags are custom elements for the SFC compiler; otherwise Vue tries to resolve them as components.
    vue(templateCompilerOptions),
    {
      name: 'portless-live-check',
      // Vitexec requests port 0 inline; Vite runs app config hooks after that merge.
      config(_config, { command }) {
        if (command !== 'serve' || process.env.PORTLESS_URL === undefined) return;
        const port = Number(process.env.PORT);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('Portless requires a valid PORT for the Tres live server');
        }
        return { server: { port, strictPort: true } };
      },
    },
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
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
});
