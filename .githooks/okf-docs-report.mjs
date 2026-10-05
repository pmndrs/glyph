#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  changedPackages,
  packageInventory,
  readAttestations,
  sourceDigest,
} from '../.agents/skills/open-knowledge-format/scripts/attestations.mjs';
import { docsFindings, renderCommitReport } from '../.agents/skills/open-knowledge-format/scripts/docs-drift.mjs';

// Docs upkeep never blocks a commit. Until every package this branch changes is attested at the source
// about to be committed, each commit says which packages are missing or stale; attesting after the last
// source change is what silences it, so the reminder always has an exit. Every outcome exits 0.
const watchedRoots = ['.agents/docs/', 'apps/', 'benches/', 'packages/'];
// Every tracked root the docs link to, or links would read as missing in the staged snapshot.
const snapshotRoots = ['.agents', '.github', 'README.md', 'RESEARCH.md', 'apps', 'benches', 'packages'];
const defaultBranches = ['origin/HEAD', 'origin/main', 'main'];

async function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);
  const staged = gitBuffer(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  // Every commit counts while the branch has unattested package changes, whatever this commit stages.
  const changed = [...staged, ...branchChanges()];
  if (!changed.some((filePath) => watchedRoots.some((root) => filePath.startsWith(root)))) return;

  // Judge the staged snapshot, not the working tree, so unstaged edits neither hide nor invent findings.
  const snapshot = await mkdtemp(path.join(tmpdir(), 'glyph-okf-index-'));
  try {
    const files = gitBuffer(['ls-files', '-z', '--', ...snapshotRoots]);
    gitBuffer(['checkout-index', `--prefix=${snapshot}${path.sep}`, '-z', '--stdin'], files);
    const attestations = await readAttestations(snapshot);
    const packages = [];
    for (const entry of changedPackages(await packageInventory(snapshot), changed)) {
      const source = await sourceDigest(repositoryRoot, entry.source, ':index');
      const mine = attestations.filter((record) => record.package === entry.name);
      if (mine.some((record) => record.source === source)) continue;
      packages.push({ ...entry, status: mine.length > 0 ? 'stale' : 'missing' });
    }
    process.stderr.write(renderCommitReport({ packages, findings: await docsFindings(snapshot) }));
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

/**
 * Files the branch changed since it left the default branch; empty when no base exists (an unborn branch
 * or shallow history). Of the candidate bases, the newest merge base wins, so a stale or misdirected
 * `origin/HEAD` can never widen the range to other branches' changes.
 */
function branchChanges() {
  const bases = [];
  for (const candidate of defaultBranches) {
    try {
      bases.push(git(['merge-base', candidate, 'HEAD']).trim());
    } catch {
      // Unknown ref, unborn branch, or shallow history.
    }
  }
  const newest = bases.find((base) => bases.every((other) => isAncestor(other, base)));
  return newest === undefined ? [] : git(['diff', '--name-only', newest, 'HEAD']).split('\n').filter(Boolean);
}

function isAncestor(ancestor, descendant) {
  try {
    git(['merge-base', '--is-ancestor', ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

function git(arguments_) {
  return gitBuffer(arguments_).toString('utf8');
}

function gitBuffer(arguments_, input) {
  return execFileSync('git', arguments_, {
    cwd: process.cwd(),
    input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

runHook().catch((error) => {
  process.stderr.write(
    `docs: report unavailable (${error instanceof Error ? error.message : String(error)}); commit continues.\n`,
  );
});
