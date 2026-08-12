import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const sourceRoot = new URL('../../src/', import.meta.url).pathname;

/**
 * The technique schema is the only witness to buffer identity. Nobody else may
 * hold a literal buffer id: not executor lookups, not attribute-name strings,
 * not parallel const tables. Schema declarations (raster techniques and the
 * Three policy's own buffers) are the sanctioned definition sites.
 */
const DEFINITION_SITES = new Set([
  'raster/bitmap-technique.ts',
  'raster/msdf.ts',
  'raster/slug-technique.ts',
  'three/render-policy.ts',
]);

test('buffer ids appear only inside schema declarations', async () => {
  const offenders = [];
  for await (const file of walk(sourceRoot)) {
    const relative = file.slice(sourceRoot.length);
    const text = await readFile(file, 'utf8');
    for (const [index, line] of text.split('\n').entries()) {
      const lookup = /\.get\(\s*\d+\s*\)/.exec(line);
      if (lookup && /byPolicyId|buffers/.test(line)) {
        offenders.push(`${relative}:${index + 1} literal buffer lookup: ${line.trim()}`);
      }
      if (/_pmndrsText_\d/.test(line)) {
        offenders.push(`${relative}:${index + 1} literal attribute name: ${line.trim()}`);
      }
      if (!DEFINITION_SITES.has(relative) && /BUFFER_ID\s*=\s*\d/.test(line)) {
        offenders.push(`${relative}:${index + 1} parallel id const: ${line.trim()}`);
      }
      // Buffer id sequences and vector widths derive from a schema, never from a
      // hand-rolled numeric list: no literal-width policy-buffer builders outside
      // their core definition, no literal id arrays mapped into buffer lookups,
      // and no restated system-buffer ids.
      if (relative !== 'core/render-policy.ts' && /(?:floatBuffers|u32Buffers)\(\s*\[/.test(line)) {
        offenders.push(`${relative}:${index + 1} literal buffer widths: ${line.trim()}`);
      }
      if (/\[\s*\d+\s*(?:,\s*\d+\s*){2,}\]\.map\(/.test(line)) {
        offenders.push(`${relative}:${index + 1} literal buffer id range: ${line.trim()}`);
      }
      if (/transformBufferId:\s*\d/.test(line)) {
        offenders.push(`${relative}:${index + 1} restated system buffer id: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'buffer identity leaked outside schema declarations');
});

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}
