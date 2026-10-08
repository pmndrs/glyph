import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, test } from 'node:test';

import { migrateV01ToV02 } from './migrate-v01-to-v02.mjs';
import { decision, outline, search } from './docs-query.mjs';
import { createRecord, listRecords, placeholder } from './records.mjs';
import { attest, pullRequestAttestations } from './attestations.mjs';
import { docsFindings, docsReportMarker, renderAnnotations, renderDocsReport } from './docs-drift.mjs';
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

test('the pull-request docs report shows attestation status per changed package and validation findings', async () => {
  const root = await workspaceFixture('okf-pr-report-');
  await commitFixture(root);
  await git(root, ['branch', 'base']);
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'changed\n');
  // The bundle records changes as Log Entry files, so a recreated log.md is a finding.
  await createRecord(path.join(root, '.agents/docs'), 'log', 'kept', 'Kept', { date: '2026-09-30' });
  const entry = path.join(root, '.agents/docs/log/2026-09-30-kept.md');
  await writeFile(entry, (await readFile(entry, 'utf8')).replace(/TODO\(docs:new\).*/u, 'Kept.'));
  await writeFile(path.join(root, '.agents/docs/log.md'), '# Log\n\n## 2026-10-06\n\n- Hand-written.\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-qm', 'feat(glyph): change source']);

  const rows = await pullRequestAttestations(root, 'base');
  assert.deepEqual(
    rows.map((row) => [row.package, row.status, row.conceptEdited]),
    [['@pmndrs/glyph', 'unattested', false]],
  );
  const findings = await docsFindings(root);
  assert.deepEqual(findings, [
    '.agents/docs/log.md: this bundle records changes as log/ entries; use docs:new -- log instead',
  ]);
  const body = renderDocsReport({ rows, findings, base: 'base', links: { repository: 'pmndrs/glyph', ref: 'abc123' } });
  const link = '[`packages/glyph.md`](https://github.com/pmndrs/glyph/blob/abc123/.agents/docs/packages/glyph.md)';
  assert.ok(body.includes(`| \`@pmndrs/glyph\` | ${link} · not edited | none | ❌ |`));
  assert.ok(body.includes(`- ${link}: \`mise exec -- pnpm scripts run docs:attest -- @pmndrs/glyph`));
  assert.deepEqual(renderAnnotations({ rows, findings }).trimEnd().split('\n'), [
    '::warning file=.agents/docs/packages/glyph.md,title=Docs attestation missing::@pmndrs/glyph changed without an attestation. Update this concept if it is now wrong, then run: mise exec -- pnpm scripts run docs:attest -- @pmndrs/glyph "<what you changed and checked>"',
    '::warning file=.agents/docs/log.md,title=Docs validation::this bundle records changes as log/ entries; use docs:new -- log instead (reproduce with mise exec -- pnpm scripts run docs:check)',
  ]);
  assert.ok(body.startsWith(docsReportMarker));
  assert.match(body, /Advisory only — this never blocks merging/u);
  assert.match(body, /docs:attest -- @pmndrs\/glyph "<what you changed and checked>"/u);
  assert.match(body, /docs:check/u);

  await rm(path.join(root, '.agents/docs/log.md'));
  await git(root, ['add', '-A']);
  await attest(root, 'glyph', 'Changed index; concept still accurate.', { date: '2026-10-05' });
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'docs(glyph): attest']);
  const clean = renderDocsReport({
    rows: await pullRequestAttestations(root, 'base'),
    findings: await docsFindings(root),
    base: 'base',
  });
  assert.match(clean, /Every changed package is attested at this head/u);
  assert.match(
    clean,
    /\| `@pmndrs\/glyph` \| `packages\/glyph\.md` · not edited \| Changed index; concept still accurate\. \| ✅ \|/u,
  );
  assert.equal(renderAnnotations({ rows: await pullRequestAttestations(root, 'base'), findings: [] }), '');
});

test('outline and search locate every answer as path › heading trail with line ranges', async () => {
  const bundle = await recordBundle('okf-query-');
  await mkdir(path.join(bundle, 'packages'), { recursive: true });
  await writeFile(
    path.join(bundle, 'packages/glyph.md'),
    [
      '---',
      'type: Workspace Package',
      'title: Glyph',
      'description: Shapes text.',
      'generated:',
      '  by: process:test',
      "  at: '2026-09-17T00:00:00Z'",
      '---',
      '',
      '# Glyph',
      '',
      '## Shaping',
      '',
      'HarfRust shapes every run.',
      'Unsafe breaks are corrected here.',
      '',
      '```md',
      '# not a heading',
      '```',
      '',
      '### Fallback',
      '',
      'Fallback fonts shape unsafe runs too.',
      '',
      '## Layout',
      '',
      'Lines are fitted.',
      '',
    ].join('\n'),
  );

  assert.deepEqual(await outline(bundle, 'packages/glyph.md'), [
    'packages/glyph.md  Glyph (28 lines)',
    '  Shapes text.',
    'Glyph  [10-28]',
    '  Shaping  [12-24]',
    '    Fallback  [21-24]',
    '  Layout  [25-28]',
  ]);
  assert.deepEqual(await outline(bundle, 'packages/glyph.md:23'), [
    'Glyph  [10-28]',
    '  Shaping  [12-24]',
    '    Fallback  [21-24]',
  ]);
  assert.deepEqual(await search(bundle, ['UNSAFE']), [
    'packages/glyph.md › Glyph › Shaping  [12-24]',
    '  [14-15] HarfRust shapes every run. Unsafe breaks are corrected here.',
    'packages/glyph.md › Glyph › Shaping › Fallback  [21-24]',
    '  [23-23] Fallback fonts shape unsafe runs too.',
  ]);
  assert.deepEqual(await search(bundle, ['shapes', 'text']), [
    'Concepts:',
    '  packages/glyph.md  Glyph — Shapes text.',
    '',
  ]);
  assert.deepEqual(
    (await search(bundle, ['unsafe'], { limit: 1 })).at(-1),
    '… 1 more sections; add a term or pass --limit <n>',
  );
});

test('a path query finds the concepts that cite or link a source file, and table rows are their own hits', async () => {
  const root = await workspaceFixture('okf-query-paths-');
  const docs = path.join(root, '.agents/docs');
  await writeFile(
    path.join(docs, 'packages/notes.md'),
    "---\ntype: Note\ntitle: Notes\ndescription: Notes.\nsources:\n  - resource: '../../../packages/glyph/src/index.ts'\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# Notes\n\nSee [the entry](../../../packages/glyph/src/index.ts) for details.\n\n| ID | Decision |\n| --- | --- |\n| D-001 | First. |\n| D-002 | Second. |\n",
  );

  const rows = await search(docs, ['glyph/src/index.ts']);
  assert.deepEqual(rows.slice(0, 2), [
    'Cited as a source by:',
    '  packages/notes.md  Notes (cites packages/glyph/src/index.ts)',
  ]);
  assert.ok(rows.includes('  [14-14] See [the entry](../../../packages/glyph/src/index.ts) for details.'));
  assert.deepEqual(await search(docs, ['D-002']), [
    'packages/notes.md › Notes  [12-20]',
    '  [19-19] | D-002 | Second. |',
  ]);
});

test('a decision prints one register row with its section and any superseding file', async () => {
  const bundle = await recordBundle('okf-decision-');
  await mkdir(path.join(bundle, 'planning'), { recursive: true });
  await writeFile(
    path.join(bundle, 'planning/decision-register.md'),
    '# Decision register\n\n## Shaping\n\n| ID | Decision | Status |\n| --- | --- | --- |\n| D-001 | One shaper serves every raster.   | Accepted |\n',
  );
  const replacement = await createRecord(bundle, 'decision', 'two-shapers', 'Two shapers', { date: '2026-10-04' });
  await writeFile(
    replacement,
    (await readFile(replacement, 'utf8')).replace(
      'decision_status: Proposed',
      'decision_status: Accepted\nsupersedes: [D-001]',
    ),
  );

  assert.deepEqual(await decision(bundle, 'D-001'), [
    'planning/decision-register.md › Decision register › Shaping  [7] D-001 — Accepted',
    'One shaper serves every raster.',
    'superseded by planning/decisions/two-shapers.md',
  ]);
  await assert.rejects(decision(bundle, 'D-002'), /D-002 is not in the decision register/u);
});

test('log listings filter by date and mentioned text', async () => {
  const bundle = await recordBundle('okf-log-list-');
  for (const [date, slug, title] of [
    ['2026-09-01', 'old-raster', 'Old raster change'],
    ['2026-09-20', 'shaper', 'Shaper change'],
    ['2026-10-01', 'new-raster', 'New raster change'],
  ]) {
    await createRecord(bundle, 'log', slug, title, { date });
  }
  const paths = async (options) => (await listRecords(bundle, 'log', options)).map((record) => record.path);
  assert.deepEqual(await paths({ since: '2026-09-20' }), ['log/2026-10-01-new-raster.md', 'log/2026-09-20-shaper.md']);
  assert.deepEqual(await paths({ mentions: 'RASTER' }), [
    'log/2026-10-01-new-raster.md',
    'log/2026-09-01-old-raster.md',
  ]);
});

test('the pre-commit report repeats until the package is attested at the staged source', async () => {
  const root = await workspaceFixture('okf-hook-');
  // Docs link outside the package roots; the staged snapshot must carry those targets too.
  await writeFile(path.join(root, 'README.md'), '# Readme\n');
  await writeFile(
    path.join(root, '.agents/docs/index.md'),
    '---\nokf_version: "0.2"\n---\n\n# Index\n\n- [Glyph](packages/glyph.md)\n- [Readme](../../README.md)\n',
  );
  await commitFixture(root);
  await git(root, ['branch', '-M', 'main']);
  await git(root, ['switch', '-q', '-c', 'feature']);
  const hook = async () => (await execFileAsync(process.execPath, [hookPath()], { cwd: root })).stderr;

  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'staged\n');
  await git(root, ['add', 'packages/glyph/src/index.ts']);
  const staged = await git(root, ['write-tree']);
  const first = await hook();
  assert.match(first, /After your last source change, update each concept if it is now wrong, then attest:/u);
  assert.match(first, /❌ missing {2}@pmndrs\/glyph \(\.agents\/docs\/packages\/glyph\.md\)/u);
  assert.match(first, /docs:attest -- @pmndrs\/glyph "<what you changed and checked>"/u);
  assert.doesNotMatch(first, /Validation findings/u);
  assert.equal(await git(root, ['write-tree']), staged, 'the hook never rewrites the index');

  // Still missing on the next commit, even one that only touches docs: the branch changed the package.
  await git(root, ['commit', '-qm', 'feat(glyph): change']);
  await writeFile(
    path.join(root, '.agents/docs/index.md'),
    (await readFile(path.join(root, '.agents/docs/index.md'), 'utf8')) + '\n',
  );
  await git(root, ['add', '.agents/docs/index.md']);
  assert.match(await hook(), /❌ missing {2}@pmndrs\/glyph/u);
  // And on a commit that stages nothing under docs or packages at all.
  await git(root, ['commit', '-qm', 'docs: index']);
  await writeFile(path.join(root, 'README.md'), '# Readme, revised\n');
  await git(root, ['add', 'README.md']);
  assert.match(await hook(), /❌ missing {2}@pmndrs\/glyph/u);

  // Attesting the staged source silences it.
  await attest(root, 'glyph', 'Changed index; concept still accurate.', { date: '2026-10-05' });
  await git(root, ['add', '-A']);
  assert.equal(await hook(), '');
  await git(root, ['commit', '-qm', 'docs(glyph): attest']);

  // A later source change makes the attestation stale until it is attested again.
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'changed again\n');
  await git(root, ['add', 'packages/glyph/src/index.ts']);
  assert.match(await hook(), /⚠️ stale {2}@pmndrs\/glyph/u);
});

test('merging main into a branch reports only the branch, not what main brought in', async () => {
  const root = await workspaceFixture('okf-hook-merge-');
  await mkdir(path.join(root, 'packages/raster/src'), { recursive: true });
  await writeFile(path.join(root, 'packages/raster/package.json'), '{"name":"@pmndrs/raster"}\n');
  await writeFile(path.join(root, 'packages/raster/src/index.ts'), 'initial\n');
  await writeFile(
    path.join(root, '.agents/docs/packages/raster.md'),
    glyphConcept()
      .replace('title: Glyph', 'title: Raster')
      .replace("'@pmndrs/glyph'", "'@pmndrs/raster'")
      .replace('packages/glyph', 'packages/raster'),
  );
  await writeFile(
    path.join(root, '.agents/docs/index.md'),
    '---\nokf_version: "0.2"\n---\n\n# Index\n\n- [Glyph](packages/glyph.md)\n- [Raster](packages/raster.md)\n',
  );
  await commitFixture(root);
  await git(root, ['branch', '-M', 'main']);
  await git(root, ['switch', '-q', '-c', 'feature']);
  await writeFile(path.join(root, 'packages/glyph/src/index.ts'), 'feature\n');
  await git(root, ['add', '-A']);
  await attest(root, 'glyph', 'Changed index; concept still accurate.', { date: '2026-10-05' });
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-qm', 'feat(glyph): change']);
  await git(root, ['switch', '-q', 'main']);
  await writeFile(path.join(root, 'packages/raster/src/index.ts'), 'main moved\n');
  await git(root, ['commit', '-qam', 'feat(raster): change on main']);
  await git(root, ['switch', '-q', 'feature']);

  await git(root, ['merge', '-q', '--no-commit', '--no-ff', 'main']);
  const result = await execFileAsync(process.execPath, [hookPath()], { cwd: root });
  assert.equal(result.stderr, '', 'raster changed on main, not on this branch');
});

test('the pre-commit report lists invalid staged docs and never blocks the commit', async () => {
  const root = await temporaryDirectory('okf-hook-invalid-');
  await git(root, ['init', '-q']);
  await mkdir(path.join(root, '.agents/docs'), { recursive: true });
  await writeFile(path.join(root, '.agents/docs/index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  await writeFile(
    path.join(root, '.agents/docs/invalid.md'),
    "---\ntitle: Missing type\ndescription: Must fail.\ngenerated:\n  by: process:test\n  at: '2026-09-17T00:00:00Z'\n---\n\n# Invalid\n",
  );
  await git(root, ['add', '.agents/docs']);

  const result = await execFileAsync(process.execPath, [hookPath()], { cwd: root });
  assert.match(result.stderr, /Validation findings \(reproduce with mise exec -- pnpm scripts run docs:check\):/u);
  assert.match(result.stderr, /\.agents\/docs\/invalid\.md: missing non-empty type/u);
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
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.githooks/okf-docs-report.mjs');
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
  await git(root, ['config', 'commit.gpgsign', 'false']);
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

async function recordBundle(prefix) {
  const bundle = await temporaryDirectory(prefix);
  await writeFile(path.join(bundle, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Index\n');
  return bundle;
}
