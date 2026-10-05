#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { changedPackages, packageInventory } from '../.agents/skills/open-knowledge-format/scripts/attestations.mjs';
import { docsFindings, renderCommitReport } from '../.agents/skills/open-knowledge-format/scripts/docs-drift.mjs';

// Docs upkeep never blocks a commit. The hook tells whoever is committing, usually an agent, which
// packages to attest, once per package per branch: repeating it on every commit would push an agent into
// a loop, and the pull-request report checks the final state anyway. Every outcome exits 0.
const watchedRoots = ['.agents/docs/', 'apps/', 'benches/', 'packages/'];
// Every tracked root the docs link to, or links would read as missing in the staged snapshot.
const snapshotRoots = ['.agents', '.github', 'README.md', 'RESEARCH.md', 'apps', 'benches', 'packages'];

async function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);
  const staged = gitBuffer(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (!staged.some((filePath) => watchedRoots.some((root) => filePath.startsWith(root)))) return;

  // symbolic-ref also names an unborn branch, so the first commit of a repository is covered too.
  let branch = 'detached';
  try {
    branch = git(['symbolic-ref', '--short', '-q', 'HEAD']).trim() || branch;
  } catch {
    // Detached HEAD: reminders are still recorded, under one shared key.
  }
  const ledger = path.resolve(git(['rev-parse', '--git-common-dir']).trim(), 'okf-docs-reminded');
  const reminded = new Set((await readFile(ledger, 'utf8').catch(() => '')).split('\n').filter(Boolean));

  // Judge the staged snapshot, not the working tree, so unstaged edits neither hide nor invent findings.
  const snapshot = await mkdtemp(path.join(tmpdir(), 'glyph-okf-index-'));
  try {
    const files = gitBuffer(['ls-files', '-z', '--', ...snapshotRoots]);
    gitBuffer(['checkout-index', `--prefix=${snapshot}${path.sep}`, '-z', '--stdin'], files);
    const packages = changedPackages(await packageInventory(snapshot), staged).filter(
      (entry) => !reminded.has(`${branch}\t${entry.name}`),
    );
    process.stderr.write(renderCommitReport({ packages, findings: await docsFindings(snapshot) }));
    if (packages.length > 0) {
      await appendFile(ledger, packages.map((entry) => `${branch}\t${entry.name}\n`).join(''));
    }
  } finally {
    await rm(snapshot, { recursive: true, force: true });
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
