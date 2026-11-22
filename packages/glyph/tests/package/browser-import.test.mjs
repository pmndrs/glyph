import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootEntry = new URL('../../dist/index.js', import.meta.url).href;
const devModule = new URL('../../dist/internal/dev.js', import.meta.url).href;

test('the shipped ESM root imports without a process global', () => {
  const source = `
    import assert from 'node:assert/strict';
    delete globalThis.process;
    assert.equal(typeof process, 'undefined');
    const glyph = await import(${JSON.stringify(rootEntry)});
    assert.equal(typeof glyph.glyph, 'object');
    const { DEV } = await import(${JSON.stringify(devModule)});
    assert.equal(DEV, false);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

// Peers such as typegpu may read `process` themselves; they evaluate first, so only Glyph's own modules run without it.
test('every shipped browser entry evaluates its own modules without a process global', async () => {
  for (const entry of ['index.js', 'core.js', 'three.js', 'typegpu.js', 'pixi3d.js', 'three/typegpu.js']) {
    const entryUrl = new URL(`../../dist/${entry}`, import.meta.url);
    const peers = await staticPeerSpecifiers(entryUrl);
    const source = `
      import assert from 'node:assert/strict';
      for (const peer of ${JSON.stringify(peers)}) await import(peer);
      delete globalThis.process;
      assert.equal(typeof process, 'undefined');
      await import(${JSON.stringify(entryUrl.href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`);
  }
});

/** The bare specifiers of an emitted entry's static module graph, which a browser app resolves to peers. */
async function staticPeerSpecifiers(entryUrl) {
  const peers = new Set();
  const visited = new Set();
  const pending = [entryUrl];
  while (pending.length > 0) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const code = await readFile(url, 'utf8');
    for (const [, specifier] of code.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/g)) {
      if (specifier.startsWith('.')) pending.push(new URL(specifier, url));
      else if (/^(?:node:)?(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/.test(specifier)) peers.add(specifier);
    }
  }
  return [...peers].sort();
}

test('the shipped diagnostics gate retains Node development and production modes', () => {
  for (const [nodeEnv, expectedDev] of [
    ['development', true],
    ['production', false],
  ]) {
    const source = `
      import assert from 'node:assert/strict';
      const { DEV } = await import(${JSON.stringify(devModule)});
      assert.equal(DEV, ${expectedDev});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: nodeEnv },
    });
    assert.equal(result.status, 0, `${nodeEnv}: ${result.stderr}`);
  }
});

test('a standard NODE_ENV production define removes diagnostics from the emitted browser module', async () => {
  const diagnostic = 'glyph-dev-diagnostic-sentinel';
  const result = await build({
    stdin: {
      contents: `import { DEV } from '../../dist/internal/dev.js'; if (DEV && process.env.NODE_ENV !== 'production') console.warn('${diagnostic}'); export { DEV };`,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      sourcefile: 'dev-production-entry.js',
      loader: 'js',
    },
    bundle: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    logLevel: 'silent',
    minify: true,
    platform: 'browser',
    write: false,
  });
  const javascript = result.outputFiles?.[0]?.text;
  assert.ok(javascript);
  assert.doesNotMatch(javascript, /\bprocess\b/);
  assert.doesNotMatch(javascript, new RegExp(diagnostic));
  const source = `
    import assert from 'node:assert/strict';
    delete globalThis.process;
    assert.equal(typeof process, 'undefined');
    const { DEV } = await import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(javascript)}`)});
    assert.equal(DEV, false);
  `;
  const runtime = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
});

test('a generic production bundle strips the shipped teardown messages', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../dist/index.js', import.meta.url))],
    bundle: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    minify: true,
    packages: 'external',
    platform: 'browser',
    write: false,
  });
  const javascript = result.outputFiles?.[0]?.text;
  assert.ok(javascript);
  assert.doesNotMatch(javascript, /teardown continued after/);
});

test('browser diagnostics distinguish development serving from library builds', async () => {
  const emitted = await readFile(new URL('../../dist/internal/dev.js', import.meta.url), 'utf8');
  for (const [mode, dev, hot, nodeEnv, expectedDev] of [
    ['development', true, true, 'development', true],
    ['staging', true, true, 'development', true],
    ['production', true, true, 'development', true],
    ['staging', true, false, undefined, false],
    ['staging', false, false, undefined, false],
  ]) {
    const result = await build({
      stdin: { contents: emitted, sourcefile: 'dev.js', loader: 'js' },
      bundle: true,
      define: {
        'import.meta.env': JSON.stringify({ MODE: mode, DEV: dev }),
        'import.meta.hot': hot ? '{}' : 'undefined',
        ...(nodeEnv === undefined ? {} : { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) }),
      },
      format: 'esm',
      minify: true,
      platform: 'browser',
      write: false,
    });
    const javascript = result.outputFiles?.[0]?.text;
    assert.ok(javascript);
    const source = `
      import assert from 'node:assert/strict';
      delete globalThis.process;
      assert.equal(typeof process, 'undefined');
      const { DEV } = await import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(javascript)}`)});
      assert.equal(DEV, ${expectedDev});
    `;
    const runtime = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8' });
    assert.equal(runtime.status, 0, `${mode} / DEV=${dev} / hot=${hot}: ${runtime.stderr}`);
  }
});
