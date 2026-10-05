#!/usr/bin/env node
/* @workflow {"name": "docs:attest", "args": [".", "attest"], "summary": "After your last source change to a package, record what you changed and checked in its docs: `-- <package> \"<note>\"`. Writes one new attestation file to commit with the change.", "requirements": "The repository-pinned Node.js runtime.", "writes": "One new file under .agents/docs/attestations/"} */
/* @workflow {"name": "docs:verify", "args": [".", "verify"], "summary": "Reviewer step for the Sync agent docs issue: after correcting the docs, `-- <slug>` writes one verification log entry for every pending attestation and gap and removes the consumed attestations.", "requirements": "The repository-pinned Node.js runtime and full git history.", "writes": "One new log entry; deletes consumed files under .agents/docs/attestations/"} */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import yaml from 'js-yaml';

import { placeholder } from './records.mjs';
import { excludedDirectories, workspacePackages } from './workspace-packages.mjs';

/**
 * Agent intent and its verification, recorded so that no two pull requests ever edit the same file.
 *
 * A contributor attests, per package it changed, what it changed and checked in the docs. The
 * attestation is a new file naming the exact package source it covers, so CI can verify the claim refers
 * to the pull request's own head. On `main`, a reviewer works every pending attestation and every merge
 * that changed a package without one (a gap), corrects the docs from the evidence, and records one
 * verification Log Entry that names the source it verified and the verdict for each attestation and
 * gap; the consumed attestations are deleted. Everything else, including which pull requests merged
 * without intent, is derived from git history, so there is no shared ledger to conflict over.
 */

const execFileAsync = promisify(execFile);

export const attestationDirectory = 'attestations';
export const reviewKinds = Object.freeze(['attestation', 'gap']);
export const reviewVerdicts = Object.freeze(['confirmed', 'corrected', 'documented', 'no-change']);
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const bundleRelative = '.agents/docs';

/**
 * A package's source identity: SHA-256 over its tracked paths and git blob IDs, never file bytes, so the
 * same tree yields the same digest in every checkout whether or not Git LFS content is present.
 * `revision` is a commit-ish, or `:index` for what the next commit will contain.
 */
export async function sourceDigest(root, sourcePath, revision = 'HEAD') {
  const listing =
    revision === ':index'
      ? await git(root, ['ls-files', '-s', '-z', '--', sourcePath])
      : await git(root, ['ls-tree', '-r', '-z', revision, '--', sourcePath]);
  const entries = [];
  for (const record of listing.split('\0').filter(Boolean)) {
    const [meta, file] = record.split('\t');
    const fields = meta.split(' ');
    const blob = revision === ':index' ? fields[1] : fields[2];
    const relative = file.slice(sourcePath.length + 1);
    if (isBuildOutput(relative)) continue;
    entries.push(`${relative}\0${blob}\n`);
  }
  const hash = createHash('sha256');
  for (const entry of entries.sort()) hash.update(entry);
  return `sha256:${hash.digest('hex')}`;
}

/** Workspace packages that have a concept, with repository-relative source and concept paths. */
export async function packageInventory(root) {
  const concepts = new Map();
  for (const file of await markdownFiles(path.join(root, bundleRelative))) {
    const data = frontmatter(await readFile(file, 'utf8'));
    if (typeof data.workspace_package === 'string') concepts.set(data.workspace_package, file);
  }
  const inventory = [];
  for (const [name, packageRoot] of await workspacePackages(root)) {
    const concept = concepts.get(name);
    if (concept === undefined) continue;
    inventory.push({ name, source: relativePath(root, packageRoot), concept: relativePath(root, concept) });
  }
  return inventory;
}

/** Packages among `paths` (repository-relative) whose source, not build output, changed. */
export function changedPackages(inventory, paths) {
  return inventory
    .map((entry) => ({
      ...entry,
      files: paths.filter(
        (file) => file.startsWith(`${entry.source}/`) && !isBuildOutput(file.slice(entry.source.length + 1)),
      ),
    }))
    .filter((entry) => entry.files.length > 0);
}

/** Resolves `@scope/name`, `name`, or a source path to one inventory entry. */
export function findPackage(inventory, query) {
  const wanted = query.replace(/\/$/u, '');
  const match = inventory.find(
    (entry) => entry.name === wanted || entry.name.split('/').at(-1) === wanted || entry.source === wanted,
  );
  if (match === undefined) {
    throw new Error(`unknown package ${query}; choose one of ${inventory.map((entry) => entry.name).join(', ')}`);
  }
  return match;
}

/**
 * Records that the committer reviewed `query`'s docs against the source about to be committed. Refuses a
 * second attestation of the same source, and warns when unstaged edits mean the claim may not cover them.
 */
export async function attest(root, query, note, options = {}) {
  if (note.trim().length === 0) throw new Error('say what you changed and checked: docs:attest -- <package> "<note>"');
  const inventory = await packageInventory(root);
  const entry = findPackage(inventory, query);
  const source = await sourceDigest(root, entry.source, ':index');
  if (
    (await readAttestations(root)).some((existing) => existing.package === entry.name && existing.source === source)
  ) {
    throw new Error(`${entry.name} is already attested at ${short(source)}; attest again after the source changes`);
  }
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const now = options.now ?? new Date().toISOString().replace(/\.\d+Z$/u, 'Z');
  const file = path.join(root, bundleRelative, attestationDirectory, `${date}-${slug(entry.name)}-${short(source)}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---
type: Attestation
title: ${JSON.stringify(`${entry.name} at ${short(source)}`)}
description: ${JSON.stringify(`Contributor intent for ${entry.name}, awaiting verification.`)}
package: ${JSON.stringify(entry.name)}
concept: ${JSON.stringify(path.relative(bundleRelative, entry.concept))}
source: '${source}'
generated:
  by: process:docs-attest
  at: '${now}'
---

${note.trim()}
`,
    { flag: 'wx' },
  );
  const unstaged = lines(await git(root, ['diff', '--name-only', '--', entry.source]));
  return { file: relativePath(root, file), source, unstaged };
}

/** Every attestation present in the tree, parsed. */
export async function readAttestations(root) {
  const directory = path.join(root, bundleRelative, attestationDirectory);
  const attestations = [];
  for (const file of (await markdownFiles(directory)).sort()) {
    attestations.push(parseAttestation(relativePath(root, file), await readFile(file, 'utf8')));
  }
  return attestations;
}

function parseAttestation(file, text) {
  const data = frontmatter(text);
  return { file, package: data.package, source: data.source, note: body(text) };
}

/**
 * The pull-request view, judged at the pull request's own head rather than a merge preview, so a
 * concurrent change on the base never makes an attestation look stale.
 */
export async function pullRequestAttestations(root, base, head = 'HEAD') {
  await requireFullHistory(root);
  const mergeBase = (await git(root, ['merge-base', base, head])).trim();
  const changed = lines(await git(root, ['diff', '--name-only', mergeBase, head]));
  const added = lines(
    await git(root, ['diff', '--name-only', '--diff-filter=A', mergeBase, head, '--', attestationPath()]),
  );
  const attestations = [];
  for (const file of added) {
    attestations.push(parseAttestation(file, await git(root, ['show', `${head}:${file}`])));
  }
  const rows = [];
  for (const entry of changedPackages(await packageInventory(root), changed)) {
    const current = await sourceDigest(root, entry.source, head);
    const mine = attestations.filter((record) => record.package === entry.name);
    const valid = mine.find((record) => record.source === current);
    rows.push({
      package: entry.name,
      concept: entry.concept,
      conceptEdited: changed.includes(entry.concept),
      status: valid ? 'attested' : mine.length > 0 ? 'stale' : 'unattested',
      attestation: valid ?? mine.at(-1),
      current,
    });
  }
  return rows;
}

/**
 * The main-branch audit. Per package: the newest verification and the source it verified, attestations
 * still pending, and gaps — merges since that verification that changed the package without attesting it.
 * A package is current only when its source matches the verification and nothing is pending.
 */
export async function auditDocs(root, head = 'HEAD') {
  await requireFullHistory(root);
  const verifications = await readVerifications(root, head);
  const pending = await readAttestations(root);
  const report = [];
  for (const entry of await packageInventory(root)) {
    const verification = verifications.find((candidate) => candidate.verified[entry.name] !== undefined);
    const current = await sourceDigest(root, entry.source, head);
    const range = verification === undefined ? [head] : [`${verification.commit}..${head}`];
    const changes = parseCommits(
      await git(root, [
        'log',
        '--first-parent',
        '--format=%H%x09%h%x09%s',
        ...range,
        '--',
        ...sourcePathspecs(entry.source),
      ]),
    );
    const gaps = [];
    for (const change of changes) {
      if (!(await attestsPackage(root, change.sha, entry.name))) gaps.push(change);
    }
    const waiting = [];
    for (const record of pending.filter((candidate) => candidate.package === entry.name)) {
      const added = parseCommits(
        await git(root, [
          'log',
          '--first-parent',
          '--diff-filter=A',
          '--format=%H%x09%h%x09%s',
          '-1',
          head,
          '--',
          record.file,
        ]),
      )[0];
      waiting.push({ ...record, pr: added?.pr, commit: added?.short });
    }
    const verified = verification?.verified[entry.name];
    report.push({
      package: entry.name,
      source: entry.source,
      concept: entry.concept,
      current,
      verified,
      verification: verification?.file,
      pending: waiting,
      gaps,
      status:
        verified === current && waiting.length === 0 ? 'current' : verification === undefined ? 'unverified' : 'review',
    });
  }
  return report;
}

/** History-derived answers are wrong, not just incomplete, in a shallow clone, so refuse rather than guess. */
async function requireFullHistory(root) {
  if ((await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true') {
    throw new Error(
      'docs audits read git history; this clone is shallow (fetch with fetch-depth: 0 or git fetch --unshallow)',
    );
  }
}

/** Whether commit `sha` (a merge, squash, or direct commit on main) added an attestation for `name`. */
async function attestsPackage(root, sha, name) {
  const added = lines(
    await git(root, ['diff', '--name-only', '--diff-filter=A', `${sha}^1`, sha, '--', attestationPath()]).catch(
      () => '',
    ),
  );
  for (const file of added) {
    if (parseAttestation(file, await git(root, ['show', `${sha}:${file}`])).package === name) return true;
  }
  return false;
}

/** Verification Log Entries, newest first, with the commit that added each. */
async function readVerifications(root, head) {
  const directory = path.join(root, bundleRelative, 'log');
  const verifications = [];
  for (const file of (await markdownFiles(directory)).sort().reverse()) {
    const data = frontmatter(await readFile(file, 'utf8'));
    if (data.verified_sources === undefined || typeof data.verified_sources !== 'object') continue;
    const relative = relativePath(root, file);
    const commit = (await git(root, ['log', '--diff-filter=A', '--format=%H', '-1', head, '--', relative])).trim();
    if (commit === '') continue;
    verifications.push({ file: relative, verified: data.verified_sources, commit });
  }
  return verifications;
}

/**
 * Scaffolds one verification Log Entry covering every package that needs review (or `packages`), with a
 * row per pending attestation and per gap for the reviewer to give a verdict, then deletes the consumed
 * attestation files. The entry fails validation until every scaffold placeholder is replaced.
 */
export async function verify(root, entrySlug, options = {}) {
  const audit = (await auditDocs(root)).filter((entry) =>
    options.packages === undefined ? entry.status !== 'current' : options.packages.includes(entry.package),
  );
  if (audit.length === 0) throw new Error('nothing to verify: every package is current');
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const now = options.now ?? new Date().toISOString().replace(/\.\d+Z$/u, 'Z');
  const reviews = [];
  // A baseline adopts today's source as verified without per-commit verdicts; it is for the first entry
  // of a bundle, whose history predates attestations, and it consumes no pending attestation.
  for (const entry of options.baseline ? [] : audit) {
    for (const record of entry.pending) {
      reviews.push({
        package: entry.package,
        kind: 'attestation',
        pr: record.pr ?? null,
        commit: record.commit ?? null,
        claim: record.note,
        verdict: `${placeholder} confirmed | corrected`,
      });
    }
    for (const gap of entry.gaps) {
      reviews.push({
        package: entry.package,
        kind: 'gap',
        pr: gap.pr ?? null,
        commit: gap.short,
        claim: null,
        verdict: `${placeholder} documented | no-change`,
      });
    }
  }
  const data = {
    type: 'Log Entry',
    title: `Verified agent docs for ${audit.map((entry) => entry.package).join(', ')}`,
    // OKF reserves `verified` for verification events, so the verified source digests get their own key.
    // Like docs:attest, record what the next commit will contain, so a verification made before
    // committing the reviewer's last change still matches the source it describes.
    verified_sources: Object.fromEntries(
      await Promise.all(audit.map(async (entry) => [entry.package, await sourceDigest(root, entry.source, ':index')])),
    ),
    reviews,
    generated: { by: 'process:docs-verify', at: now },
  };
  const file = path.join(root, bundleRelative, 'log', `${date}-${entrySlug}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true })}---\n\n${placeholder} ${
      options.baseline
        ? 'Why this source is adopted as verified without per-change review.'
        : "What you verified against each pull request's diff, what you corrected in the docs, and why."
    }\n`,
    { flag: 'wx' },
  );
  const consumed = options.baseline ? [] : audit.flatMap((entry) => entry.pending.map((record) => record.file));
  for (const record of consumed) await rm(path.join(root, record));
  return { file: relativePath(root, file), consumed, reviews: reviews.length };
}

/** Validation for an Attestation concept. */
export function attestationErrors(filePath, data, text) {
  const errors = [];
  if (path.basename(path.dirname(filePath)) !== attestationDirectory) {
    errors.push(`${filePath}: an Attestation lives in an ${attestationDirectory}/ directory`);
  }
  if (typeof data.package !== 'string' || data.package.length === 0)
    errors.push(`${filePath}: an Attestation names its package`);
  if (!digestPattern.test(String(data.source)))
    errors.push(`${filePath}: source must be a sha256: digest from docs:attest`);
  if (body(text).length === 0) errors.push(`${filePath}: an Attestation says what was changed and checked`);
  return errors;
}

/** Validation for the verification fields a Log Entry may carry. */
export function verificationErrors(filePath, data) {
  if (data.verified_sources === undefined && data.reviews === undefined) return [];
  const errors = [];
  const verified = data.verified_sources;
  if (typeof verified !== 'object' || verified === null || Array.isArray(verified)) {
    errors.push(`${filePath}: verified_sources maps each package to the sha256: source it verified`);
  } else {
    for (const [name, digest] of Object.entries(verified)) {
      if (!digestPattern.test(String(digest)))
        errors.push(`${filePath}: verified_sources ${name} is not a sha256: digest`);
    }
  }
  for (const [index, review] of (Array.isArray(data.reviews) ? data.reviews : []).entries()) {
    if (!reviewKinds.includes(review?.kind))
      errors.push(`${filePath}: reviews[${index}].kind must be attestation or gap`);
    if (!reviewVerdicts.includes(review?.verdict)) {
      errors.push(`${filePath}: reviews[${index}].verdict must be one of ${reviewVerdicts.join(', ')}`);
    }
  }
  return errors;
}

function attestationPath() {
  return `${bundleRelative}/${attestationDirectory}/`;
}

function isBuildOutput(packageRelativePath) {
  return packageRelativePath
    .split('/')
    .slice(0, -1)
    .some((directory) => excludedDirectories.includes(directory));
}

function sourcePathspecs(sourcePath) {
  return [
    sourcePath,
    ...excludedDirectories.flatMap((directory) => [
      `:(glob,exclude)${sourcePath}/${directory}/**`,
      `:(glob,exclude)${sourcePath}/**/${directory}/**`,
    ]),
  ];
}

/** Commits as `{ sha, short, subject, pr }`, reading the pull request from merge or squash subjects. */
function parseCommits(output) {
  return lines(output).map((line) => {
    const [sha, shortSha, ...subject] = line.split('\t');
    const text = subject.join('\t');
    const pr = /^Merge pull request #(\d+)/u.exec(text)?.[1] ?? /\(#(\d+)\)\s*$/u.exec(text)?.[1];
    return { sha, short: shortSha, subject: text, pr: pr === undefined ? undefined : Number(pr) };
  });
}

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  try {
    return (match && yaml.load(match[1])) || {};
  } catch {
    return {};
  }
}

function body(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim();
}

export function short(digest) {
  return String(digest)
    .replace(/^sha256:/u, '')
    .slice(0, 8);
}

function slug(name) {
  return name
    .split('/')
    .at(-1)
    .replace(/[^a-z0-9]+/giu, '-')
    .toLowerCase();
}

async function markdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(absolute)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
  return files.sort();
}

function lines(output) {
  return output.split('\n').filter(Boolean);
}

function relativePath(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export async function git(cwd, arguments_) {
  const { stdout } = await execFileAsync('git', arguments_, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const usage =
  'usage: attestations.mjs <repository> attest <package> <note…> | verify <slug> [--package <name>…] [--baseline] | audit';

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [repository, operation, ...rest] = process.argv.slice(2);
  try {
    if (repository === undefined) throw new Error(usage);
    const root = path.resolve(repository);
    if (operation === 'attest') {
      const [query, ...note] = rest;
      if (query === undefined) throw new Error(usage);
      const result = await attest(root, query, note.join(' '));
      process.stdout.write(`attested ${result.file} (${short(result.source)}); commit it with your change\n`);
      if (result.unstaged.length > 0) {
        process.stderr.write(
          `warning: unstaged edits are not covered; stage them and attest again:\n${result.unstaged.join('\n')}\n`,
        );
      }
    } else if (operation === 'verify') {
      const [entrySlug, ...flags] = rest;
      if (entrySlug === undefined) throw new Error(usage);
      const packages = flags.flatMap((flag, index) => (flag === '--package' ? [flags[index + 1]] : []));
      const baseline = flags.includes('--baseline');
      const inventory = await packageInventory(root);
      const result = await verify(root, entrySlug, {
        packages: packages.length === 0 ? undefined : packages.map((query) => findPackage(inventory, query).name),
        baseline,
      });
      process.stdout.write(
        `wrote ${result.file} with ${result.reviews} reviews and removed ${result.consumed.length} attestations; ` +
          `replace every ${placeholder} with your verdicts, then commit\n`,
      );
    } else if (operation === 'audit') {
      for (const entry of await auditDocs(root)) {
        process.stdout.write(
          `${entry.package}\t${entry.status}\tpending ${entry.pending.length}\tgaps ${entry.gaps.length}\n`,
        );
      }
    } else {
      throw new Error(usage);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
