import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCodemod } from '../../scripts/run-codemod.mjs';
test('digest module move preserves fingerprint symbols and is dry-run safe and idempotent', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'glyph-module-move-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src/internal'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { allowJs: true, module: 'NodeNext', moduleResolution: 'NodeNext' },
      include: ['src/**/*.ts', 'tests/**/*.mjs'],
    }),
  );
  await writeFile(path.join(root, 'src/internal/fingerprint.ts'), 'export const fingerprint = 42;');
  const caller =
    "import { fingerprint } from './internal/fingerprint.js'; export const key = { fingerprint, label: 'fingerprint' };";
  await writeFile(path.join(root, 'src/identity.ts'), caller);
  await writeFile(path.join(root, 'tests/check.mjs'), "import { fingerprint } from '../dist/internal/fingerprint.js';");
  const options = {
    codemod: path.dirname(fileURLToPath(import.meta.url)),
    project: path.join(root, 'tsconfig.json'),
    target: root,
  };
  const preview = await runCodemod(options);
  assert.ok(preview.changedFiles.length > 0);
  assert.equal(await readFile(path.join(root, 'src/identity.ts'), 'utf8'), caller);
  await runCodemod({ ...options, write: true });
  const updated = await readFile(path.join(root, 'src/identity.ts'), 'utf8');
  assert.match(updated, /content-digest\.js/);
  assert.match(updated, /label: 'fingerprint'/);
  assert.match(updated, /\{ fingerprint,/);
  assert.match(await readFile(path.join(root, 'tests/check.mjs'), 'utf8'), /content-digest\.js/);
  assert.deepEqual((await runCodemod(options)).changedFiles, []);
});
