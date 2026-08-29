import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import typegpu from 'unplugin-typegpu/vite';
import { defaultClientConditions, defineConfig } from 'vite';

import { fontNotices } from './scripts/font-notices.mts';

const FONT_NOTICES_MODULE = 'virtual:font-notices';
const RESOLVED_FONT_NOTICES_MODULE = `\0${FONT_NOTICES_MODULE}`;
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['source', ...defaultClientConditions],
  },
  plugins: [
    typegpu(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    {
      name: 'font-notices',
      resolveId(id) {
        return id === FONT_NOTICES_MODULE ? RESOLVED_FONT_NOTICES_MODULE : undefined;
      },
      async load(id) {
        if (id !== RESOLVED_FONT_NOTICES_MODULE) return undefined;
        return `export default ${JSON.stringify(await fontNotices())}`;
      },
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'font-notices.txt', source: await fontNotices() });
      },
    },
  ],
  build: { target: 'es2022' },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // A fixed strict port: forwarded --port flags do not survive the nested pnpm
  // dev chain, and a silently drifted port serves stale confusion instead of
  // failing loudly.
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS, port: 5273, strictPort: true },
});
