import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The docs examples: one page, one scene per `?example=<slug>`, hosted at
 * `/examples/` beside the landing and the docs so a docs page can iframe a
 * scene from the same origin.
 *
 * `GLYPH_SOURCE` points the package import at another checkout's
 * `packages/glyph` — the API these scenes are written against lands on a
 * branch that is ahead of this one, and the override is how they are built
 * and verified before it merges. Unset, the workspace package resolves as
 * usual.
 */
const glyphSource = process.env['GLYPH_SOURCE'];

// Each published subpath declares its TypeScript entry under the `source`
// condition, so the exports map is the one place that knows where a subpath
// lives — including the package's own self-imports such as `/tsl/bitmap`.
const glyphAliases = glyphSource === undefined ? [] : sourceAliases(glyphSource);

function sourceAliases(packageDirectory: string): { find: RegExp; replacement: string }[] {
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
    exports: Record<string, { source?: string } | string | null>;
  };
  const aliases: { find: RegExp; replacement: string }[] = [];
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    const source = entry !== null && typeof entry === 'object' ? entry.source : undefined;
    if (source === undefined) continue;
    const specifier = `@pmndrs/glyph${subpath.slice(1)}`;
    aliases.push({
      find: new RegExp(`^${specifier.replaceAll('/', '\\/').replaceAll('.', '\\.')}$`),
      replacement: join(packageDirectory, source),
    });
  }
  return aliases;
}

export default defineConfig({
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: [
      {
        find: 'three/addons/inspector/Inspector.js',
        replacement: new URL('./landing/src/three-inspector-stub.ts', import.meta.url).pathname,
      },
      ...glyphAliases,
    ],
  },
  base: '/examples/',
  build: { emptyOutDir: true, outDir: '../dist/examples', target: 'es2022' },
  // The React Compiler memoizes the scenes; a scene that cannot be compiled fails the `react/react-compiler` lint.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  root: 'examples',
  server: {
    host: true,
    watch: { ignored: ['**/.npx-cache/**', '**/dist/**'] },
  },
});
