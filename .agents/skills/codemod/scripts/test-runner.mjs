import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runCodemod } from './run-codemod.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-codemod-'));
try {
  const recipe = path.join(root, 'recipe');
  await mkdir(recipe);
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'preserve', moduleResolution: 'bundler', target: 'es2022' },
      include: ['*.ts'],
    }),
  );
  await writeFile(
    path.join(root, 'api.ts'),
    '/** oldName calls the API. */\nexport function oldName() { return "oldName"; }\n',
  );
  await writeFile(path.join(root, 'usage.ts'), "import { oldName } from './api.js';\noldName();\n");
  await writeFile(
    path.join(recipe, 'transform.mjs'),
    [
      "export const metadata = Object.freeze({ id: 'test-rename' });",
      'export function transform({ project, renameSymbol }) {',
      "  renameSymbol(project.getSourceFileOrThrow('api.ts').getFunctionOrThrow('oldName'), 'newName');",
      '}',
      '',
    ].join('\n'),
  );

  const dryRun = await runCodemod({ codemod: recipe, project: path.join(root, 'tsconfig.json'), target: root });
  assert.equal(dryRun.mode, 'dry-run');
  assert.deepEqual(
    dryRun.changedFiles.map((file) => path.basename(file)),
    ['api.ts', 'usage.ts'],
  );
  assert.match(await readFile(path.join(root, 'api.ts'), 'utf8'), /function oldName/);

  const written = await runCodemod({
    codemod: recipe,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.equal(written.mode, 'write');
  const api = await readFile(path.join(root, 'api.ts'), 'utf8');
  const usage = await readFile(path.join(root, 'usage.ts'), 'utf8');
  assert.match(api, /newName calls the API/);
  assert.match(api, /function newName/);
  assert.match(api, /"oldName"/);
  assert.match(usage, /import \{ newName \}/);
  assert.match(usage, /newName\(\)/);
} finally {
  await rm(root, { recursive: true, force: true });
}
