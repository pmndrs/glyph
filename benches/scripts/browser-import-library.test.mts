import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { build, createServer } from 'vite';

test('Vite development transforms inject hot and replace NODE_ENV in custom modes', async () => {
  for (const mode of ['staging', 'production']) {
    const server = await createServer({
      configFile: false,
      logLevel: 'silent',
      mode,
      root: fileURLToPath(new URL('../../', import.meta.url)),
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true },
    });
    try {
      const transformed = await server.transformRequest('/packages/glyph/dist/internal/dev.js');
      assert.ok(transformed);
      assert.match(transformed.code, /import\.meta\.hot = __vite__createHotContext/);
      assert.doesNotMatch(transformed.code, /process\.env\.NODE_ENV/);
      assert.equal(server.config.env.DEV, true, mode);
    } finally {
      await server.close();
    }
  }
});

test('a Vite development-mode library build remains safe without a process global', async () => {
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({
      configFile: false,
      logLevel: 'silent',
      mode: 'staging',
      build: {
        lib: {
          entry: fileURLToPath(new URL('../../packages/glyph/dist/internal/dev.js', import.meta.url)),
          formats: ['es'],
          fileName: 'dev',
        },
        minify: 'oxc',
        write: false,
      },
    });
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((artifact) => artifact.type === 'chunk' && artifact.isEntry);
  assert.ok(entry && entry.type === 'chunk');
  const javascript = entry.code;
  const source = `
    import assert from 'node:assert/strict';
    delete globalThis.process;
    const { DEV } = await import(${JSON.stringify(`data:text/javascript,${encodeURIComponent(javascript)}`)});
    assert.equal(DEV, false);
  `;
  const runtime = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8' });
  assert.equal(runtime.status, 0, runtime.stderr);
});
