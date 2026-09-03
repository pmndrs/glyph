import typegpu from 'unplugin-typegpu/rolldown';
import { defineConfig } from 'tsdown';

export default defineConfig({
  // Preserve one emitted module per source file so package-owned integration tests can
  // exercise private contracts without turning them into public package exports.
  // `unbundle` keeps the graph source-shaped for consumer tree shaking and attribution.
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  root: 'src',
  tsconfig: 'tsconfig.build.json',
  platform: 'neutral',
  target: 'es2025',
  format: 'esm',
  unbundle: true,
  fixedExtension: false,
  outputOptions: {
    chunkFileNames: 'internal/[name]-[hash].js',
  },
  clean: false,
  // Wildcard public leaves require stable source-shaped declaration paths. TypeScript
  // emits those with isolated declarations before tsdown bundles the JavaScript graph.
  dts: false,
  deps: {
    neverBundle: true,
  },
  exports: false,
  minify: true,
  sourcemap: true,
  report: false,
  plugins: [typegpu({ exclude: [/\.d\.ts$/] })],
});
