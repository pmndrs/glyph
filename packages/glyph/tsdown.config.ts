import typegpu from 'unplugin-typegpu/rolldown';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/three.ts',
    'src/react.ts',
    'src/tsl.ts',
    'src/typegpu.ts',
    'src/bake.ts',
    'src/runtime-bake.ts',
    'src/config/*.ts',
    'src/three/*.ts',
    '!src/three/codec.ts',
    '!src/three/detached-object.ts',
    '!src/three/engine-plan-target.ts',
    '!src/three/transform-synchronizer.ts',
    'src/react/*.ts',
    'src/raster/*.ts',
    'src/tsl/**/*.ts',
    '!src/tsl/slug-shaders/tsl-compat.ts',
    'src/typegpu/*.ts',
    'src/bakers/{bitmap,msdf,slug}.ts',
    'src/node/{bake,cli}.ts',
    'src/runtime-bake-worker.ts',
    'src/runtime-bakers/*-worker.ts',
    'src/internal/shaper-wasm-url.ts',
  ],
  root: 'src',
  tsconfig: 'tsconfig.build.json',
  platform: 'neutral',
  target: 'es2025',
  format: 'esm',
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
