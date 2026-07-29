import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { fontNotices } from './scripts/font-notices.mts';

const FONT_NOTICES_MODULE = 'virtual:font-notices';
const RESOLVED_FONT_NOTICES_MODULE = `\0${FONT_NOTICES_MODULE}`;

export default defineConfig({
  plugins: [
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
});
