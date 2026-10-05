import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';

import { migrateV01ToV02 } from './migrate-v01-to-v02.mjs';
import { createRecord, listRecords, placeholder } from './records.mjs';
import { driftIssueMarker, measureDocsDrift, renderDriftIssue } from './docs-drift.mjs';
import { validateOkf } from './validate-okf.mjs';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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

test('validator requires one concept per workspace package and rejects a retired source_digest', async () => {
  const root = await workspaceFixture('okf-coverage-');
  const docs = path.join(root, '.agents/docs');
  assert.deepEqual((await validateOkf(docs, { workspaceRoot: root })).profile, []);

  await writeFile(conceptPath(root), glyphConcept({ extra: "source_digest: 'sha256:00'\n" }));
  assert.deepEqual((await validateOkf(docs, { workspaceRoot: root })).profile, [
    `${conceptPath(root)}: source_digest is retired; remove it (drift is reported from git history)`,
  ]);

  await rm(conceptPath(root));
  assert.ok(
    (await validateOkf(docs, { workspaceRoot: root })).profile.includes(
      'workspace package @pmndrs/glyph: missing OKF Workspace Package concept',
    ),
  );
});

test('drift lists source commits after the concept was last committed and ignores build output', async () => {
  const root = await workspaceFixture('okf-drift-');
  await commitFixture(root);
  assert.deepEqual(await driftCommits(root), []);

  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'changed\n');
  await git(root, ['commit', '-qam', 'feat(glyph): change source']);
  await mkdir(path.join(root, 'packages/glyph/dist'), { recursive: true });
  await writeFile(path.join(root, 'packages/glyph/dist/index.js'), 'built\n');
  await git(root, ['add', '-f', 'packages/glyph/dist/index.js']);
  await git(root, ['commit', '-qm', 'chore(glyph): commit build output']);

  const [entry] = await measureDocsDrift(root);
  assert.deepEqual(
    entry.commits.map((commit) => commit.subject),
    ['feat(glyph): change source'],
  );
  assert.deepEqual(entry.files, ['packages/glyph/src/index.ts']);
  const body = renderDriftIssue([entry], { head: 'abc1234' });
  assert.ok(body.startsWith(driftIssueMarker));
  assert.match(body, /1 of 1 workspace package concepts trail their source at `abc1234`/u);
  assert.match(body, /feat\(glyph\): change source/u);

  await writeFile(conceptPath(root), glyphConcept({ at: '2026-10-05T00:00:00Z' }));
  await git(root, ['commit', '-qam', 'docs(glyph): review concept']);
  assert.deepEqual(await driftCommits(root), []);
  assert.match(renderDriftIssue(await measureDocsDrift(root)), /Every workspace package concept is current/u);
});

test('scaffolded records fail validation until written and never overwrite a subject', async () => {
  const bundle = await recordBundle('okf-records-');
  const log = await createRecord(bundle, 'log', 'first-change', 'First change', { date: '2026-10-04' });
  const decision = await createRecord(bundle, 'decision', 'one-file-per-record', 'One file per record', {
    date: '2026-10-04',
  });
  const scaffolded = (await validateOkf(bundle)).profile;
  assert.ok(scaffolded.includes(`${log}: replace the ${placeholder} scaffold text`));
  assert.ok(scaffolded.includes(`${decision}: replace the ${placeholder} scaffold text`));
  await assert.rejects(createRecord(bundle, 'log', 'first-change', 'Again', { date: '2026-10-04' }), /EEXIST/u);

  await writeFile(log, (await readFile(log, 'utf8')).replace(/TODO\(docs:new\).*/u, 'Wrote the first change.'));
  await writeFile(decision, (await readFile(decision, 'utf8')).replaceAll(/TODO\(docs:new\) ?/gu, ''));
  assert.deepEqual((await validateOkf(bundle)).profile, []);

  await createRecord(bundle, 'log', 'second-change', 'Second change', { date: '2026-10-05' });
  assert.deepEqual(
    (await listRecords(bundle, 'log')).map((record) => record.path),
    ['log/2026-10-05-second-change.md', 'log/2026-10-04-first-change.md'],
  );
  assert.deepEqual(await listRecords(bundle, 'decision'), [
    {
      date: '2026-10-04',
      status: 'Proposed',
      title: 'One file per record',
      path: 'planning/decisions/one-file-per-record.md',
    },
  ]);
});

test('records are named by subject and the frozen register accepts no new rows', async () => {
  const bundle = await recordBundle('okf-record-names-');
  const decisions = path.join(bundle, 'planning/decisions');
  const numbered = await createRecord(bundle, 'decision', 'subject', 'Subject', { date: '2026-10-04' });
  await writeFile(
    path.join(decisions, '0005-subject.md'),
    (await readFile(numbered, 'utf8')).replaceAll(/TODO\(docs:new\) ?/gu, ''),
  );
  await rm(numbered);
  await writeFile(
    path.join(bundle, 'planning/register.md'),
    "---\ntype: Decision Register\ntitle: Register\ndescription: Frozen.\nfrozen_after: D-002\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# Register\n\n| ID | Decision |\n| --- | --- |\n| D-002 | Kept. |\n| D-003 | Added late. |\n",
  );
  await mkdir(path.join(bundle, 'log'), { recursive: true });
  await writeFile(
    path.join(bundle, 'log/october-change.md'),
    "---\ntype: Log Entry\ntitle: Undated\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n## Heading\n",
  );
  assert.deepEqual(
    (await validateOkf(bundle)).profile.sort(),
    [
      `${path.join(bundle, 'log/october-change.md')}: a Log Entry is flat prose; its title lives in frontmatter`,
      `${path.join(bundle, 'log/october-change.md')}: name a Log Entry YYYY-MM-DD-<slug>.md`,
      `${path.join(bundle, 'planning/register.md')}: D-003 is past the frozen register; record it as a decision file with docs:new instead`,
      `${path.join(decisions, '0005-subject.md')}: name a Decision by its subject slug (lowercase words, no number prefix)`,
    ].sort(),
  );
});

test('pre-commit validation reads the staged snapshot and never rewrites the index', async () => {
  const root = await workspaceFixture('okf-hook-');
  await commitFixture(root);
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'staged\n');
  await writeFile(conceptPath(root), glyphConcept({ at: '2026-10-05T00:00:00Z' }));
  await git(root, ['add', '.']);
  await writeFile(conceptPath(root), 'unstaged and invalid\n');
  const staged = await git(root, ['write-tree']);

  const hookResult = await execFileAsync(process.execPath, [hookPath()], { cwd: root });
  assert.match(hookResult.stdout, /Producer-profile errors: 0/u);
  assert.equal(await git(root, ['write-tree']), staged);
});

test('pre-commit validation failure blocks the commit', async () => {
  const root = await temporaryDirectory('okf-hook-invalid-');
  await git(root, ['init', '-q']);
  await mkdir(path.join(root, '.agents/docs'), { recursive: true });
  await writeFile(path.join(root, '.agents/docs/index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  await writeFile(
    path.join(root, '.agents/docs/invalid.md'),
    "---\ntitle: Missing type\ndescription: Must fail.\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# Invalid\n",
  );
  await git(root, ['add', '.agents/docs']);

  await assert.rejects(execFileAsync(process.execPath, [hookPath()], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /Conformance errors: 1/u);
    assert.match(error.stderr, /staged OKF validation failed/u);
    return true;
  });
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

function hookPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.githooks/okf-validate.mjs');
}

function conceptPath(root) {
  return path.join(root, '.agents/docs/packages/glyph.md');
}

function glyphConcept({ at = '2026-09-17T00:00:00Z', extra = '' } = {}) {
  return `---\ntype: Workspace Package\ntitle: Glyph\ndescription: Test package.\ndocumentation_type: reference\nworkspace_package: '@pmndrs/glyph'\nresource: ../../../packages/glyph\n${extra}generated:\n  by: process:test\n  at: '${at}'\n---\n\n# Glyph\n`;
}

/** One workspace package with its concept, as a git repository whose fixture is not yet committed. */
async function workspaceFixture(prefix) {
  const root = await temporaryDirectory(prefix);
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.email', 'test@example.test']);
  await git(root, ['config', 'user.name', 'Test']);
  await mkdir(path.join(root, 'packages/glyph/src'), { recursive: true });
  await mkdir(path.join(root, '.agents/docs/packages'), { recursive: true });
  await writeFile(path.join(root, 'packages/glyph/package.json'), '{"name":"@pmndrs/glyph"}\n');
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'initial\n');
  await writeFile(
    path.join(root, '.agents/docs/index.md'),
    '---\nokf_version: "0.2"\n---\n\n# Index\n\n- [Glyph](packages/glyph.md)\n',
  );
  await writeFile(conceptPath(root), glyphConcept());
  return root;
}

async function commitFixture(root) {
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'fixture']);
}

async function driftCommits(root) {
  return (await measureDocsDrift(root)).flatMap((entry) => entry.commits);
}

async function recordBundle(prefix) {
  const bundle = await temporaryDirectory(prefix);
  await writeFile(path.join(bundle, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  return bundle;
}
