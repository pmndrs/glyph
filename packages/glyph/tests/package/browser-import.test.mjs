import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
  const result = await build({
    stdin: {
      contents: await readFile(new URL('../../dist/internal/dev.js', import.meta.url), 'utf8'),
      sourcefile: 'dev.js',
      loader: 'js',
    },
    bundle: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    format: 'esm',
    minify: true,
    platform: 'browser',
    write: false,
  });
  const javascript = result.outputFiles?.[0]?.text;
  assert.ok(javascript);
  assert.doesNotMatch(javascript, /\bprocess\b/);
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
