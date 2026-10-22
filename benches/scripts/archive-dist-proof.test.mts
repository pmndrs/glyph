import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertArchiveSha256,
  assertCompleteArchiveEnvironment,
  assertDeliveredEntries,
  assertInstalledDist,
  assertProofServerNonce,
  installedDistResponseSource,
  sha256,
} from './support/archive-dist-proof.mts';

test('rejects a wrong frozen archive digest before installation', () => {
  const bytes = Buffer.from('frozen package');
  assert.doesNotThrow(() => assertArchiveSha256(bytes, sha256(bytes)));
  assert.throws(() => assertArchiveSha256(bytes, sha256(Buffer.from('different package'))), /Archive SHA-256/u);
});

test('archive mode rejects partial environment tuples before browser startup', () => {
  const complete = ['/installed', '/receipts', '/archive.tgz', 'a'.repeat(64)];
  assert.doesNotThrow(() => assertCompleteArchiveEnvironment([undefined, undefined, undefined, undefined]));
  assert.doesNotThrow(() => assertCompleteArchiveEnvironment(complete));
  for (let missing = 0; missing < complete.length; missing += 1) {
    const partial: (string | undefined)[] = [...complete];
    partial[missing] = undefined;
    assert.throws(() => assertCompleteArchiveEnvironment(partial), /requires package root/u);
  }
});

test('server proof nonce rejects stale or missing proxy responses', () => {
  assert.doesNotThrow(() => assertProofServerNonce({ 'x-glyph-proof-nonce': 'fresh' }, 'fresh'));
  assert.throws(() => assertProofServerNonce({}, 'fresh'), /did not route/u);
  assert.throws(() => assertProofServerNonce({ 'x-glyph-proof-nonce': 'stale' }, 'fresh'), /did not route/u);
});

test('maps only same-origin Vite URLs inside the installed dist tree', () => {
  const origin = 'http://127.0.0.1:5273';
  const viteRoot = '/tmp/consumer';
  const dist = `${viteRoot}/node_modules/@pmndrs/glyph/dist`;
  assert.equal(
    installedDistResponseSource(`${origin}/node_modules/@pmndrs/glyph/dist/index.js?v=1`, origin, viteRoot, dist),
    'index.js',
  );
  assert.equal(
    installedDistResponseSource(
      `${origin}/node_modules/@pmndrs/glyph/dist/font-baker.wasm?url`,
      origin,
      viteRoot,
      dist,
    ),
    'font-baker.wasm',
  );
  assert.equal(
    installedDistResponseSource(`${origin}/@fs${dist}/text-shaper.wasm`, origin, viteRoot, dist),
    'text-shaper.wasm',
  );
  assert.equal(installedDistResponseSource(`${origin}/entry.js`, origin, viteRoot, dist), undefined);
  assert.equal(
    installedDistResponseSource(`http://evil.example/@fs${dist}/index.js`, origin, viteRoot, dist),
    undefined,
  );
  assert.equal(
    installedDistResponseSource(`${origin}/node_modules/@pmndrs/glyph/dist/%2e%2e%2findex.js`, origin, viteRoot, dist),
    undefined,
  );
  assert.equal(
    installedDistResponseSource(`${origin}/node_modules/@pmndrs/glyph/dist/%2e%2e/index.js`, origin, viteRoot, dist),
    undefined,
  );
  assert.equal(
    installedDistResponseSource(
      `${origin}/@fs/tmp/other/node_modules/@pmndrs/glyph/dist/index.js`,
      origin,
      viteRoot,
      dist,
    ),
    undefined,
  );
});

test('a failed root-relative installed request resolves to its archive member', () => {
  const origin = 'http://127.0.0.1:5273';
  assert.equal(
    installedDistResponseSource(
      `${origin}/node_modules/@pmndrs/glyph/dist/internal/span-cascade.js`,
      origin,
      '/tmp/consumer',
      '/tmp/consumer/node_modules/@pmndrs/glyph/dist',
    ),
    'internal/span-cascade.js',
  );
});

test('workspace Glyph source and dist URLs remain identifiable as forbidden archive fallbacks', () => {
  const origin = 'http://127.0.0.1:5273';
  const viteRoot = '/work/repo/benches';
  const workspaceGlyph = '/work/repo/packages/glyph';
  for (const member of ['dist/index.js', 'src/index.ts']) {
    const url = `${origin}/@fs${workspaceGlyph}/${member}`;
    assert.equal(installedDistResponseSource(url, origin, viteRoot, workspaceGlyph), member);
    assert.equal(installedDistResponseSource(url, origin, viteRoot, '/tmp/installed/@pmndrs/glyph/dist'), undefined);
  }
});

test('rejects one altered installed JS or Wasm member', () => {
  const archive = { 'index.js': sha256(Buffer.from('entry')), 'text-shaper.wasm': sha256(Buffer.from('wasm')) };
  assert.doesNotThrow(() => assertInstalledDist(archive, { ...archive }));
  for (const member of Object.keys(archive)) {
    assert.throws(
      () => assertInstalledDist(archive, { ...archive, [member]: sha256(Buffer.from('altered')) }),
      /every installed JS\/Wasm/u,
    );
  }
});

test('requires successful installed entry and shaper responses', () => {
  const expected = ['index.js', 'text-shaper.wasm'];
  assert.doesNotThrow(() =>
    assertDeliveredEntries(
      expected.map((source) => ({ source, status: 200 })),
      expected,
    ),
  );
  assert.throws(() => assertDeliveredEntries([{ source: 'text-shaper.wasm', status: 200 }], expected), /index.js/u);
  assert.throws(
    () =>
      assertDeliveredEntries(
        [
          { source: 'index.js', status: 200 },
          { source: 'text-shaper.wasm', status: 404 },
        ],
        expected,
      ),
    /text-shaper.wasm/u,
  );
  assert.throws(
    () =>
      assertDeliveredEntries(
        [
          { source: 'index.js', status: 200 },
          { source: 'text-shaper.wasm:url-module', status: 200 },
        ],
        expected,
      ),
    /text-shaper.wasm/u,
  );
});

test('a Wasm URL module cannot stand in for the worker binary fetch', () => {
  const expected = ['index.js', 'runtime-bake.js', 'font-baker.wasm'];
  const urlModuleOnly = [
    { source: 'index.js', status: 200 },
    { source: 'runtime-bake.js', status: 200 },
    { source: 'font-baker.wasm:url-module', status: 200 },
  ];
  assert.throws(() => assertDeliveredEntries(urlModuleOnly, expected), /font-baker.wasm/u);
  assert.doesNotThrow(() =>
    assertDeliveredEntries([...urlModuleOnly, { source: 'font-baker.wasm', status: 200 }], expected),
  );
});
