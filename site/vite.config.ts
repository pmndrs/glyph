import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** The shaper Wasm wants cross-origin isolation, exactly as the r3f example serves it. */
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

export default defineConfig({
  resolve: {
    // drei and the app must share one React and one three, or hooks resolve
    // against a second copy and every context read returns null.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: {
      // See landing/src/three-inspector-stub.ts — upstream import cycle.
      'three/addons/inspector/Inspector.js': new URL('./landing/src/three-inspector-stub.ts', import.meta.url).pathname,
    },
  },
  build: { emptyOutDir: false, outDir: '../dist', target: 'es2022' },
  plugins: [react()],
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  root: 'landing',
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    // The docs build writes thousands of files into both of these, and the npx
    // cache has to live inside the workspace so Next resolves its root here
    // rather than in $HOME. Watching either turns a docs build into a reload
    // storm the page never survives long enough to render through.
    watch: { ignored: ['**/.npx-cache/**', '**/dist/**'] },
  },
});
