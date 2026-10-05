#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  conceptsToReview,
  docsFindings,
  renderCommitReport,
} from '../.agents/skills/open-knowledge-format/scripts/docs-drift.mjs';

// Docs upkeep never blocks a commit. The hook exists to tell whoever is committing, usually an agent,
// which concepts to review against the staged change and which command records it, at the moment the
// change is fresh in mind. Every outcome, including a failure of the report itself, exits 0.
const watchedRoots = ['.agents/docs/', 'apps/', 'benches/', 'packages/'];
const snapshotRoots = ['.agents', '.github', 'README.md', 'RESEARCH.md', 'apps', 'benches', 'packages'];

async function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);
  const staged = gitBuffer(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (!staged.some((filePath) => watchedRoots.some((root) => filePath.startsWith(root)))) return;

  // Judge the staged snapshot, not the working tree, so unstaged edits neither hide nor invent findings.
  const snapshot = await mkdtemp(path.join(tmpdir(), 'glyph-okf-index-'));
  try {
    // Include every tracked root the docs link to, or its links would read as missing.
    const files = gitBuffer(['ls-files', '-z', '--', ...snapshotRoots]);
    gitBuffer(['checkout-index', `--prefix=${snapshot}${path.sep}`, '-z', '--stdin'], files);
    const report = renderCommitReport({
      review: await conceptsToReview(snapshot, staged),
      findings: await docsFindings(snapshot),
    });
    process.stderr.write(report);
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
