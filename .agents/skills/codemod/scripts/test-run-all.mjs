import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runAllCodemods } from './run-all-codemods.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'glyph-codemod-archive-'));
try {
  const archive = path.join(root, 'archive');
  const source = path.join(root, 'src');
  await Promise.all([mkdir(source), mkdir(path.join(archive, '2026-01-01-first'), { recursive: true })]);
  await mkdir(path.join(archive, '2026-01-02-second'));
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src/**/*.ts'] }),
  );
  await writeFile(path.join(source, 'index.ts'), 'export interface Before { value: number }\n');
  await recipe(archive, '2026-01-01-first', 'Before', 'Middle');
  await recipe(archive, '2026-01-02-second', 'Middle', 'After');

  const checked = await runAllCodemods({ archive, project: path.join(root, 'tsconfig.json'), target: root });
  assert.equal(checked.changed, true);
  assert.equal(await readFile(path.join(source, 'index.ts'), 'utf8'), 'export interface Before { value: number }\n');

  const applied = await runAllCodemods({
    archive,
    project: path.join(root, 'tsconfig.json'),
    target: root,
    write: true,
  });
  assert.equal(applied.changed, true);
  assert.equal(await readFile(path.join(source, 'index.ts'), 'utf8'), 'export interface After { value: number }\n');

  const clean = await runAllCodemods({ archive, project: path.join(root, 'tsconfig.json'), target: root });
  assert.equal(clean.changed, false);
  assert.deepEqual(
    clean.results.map((result) => result.id),
    ['2026-01-01-first', '2026-01-02-second'],
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

async function recipe(archive, id, before, after) {
  const directory = path.join(archive, id);
  await writeFile(path.join(directory, 'recipe.json'), JSON.stringify({ schemaVersion: 1, id }));
  await writeFile(
    path.join(directory, 'transform.mjs'),
    [
      `export const metadata = Object.freeze({ id: '${id}' });`,
      'export function transform({ project, renameSymbol }) {',
      `  const source = project.getSourceFile((value) => value.getFilePath().replaceAll('\\\\', '/').endsWith('/src/index.ts'));`,
      `  const declaration = source?.getInterface('${before}');`,
      `  if (declaration !== undefined) renameSymbol(declaration, '${after}');`,
      '}',
      '',
    ].join('\n'),
  );
}
