/* @workflow { "name": "glyph:paper-mono-outline-stream-check", "summary": "Validate the proposed dynamic outline stream against pinned Paper Mono, HarfBuzz, and fontTools oracles.", "requirements": "Network access, uv, the pinned Python dependency, and the vendored HarfBuzz 14.2.0 tools.", "writes": "Temporary downloaded/oracle fonts; with --write, packages/glyph/research/paper-mono/results.json." } */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const sourceCommit = 'e6eaeceaef02e77e3db997711e07a16378de2bd7';
const sourceSha256 = '43369c40e211aab9dda29464b0d715c9f20d90118626a56659607108c9c03dfe';
const sourceUrl = `https://raw.githubusercontent.com/paper-design/paper-mono/${sourceCommit}/fonts/variable/PaperMono%5Bwght%5D.ttf`;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const validator = resolve(repositoryRoot, 'packages/glyph/research/paper-mono/validate.py');
const expected = resolve(repositoryRoot, 'packages/glyph/research/paper-mono/results.json');
const write = process.argv.slice(2).includes('--write');
const scratch = await mkdtemp(join(tmpdir(), 'glyph-paper-mono-outline-stream-'));

try {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Paper Mono download failed: ${response.status} ${response.statusText}`);
  const font = new Uint8Array(await response.arrayBuffer());
  const actualSha256 = createHash('sha256').update(font).digest('hex');
  if (actualSha256 !== sourceSha256) {
    throw new Error(`Paper Mono SHA-256 mismatch: expected ${sourceSha256}, received ${actualSha256}`);
  }

  const fontPath = join(scratch, 'PaperMono[wght].ttf');
  const actualPath = join(scratch, 'results.json');
  await writeFile(fontPath, font);
  await run('uv', ['run', '--script', validator, fontPath, harfBuzzSubset(), harfBuzzShape(), scratch, actualPath]);

  const actual = await readFile(actualPath, 'utf8');
  if (write) {
    await writeFile(expected, actual);
    await run('pnpm', ['exec', 'oxfmt', expected]);
    process.stdout.write(`Wrote ${expected}\n`);
  } else {
    const recorded = await readFile(expected, 'utf8');
    if (!isDeepStrictEqual(JSON.parse(actual), JSON.parse(recorded))) {
      throw new Error(`Paper Mono outline-stream evidence changed; inspect it, then rerun with --write`);
    }
    process.stdout.write(`Paper Mono outline-stream evidence matches ${expected}\n`);
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function harfBuzzSubset() {
  return vendoredHarfBuzz('hb-subset');
}

function harfBuzzShape() {
  return vendoredHarfBuzz('hb-shape');
}

function vendoredHarfBuzz(binary) {
  const target = `${platform() === 'darwin' ? 'darwin' : 'linux'}-${arch()}`;
  if (!['darwin-arm64', 'darwin-x64', 'linux-x64'].includes(target)) {
    throw new Error(`No vendored HarfBuzz 14.2.0 tool for ${target}`);
  }
  return resolve(repositoryRoot, `benches/vendor/harfbuzz/14.2.0/${target}/bin/${binary}`);
}

async function run(command, arguments_) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}
