import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { fontNotices } from './scripts/font-notices.mts'

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    {
      name: 'font-notices',
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'font-notices.txt', source: await fontNotices() })
      },
    },
  ],
  build: { target: 'es2022' },
})
