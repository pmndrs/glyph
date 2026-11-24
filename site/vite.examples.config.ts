import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type Plugin } from 'vite';

import { glyphSourceAliases } from './scripts/glyph-source';

const reloadSingletonRuntime: Plugin = {
  name: 'glyph-examples-reload-singleton-runtime',
  enforce: 'pre',
  handleHotUpdate({ server }) {
    // Glyph's engine and raster registries intentionally belong to one module
    // realm. React refresh can otherwise evaluate a lazy scene against fresh
    // codec objects while the previous registry is still alive, poisoning all
    // later gallery activations. Preserve that ownership invariant in dev by
    // replacing the page realm instead of hot-swapping a partial scene graph.
    server.ws.send({ type: 'full-reload' });
    return [];
  },
};

/**
 * The examples app, hosted at `/examples/` beside the landing and the docs:
 * the gallery at its root, and one scene per `?example=<slug>` for a docs page
 * to iframe. Both run scenes through the explainer element the docs pages
 * use inline; see `docs/components/explainer`.
 */
export default defineConfig({
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: [
      {
        find: 'three/addons/inspector/Inspector.js',
        replacement: new URL('./landing/src/three-inspector-stub.ts', import.meta.url).pathname,
      },
      ...glyphSourceAliases(),
    ],
  },
  base: '/examples/',
  build: { emptyOutDir: true, outDir: '../dist/examples', target: 'es2022' },
  // The React Compiler memoizes the scenes; a scene that cannot be compiled fails the `react/react-compiler` lint.
  plugins: [reloadSingletonRuntime, react(), babel({ presets: [reactCompilerPreset()] })],
  root: 'examples',
  server: {
    host: true,
    watch: { ignored: ['**/.npx-cache/**', '**/dist/**'] },
  },
});
