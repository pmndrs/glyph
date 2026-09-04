import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No cross-origin isolation headers.
//
// Isolation buys exactly one thing, SharedArrayBuffer, and neither shaper nor
// baker Wasm declares a shared memory — measured, not assumed. Requiring it
// costs real reach: COEP require-corp rejects every cross-origin subresource
// that does not carry CORP, which is a CORS-shaped failure for anyone
// embedding this page or serving its assets from elsewhere.
//
// It also cannot rescue a phone on the LAN. WebGPU is gated on a secure
// context, which is a property of the origin rather than of any response
// header, so http://<lan-ip> has no navigator.gpu no matter what is sent.
// That needs HTTPS or a tunnel.
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
  build: {
    emptyOutDir: false,
    outDir: '../dist',
    rollupOptions: {
      input: {
        main: new URL('./landing/index.html', import.meta.url).pathname,
      },
    },
    target: 'es2022',
  },
  plugins: [react()],
  root: 'landing',
  server: {
    // Bind every interface, not just loopback. Vite's default is `localhost`,
    // which listens on `[::1]` alone — another device on the LAN gets a refused
    // connection, with no server-side trace of the attempt at all.
    host: true,
    // The docs build writes thousands of files into both of these, and the npx
    // cache has to live inside the workspace so Next resolves its root here
    // rather than in $HOME. Watching either turns a docs build into a reload
    // storm the page never survives long enough to render through.
    watch: { ignored: ['**/.npx-cache/**', '**/dist/**'] },
  },
});
