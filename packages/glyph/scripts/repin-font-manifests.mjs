/* @workflow
{
  "name": "fixture:font-manifests:generate",
  "summary": "Re-pin the core bake identity recorded in each authenticated font manifest.",
  "requirements": "Built runtime packages and the authenticated source fonts.",
  "writes": "Checked-in font manifest expectedCore identities.",
  "args": []
}
*/
/* @workflow
{
  "name": "fixture:font-manifests:check",
  "summary": "Verify each font manifest still records the identity its core bake produces.",
  "requirements": "Built runtime packages and the authenticated source fonts.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/

// A manifest records what baking its font produces. The core artifact's byte length, fingerprint,
// and SHA-256 move whenever the `PMNDRS_font` shape changes, so they are re-pinned from a real
// bake rather than edited by hand.

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createFontBaker } from '@pmndrs/glyph/bake';

const fontsDirectory = new URL('../../../apps/benchmarks/fixtures/fonts/', import.meta.url);
const check = process.argv.includes('--check');
const baker = await createFontBaker(await readFile(new URL('../dist/font-baker.wasm', import.meta.url)));
const drift = [];

for (const entry of (await readdir(fontsDirectory, { withFileTypes: true })).filter((item) => item.isDirectory())) {
  const directory = new URL(`${entry.name}/`, fontsDirectory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  } catch {
    continue;
  }
  if (manifest.bake?.expectedCore === undefined) continue;
  const fontFile = (await readdir(directory)).find((name) => /\.(?:ttf|otf|ttc|otc)$/i.test(name));
  if (fontFile === undefined) continue;

  const source = await readFile(new URL(fontFile, directory));
  const { artifacts } = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: manifest.face?.fontIndex ?? 0 },
  });
  const artifact = artifacts[0];
  const produced = {
    artifactBytes: artifact.bytes.byteLength,
    artifactFingerprint: artifact.fingerprint,
    artifactSha256: createHash('sha256').update(artifact.bytes).digest('hex'),
  };
  const stale = Object.entries(produced).filter(([key, value]) => manifest.bake.expectedCore[key] !== value);
  if (stale.length === 0) continue;
  if (check) {
    drift.push(`${entry.name}: ${stale.map(([key, value]) => `${key} -> ${value}`).join(', ')}`);
    continue;
  }
  Object.assign(manifest.bake.expectedCore, produced);
  const path = fileURLToPath(new URL('manifest.json', directory));
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`re-pinned ${entry.name}: ${stale.map(([key]) => key).join(', ')}\n`);
}

if (drift.length !== 0) {
  throw new Error(`font manifests no longer record what their core bake produces:\n  ${drift.join('\n  ')}`);
}
