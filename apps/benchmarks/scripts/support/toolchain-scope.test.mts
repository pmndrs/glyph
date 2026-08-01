import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceRoot = new URL('../../../../', import.meta.url);

test('keeps optional HarfBuzz tools outside the root contributor toolchain', async () => {
  const [rootMise, benchmarkMise, manifest, workflow] = await Promise.all([
    readFile(new URL('mise.toml', workspaceRoot), 'utf8'),
    readFile(new URL('apps/benchmarks/mise.toml', workspaceRoot), 'utf8'),
    readFile(new URL('apps/benchmarks/package.json', workspaceRoot), 'utf8').then(JSON.parse),
    readFile(new URL('.github/workflows/ci.yml', workspaceRoot), 'utf8'),
  ]);

  assert.equal(rootMise.includes('[tools]'), false, 'root mise must derive only Node, pnpm, and Rust pins');
  assert.match(benchmarkMise, /pipx = "1\.16\.5"/);
  assert.match(benchmarkMise, /"pipx:meson" = "1\.11\.1"/);
  assert.match(benchmarkMise, /"aqua:ninja-build\/ninja" = "1\.13\.2"/);

  assert.doesNotMatch(manifest.scripts.test, /japanese-showcase-subset/);
  assert.match(manifest.scripts['check:japanese-showcase-subset'], /provision-harfbuzz\.mts --check/);
  assert.match(workflow, /mise -C apps\/benchmarks install/);
  assert.match(workflow, /pnpm --filter @pmndrs\/text-benchmarks check:japanese-showcase-subset/);
});
