import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';

import { migrateV01ToV02 } from './migrate-v01-to-v02.mjs';
import { packageDigest } from './package-digest.mjs';
import { validateOkf } from './validate-okf.mjs';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('package digests are deterministic and ignore build output', async () => {
  const root = await temporaryDirectory('okf-digest-');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'dist', 'index.js'), 'ignored\n');
  const before = await packageDigest(root);
  await writeFile(path.join(root, 'dist', 'index.js'), 'still ignored\n');
  assert.equal(await packageDigest(root), before);
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const value = 2;\n');
  assert.notEqual(await packageDigest(root), before);
});

test('validator separates conformance and producer-profile failures', async () => {
  const root = await temporaryDirectory('okf-validate-');
  await writeFile(path.join(root, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  await writeFile(path.join(root, 'missing-type.md'), '---\ntitle: Missing type\n---\n\n# Missing type\n');
  const result = await validateOkf(root);
  assert.equal(result.conformance.length, 1);
  assert.match(result.conformance[0], /missing non-empty type/u);
  assert.ok(result.profile.some((error) => error.endsWith('missing generated mapping')));
});

test('migration preserves concepts while replacing v0.1 metadata and citations', async () => {
  const root = await temporaryDirectory('okf-migrate-');
  await writeFile(path.join(root, 'index.md'), '# Index\n');
  await writeFile(
    path.join(root, 'concept.md'),
    '---\ntype: Note\ntitle: Example\ntimestamp: 2026-01-01\n---\n\n# Example\n\n# Citations\n\n- [Source](https://example.test/source)\n',
  );
  const migrated = await migrateV01ToV02(root, 'process:test', '2026-09-17T00:00:00Z');
  assert.equal(migrated, 1);
  const concept = await readFile(path.join(root, 'concept.md'), 'utf8');
  assert.doesNotMatch(concept, /timestamp:|# Citations/u);
  assert.match(concept, /generated:\n  by: "process:test"\n  at: "2026-09-17T00:00:00Z"/u);
  assert.match(concept, /resource: "https:\/\/example\.test\/source"/u);
  assert.match(await readFile(path.join(root, 'index.md'), 'utf8'), /okf_version: "0\.2"/u);
});

test('pre-commit digest updates hash staged content without staging unrelated working-tree edits', async () => {
  const root = await temporaryDirectory('okf-hook-');
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'test@example.test']);
  await git(root, ['config', 'user.name', 'Test']);
  await mkdir(path.join(root, 'packages/glyph/src'), { recursive: true });
  await mkdir(path.join(root, '.agents/docs/packages'), { recursive: true });
  await writeFile(path.join(root, 'packages/glyph/package.json'), '{"name":"@pmndrs/glyph"}\n');
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'initial\n');
  const initialDigest = await packageDigest(path.join(root, 'packages/glyph'));
  const conceptPath = path.join(root, '.agents/docs/packages/glyph.md');
  await writeFile(
    conceptPath,
    `---\ntype: Workspace Package\ntitle: Glyph\ndescription: Test package.\ndocumentation_type: reference\nworkspace_package: '@pmndrs/glyph'\nresource: ../../../packages/glyph\nsource_digest: '${initialDigest}'\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# Glyph\n`,
  );
  await writeFile(path.join(root, '.agents/docs/index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'fixture']);

  const sourcePath = path.join(root, 'packages/glyph/src/index.ts');
  await writeFile(sourcePath, 'staged\n');
  await git(root, ['add', 'packages/glyph/src/index.ts']);
  await writeFile(sourcePath, 'unstaged\n');
  await writeFile(conceptPath, (await readFile(conceptPath, 'utf8')).replace('title: Glyph', 'title: Unstaged Glyph'));

  const hook = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.githooks/okf-digests.mjs');
  const hookResult = await execFileAsync(process.execPath, [hook], { cwd: root });
  assert.doesNotMatch(hookResult.stderr, /digest pins left to CI/u);

  const indexConcept = await git(root, ['show', ':.agents/docs/packages/glyph.md']);
  const workingConcept = await readFile(conceptPath, 'utf8');
  assert.match(indexConcept, /title: Glyph/u);
  assert.doesNotMatch(indexConcept, /title: Unstaged Glyph/u);
  assert.match(workingConcept, /title: Unstaged Glyph/u);

  const stagedRoot = await temporaryDirectory('okf-hook-stage-');
  await mkdir(path.join(stagedRoot, 'src'), { recursive: true });
  await writeFile(path.join(stagedRoot, 'package.json'), '{"name":"@pmndrs/glyph"}\n');
  await writeFile(path.join(stagedRoot, 'src/index.ts'), 'staged\n');
  assert.match(indexConcept, new RegExp(`source_digest: '${await packageDigest(stagedRoot)}'`, 'u'));
  assert.equal(
    await git(root, ['diff', '--cached', '--name-only']),
    '.agents/docs/packages/glyph.md\npackages/glyph/src/index.ts\n',
  );
});

async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(directory, arguments_) {
  const { stdout } = await execFileAsync('git', arguments_, { cwd: directory });
  return stdout;
}
