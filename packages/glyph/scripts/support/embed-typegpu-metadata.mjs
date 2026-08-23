import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Embeds TypeGPU's shader metadata into the emitted JavaScript of the `/typegpu` subpath.
 *
 * JavaScript-authored TypeGPU functions carry a `'use gpu'` directive that the TypeGPU
 * compiler normally consumes through a consumer-side bundler plugin
 * (`unplugin-typegpu`). A published subpath cannot demand that every consumer runs a
 * transform over this package's `dist`, so the build applies the same transform here,
 * once, over the staged `typegpu.js` entry and the modules beside it. The emitted
 * functions then resolve to WGSL in any host without extra tooling.
 *
 * The transform is additive: it wraps each shader function with its parsed syntax tree
 * and external-name table and never rewrites surrounding code, so `/core`, `/three`,
 * and `/tsl` outputs are untouched.
 *
 * @param {string} stagingDirectory The staged distribution whose `typegpu` outputs are rewritten in place.
 */
export async function embedTypeGpuMetadata(stagingDirectory) {
  const { default: typegpuPlugin } = await import('unplugin-typegpu/rollup');
  const plugin = typegpuPlugin();
  const moduleDirectory = join(stagingDirectory, 'typegpu');
  const entries = [
    'typegpu.js',
    ...(await readdir(moduleDirectory)).filter((name) => name.endsWith('.js')).map((name) => join('typegpu', name)),
  ];
  for (const entry of entries) {
    const file = join(stagingDirectory, entry);
    const source = await readFile(file, 'utf8');
    if (!source.includes('use gpu')) continue;
    const transformed = await plugin.transform.handler.call({}, source, file);
    if (transformed && typeof transformed.code === 'string' && transformed.code !== source) {
      await writeFile(file, transformed.code);
    }
  }
}
