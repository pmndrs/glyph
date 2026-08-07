import { defineConfig } from 'tsdown';
import typegpu from 'unplugin-typegpu/rolldown';

// The published layout mirrors `src/` one module at a time: `package.json`
// exports, the `pmndrs-text-bake` bin, and the package tests all address
// individual `dist/**` files, so the build stays unbundled and keeps
// `src` as the emit root.
export default defineConfig({
  entry: ['src/**/*.ts'],
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  root: 'src',
  unbundle: true,
  format: 'esm',
  // The package serves browser and Node subpaths from one ESM tree of `.js` modules, and the
  // pinned compiler already owns the language level, so no platform assumption or downlevelling
  // enters the output.
  platform: 'neutral',
  fixedExtension: false,
  hash: false,
  target: false,
  // Rolldown rewrites module boundaries, so both map kinds stay on for local debugging and
  // editor navigation. `package.json` keeps them out of the published tarball.
  sourcemap: true,
  dts: { sourcemap: true },
  // `dist` also holds the wasm modules and ABI manifests that `scripts/build.mjs`
  // emits around this step, so cleaning is scoped to the TypeScript output.
  clean: ['dist/**/*.js', 'dist/**/*.d.ts', 'dist/**/*.map', 'dist/.tsbuildinfo'],
  deps: { neverBundle: true },
  report: false,
  plugins: [typegpu()],
});
