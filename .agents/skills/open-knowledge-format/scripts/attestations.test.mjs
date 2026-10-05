import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';

import { attest, auditDocs, pullRequestAttestations, sourceDigest, verify } from './attestations.mjs';
import { renderDocsReport, renderDriftIssue } from './docs-drift.mjs';
import { validateOkf } from './validate-okf.mjs';

const execFileAsync = promisify(execFile);
const directories = [];
after(() => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));

/**
 * The whole lifecycle against a real repository with real merge and squash commits: contributors attest,
 * CI judges each pull request at its own head, concurrent pull requests merge without conflicts, the
 * audit names every pending attestation and every gap by pull request, and verification clears them.
 */
test('attest, review, and verify across merges without a single conflict', async () => {
  const root = await repository();
  const docs = path.join(root, '.agents/docs');

  // Baseline: the initial commit changed both packages with no attestation, so both start as gaps.
  let audit = await auditDocs(root);
  assert.deepEqual(statuses(audit), { '@test/glyph': 'unverified', '@test/raster': 'unverified' });
  await verifyAll(root, 'baseline', 'documented');
  audit = await auditDocs(root);
  assert.deepEqual(statuses(audit), { '@test/glyph': 'current', '@test/raster': 'current' });
  assert.match(renderDriftIssue(audit), /Every workspace package concept is verified current/u);
  assert.match(renderDriftIssue(audit), /^<!-- okf-docs-status: clean -->$/mu);

  // Pull request #1 changes glyph, updates its concept, and attests; a later source edit makes it stale.
  await branch(root, 'a');
  await write(root, 'packages/glyph/src/a.ts', 'a\n');
  await write(root, '.agents/docs/packages/glyph.md', concept('Glyph', 'Shapes text, now with a.'));
  await git(root, ['add', '-A']);
  await attest(root, '@test/glyph', 'Added a; documented it in the concept.', { date: '2026-10-01' });
  await commitAll(root, 'feat(glyph): add a');
  let rows = await pullRequestAttestations(root, 'main');
  assert.deepEqual(
    rows.map(({ package: name, status, conceptEdited }) => [name, status, conceptEdited]),
    [['@test/glyph', 'attested', true]],
  );
  await write(root, 'packages/glyph/src/a.ts', 'a, revised\n');
  await commitAll(root, 'fix(glyph): revise a');
  rows = await pullRequestAttestations(root, 'main');
  assert.equal(rows[0].status, 'stale');
  assert.match(
    renderDocsReport({ rows, findings: [], base: 'main' }),
    /\(made at `[0-9a-f]{8}`, source now `[0-9a-f]{8}`\) \| ⚠️ \|\n[\s\S]*docs:attest -- @test\/glyph/u,
  );
  await attest(root, 'glyph', 'Revised a; concept still accurate.', { date: '2026-10-01' });
  await commitAll(root, 'docs(glyph): attest revised a');
  assert.equal((await pullRequestAttestations(root, 'main'))[0].status, 'attested');

  // Pull request #2, opened concurrently from the same main, also attests glyph.
  await git(root, ['switch', '-q', 'main']);
  await branch(root, 'b');
  await write(root, 'packages/glyph/src/b.ts', 'b\n');
  await git(root, ['add', '-A']);
  await attest(root, '@test/glyph', 'Added b; no concept change needed.', { date: '2026-10-01' });
  await commitAll(root, 'feat(glyph): add b');

  // Pull request #3 changes raster and never attests.
  await git(root, ['switch', '-q', 'main']);
  await branch(root, 'c');
  await write(root, 'packages/raster/src/c.ts', 'c\n');
  await commitAll(root, 'feat(raster): add c');
  rows = await pullRequestAttestations(root, 'main');
  assert.deepEqual(
    rows.map((row) => [row.package, row.status]),
    [['@test/raster', 'unattested']],
  );

  // Merge #1 and #2 as merge commits and squash #3: no step may conflict.
  await git(root, ['switch', '-q', 'main']);
  await git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from test/a', 'a']);
  await git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #2 from test/b', 'b']);
  await git(root, ['merge', '-q', '--squash', 'c']);
  await git(root, ['commit', '-qm', 'feat(raster): add c (#3)']);

  audit = await auditDocs(root);
  const glyph = audit.find((entry) => entry.package === '@test/glyph');
  const raster = audit.find((entry) => entry.package === '@test/raster');
  assert.equal(glyph.status, 'review');
  assert.deepEqual(glyph.pending.map((record) => record.pr).sort(), [1, 1, 2]);
  assert.deepEqual(glyph.gaps, []);
  assert.equal(raster.status, 'review');
  assert.deepEqual(
    raster.gaps.map((gap) => gap.pr),
    [3],
  );
  const issue = renderDriftIssue(audit);
  assert.match(issue, /2 of 2 packages need verification: 3 pending attestations, 1 gap/u);
  assert.match(issue, /^<!-- okf-docs-status: open -->$/mu);
  assert.match(issue, /\| #3 \| `[0-9a-f]+` \| feat\(raster\): add c \(#3\) \|/u);

  // A reviewer branch verifies while pull request #4 attests raster concurrently; both merge cleanly.
  await branch(root, 'review');
  const result = await verify(root, 'verified-pass', { date: '2026-10-02' });
  assert.equal(result.consumed.length, 3);
  assert.equal(result.reviews, 4);
  const entry = path.join(root, result.file);
  assert.ok(
    (await validateOkf(docs)).profile.some((finding) => finding.includes('replace the TODO(docs:new) scaffold text')),
  );
  await writeFile(
    entry,
    (await readFile(entry, 'utf8'))
      .replace(/TODO\(docs:new\) confirmed \| corrected/gu, 'confirmed')
      .replace(/TODO\(docs:new\) documented \| no-change/gu, 'documented')
      .replace(/TODO\(docs:new\).*/u, 'Checked #1 and #2 against their diffs; documented c from #3.'),
  );
  assert.deepEqual((await validateOkf(docs)).profile, []);
  await commitAll(root, 'docs: verify agent docs');
  await git(root, ['switch', '-q', 'main']);
  await branch(root, 'd');
  await write(root, 'packages/raster/src/d.ts', 'd\n');
  await git(root, ['add', '-A']);
  await attest(root, '@test/raster', 'Added d.', { date: '2026-10-02' });
  await commitAll(root, 'feat(raster): add d');
  await git(root, ['switch', '-q', 'main']);
  await git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #5 from test/review', 'review']);
  await git(root, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #4 from test/d', 'd']);

  audit = await auditDocs(root);
  assert.deepEqual(statuses(audit), { '@test/glyph': 'current', '@test/raster': 'review' });
  assert.deepEqual(
    audit.find((entry) => entry.package === '@test/raster').pending.map((record) => record.pr),
    [4],
  );
  assert.deepEqual(await readdir(path.join(docs, 'attestations')), [
    '2026-10-02-raster-' + (await shortDigest(root, 'd')),
  ]);
});

test('the source digest ignores build output and file bytes outside git, and reflects the index', async () => {
  const root = await repository();
  const before = await sourceDigest(root, 'packages/glyph');
  await mkdir(path.join(root, 'packages/glyph/dist'), { recursive: true });
  await write(root, 'packages/glyph/dist/index.js', 'built\n');
  await git(root, ['add', '-f', 'packages/glyph/dist/index.js']);
  assert.equal(await sourceDigest(root, 'packages/glyph', ':index'), before);
  await write(root, 'packages/glyph/src/index.ts', 'changed\n');
  assert.equal(await sourceDigest(root, 'packages/glyph', ':index'), before, 'unstaged edits are not in the index');
  await git(root, ['add', '-A']);
  assert.notEqual(await sourceDigest(root, 'packages/glyph', ':index'), before);
  await assert.rejects(attest(root, 'glyph', ''), /say what you changed/u);
  await attest(root, 'glyph', 'Changed index.', { date: '2026-10-01' });
  await assert.rejects(attest(root, 'glyph', 'Again.', { date: '2026-10-01' }), /already attested/u);
});

test('history-derived audits refuse a shallow clone instead of reporting wrong gaps', async () => {
  const root = await repository();
  await write(root, 'packages/glyph/src/more.ts', 'more\n');
  await commitAll(root, 'feat(glyph): more');
  const shallow = await mkdtemp(path.join(tmpdir(), 'okf-attestations-shallow-'));
  directories.push(shallow);
  await execFileAsync('git', ['clone', '-q', '--depth', '1', `file://${root}`, shallow]);
  await assert.rejects(auditDocs(shallow), /this clone is shallow/u);
  await assert.rejects(pullRequestAttestations(shallow, 'HEAD'), /this clone is shallow/u);
});

async function verifyAll(root, slug, verdict) {
  const result = await verify(root, slug, { date: '2026-09-30' });
  const file = path.join(root, result.file);
  await writeFile(
    file,
    (await readFile(file, 'utf8'))
      .replace(/TODO\(docs:new\) [a-z-]+ \| [a-z-]+/gu, verdict)
      .replace(/TODO\(docs:new\).*/u, 'Baseline review of every package.'),
  );
  await commitAll(root, `docs: ${slug}`);
}

function statuses(audit) {
  return Object.fromEntries(audit.map((entry) => [entry.package, entry.status]));
}

async function shortDigest(root, branchName) {
  const digest = await sourceDigest(root, 'packages/raster', branchName);
  return `${digest.slice(7, 15)}.md`;
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'okf-attestations-'));
  directories.push(root);
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.test']);
  await git(root, ['config', 'user.name', 'Tester']);
  await git(root, ['config', 'commit.gpgsign', 'false']);
  for (const [name, title] of [
    ['glyph', 'Glyph'],
    ['raster', 'Raster'],
  ]) {
    await write(root, `packages/${name}/package.json`, `{"name":"@test/${name}"}\n`);
    await write(root, `packages/${name}/src/index.ts`, 'initial\n');
    await write(root, `.agents/docs/packages/${name}.md`, concept(title, `${title} package.`, name));
  }
  await write(
    root,
    '.agents/docs/index.md',
    '---\nokf_version: "0.2"\n---\n\n# Index\n\n- [Glyph](packages/glyph.md)\n- [Raster](packages/raster.md)\n',
  );
  await commitAll(root, 'init');
  return root;
}

function concept(title, description, name = title.toLowerCase()) {
  return `---\ntype: Workspace Package\ntitle: ${title}\ndescription: ${description}\ndocumentation_type: reference\nworkspace_package: '@test/${name}'\nresource: ../../../packages/${name}\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# ${title}\n`;
}

async function branch(root, name) {
  await git(root, ['switch', '-q', '-c', name]);
}

async function write(root, file, text) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), text);
}

async function commitAll(root, message) {
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', message]);
}

async function git(root, arguments_) {
  const { stdout } = await execFileAsync('git', arguments_, { cwd: root });
  return stdout;
}
