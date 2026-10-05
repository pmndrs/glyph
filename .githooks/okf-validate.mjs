#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { formatValidation, validateOkf } from '../.agents/skills/open-knowledge-format/scripts/validate-okf.mjs';

// Coverage rules read package manifests, so a staged manifest change revalidates the bundle too.
const manifestPattern = /^(?:apps\/[^/]+|packages\/[^/]+|benches)\/package\.json$/u;

async function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);
  const staged = gitBuffer(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (staged.length === 0) return;

  const relevant = staged.some((filePath) => filePath.startsWith('.agents/docs/') || manifestPattern.test(filePath));
  if (!relevant) return;

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'glyph-okf-index-'));
  try {
    await materializeIndex(
      ['.agents', '.github', 'README.md', 'RESEARCH.md', 'apps', 'benches', 'packages'],
      temporaryRoot,
    );
    await validateStagedSnapshot(temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function materializeIndex(roots, destinationRoot) {
  const files = gitBuffer(['ls-files', '-z', '--', ...roots]);
  gitBuffer(['checkout-index', `--prefix=${destinationRoot}${path.sep}`, '-z', '--stdin'], files);
}

async function validateStagedSnapshot(snapshotRoot) {
  const bundleRoot = path.join(snapshotRoot, '.agents/docs');
  const result = await validateOkf(bundleRoot, { workspaceRoot: snapshotRoot });
  process.stdout.write(formatValidation(bundleRoot, result));
  if (result.conformance.length > 0 || result.profile.length > 0) {
    throw new Error('staged OKF validation failed');
  }
}

function git(arguments_, input) {
  return gitBuffer(arguments_, input).toString('utf8');
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
  process.stderr.write(`okf-validate: ${error instanceof Error ? error.message : String(error)}.\n`);
  process.exitCode = 1;
});
