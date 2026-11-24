import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultClientConditions, defineConfig } from 'vite';

import { glyphSourceAliases } from '../../scripts/glyph-source';

const generatedRootFiles = [
  'font-awesome-icons-msdf.font.glb',
  'geist-msdf.font.glb',
  'explainer.css',
  'explainer.js',
  'introduction.css',
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
      input: 'docs/components/load-explainers.ts',
      output: {
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'explainer.css' : '[name][extname]'),
        // A section's table and each scene are named for what they are, so a page's network log says which
        // sections and scenes it fetched; `verify:pages` reads those names.
        chunkFileNames: (chunk) => {
          const module = chunk.facadeModuleId ?? '';
          const section = /\/docs\/components\/pages\/([\w-]+)\/index\.tsx$/.exec(module);
          if (section !== null) return `assets/section-${section[1]}-[hash].js`;
          const scene = /\/examples\/src\/scenes\/([\w-]+)\/scene\.tsx$/.exec(module);
          if (scene !== null) return `assets/scene-${scene[1]}-[hash].js`;
          return 'assets/[name]-[hash].js';
        },
        entryFileNames: 'explainer.js',
      },
    },
    target: 'es2022',
  },
  plugins: [cleanGeneratedDocsAssets, react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: glyphSourceAliases(),
  },
});
