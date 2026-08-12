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
