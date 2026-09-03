import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

import { glyphSourceAliases } from '../../scripts/glyph-source';

/**
 * The explainer element and every example scene, built to stable names under
 * `docs/assets/` so a docs page can load them with one script and one
 * stylesheet tag; `copy:docs-assets` carries the folder into the built site.
 */
export default defineConfig({
  base: '/docs/assets/',
  build: {
    emptyOutDir: true,
    outDir: 'docs/assets',
    rollupOptions: {
      input: 'docs/components/load-explainers.ts',
      output: {
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css')) ? 'explainer.css' : '[name][extname]',
        entryFileNames: 'explainer.js',
      },
    },
    target: 'es2022',
  },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: [
      {
        find: 'three/addons/inspector/Inspector.js',
        replacement: new URL('../../landing/src/three-inspector-stub.ts', import.meta.url).pathname,
      },
      ...glyphSourceAliases(),
    ],
  },
});
