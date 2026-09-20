import typegpu from 'unplugin-typegpu/rolldown';
import { defineConfig } from 'tsdown';

const shared = defineConfig({
  // Preserve one emitted module per source file so package-owned integration tests can
  // exercise private contracts without turning them into public package exports.
  // `unbundle` keeps the graph source-shaped for consumer tree shaking and attribution.
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
  // Public entries require stable source-shaped declaration paths. TypeScript
  // emits those with isolated declarations before tsdown bundles the JavaScript graph.
  dts: false,
  deps: {
    neverBundle: true,
  },
  exports: false,
  // The package excludes the map files, so the emitted modules must not reference them.
  sourcemap: 'hidden',
  report: false,
  // Auto-naming wraps constructor calls outside their PURE annotations, preventing
  // unused shader stages from being removed. Shader function metadata retains names.
  plugins: [typegpu({ exclude: [/\.d\.ts$/], autoNamingEnabled: false })],
});

export default defineConfig([
  {
    ...shared,
    entry: ['src/**/*.ts', '!src/**/*.d.ts', '!src/shaders/typegpu/**'],
    // The second build owns these modules and preserves their annotations.
    // Keeping imports external here prevents two builds from emitting the same file.
    inputOptions: { external: (id) => id.includes('/shaders/typegpu/') },
    minify: true,
  },
  {
    ...shared,
    entry: ['src/shaders/typegpu/**/*.ts', '!src/**/*.d.ts'],
    // Oxc's whitespace minification strips PURE annotations. Preserve them so
    // consumer bundlers can remove unused TypeGPU functions and their metadata.
    minify: { codegen: { removeWhitespace: false } },
  },
]);
