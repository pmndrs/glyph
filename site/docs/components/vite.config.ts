import react from '@vitejs/plugin-react';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const generatedRootFiles = [
  'font-awesome-icons-msdf.font.glb',
  'geist-msdf.font.glb',
  'glyph-explainer.css',
  'glyph-explainer.js',
  'lovers-quarrel-slug.font.glb',
  'mplus1p-japanese.font.glb',
  'runtime-bake-worker.js',
  'text-shaper.wasm',
  'vt323-bitmap.font.glb',
] as const;

const cleanGeneratedDocsAssets = {
  name: 'clean-generated-docs-assets',
  apply: 'build' as const,
  async buildStart() {
    const output = resolve('docs/assets');
    await rm(resolve(output, 'assets'), { force: true, recursive: true });
    await Promise.all(generatedRootFiles.map((file) => rm(resolve(output, file), { force: true })));
  },
};

export default defineConfig({
  base: '/docs/assets/',
  build: {
    emptyOutDir: false,
    outDir: 'docs/assets',
    rollupOptions: {
      input: 'docs/components/glyph-explainer.tsx',
      output: {
        assetFileNames: '[name][extname]',
        entryFileNames: 'glyph-explainer.js',
      },
    },
    target: 'es2022',
  },
  plugins: [cleanGeneratedDocsAssets, react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
  },
});
