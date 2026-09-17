#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const formatExtension = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|css|scss|html)$/u;
const lintExtension = /\.[cm]?[jt]sx?$/u;

function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);

  const staged = gitFiles(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  if (staged.length === 0) return;

  const fixable = staged.filter((filePath) => formatExtension.test(filePath));
  const lintable = staged.filter((filePath) => lintExtension.test(filePath));
  const unstaged = new Set(gitFiles(['diff', '--name-only', '-z']));
  const partiallyStaged = fixable.filter((filePath) => unstaged.has(filePath));
  if (partiallyStaged.length > 0) {
    throw new Error(
      `cannot safely auto-fix partially staged files; stage or stash them first:\n${partiallyStaged.join('\n')}`,
    );
  }

  if (fixable.length > 0) runPnpm(['exec', 'oxfmt', '--write', ...fixable]);

  let lintStatus = 0;
  if (lintable.length > 0) {
    lintStatus =
      spawnSync(pnpmExecutable(), ['exec', 'oxlint', '--fix', '--deny-warnings', ...lintable], {
        cwd: repositoryRoot,
        stdio: 'inherit',
      }).status ?? 1;
  }

  if (fixable.length > 0) git(['add', '--', ...fixable]);
  if (lintStatus !== 0) throw new Error('lint still reports diagnostics after applying safe fixes');

  execFileSync(process.execPath, [path.join(repositoryRoot, '.githooks/okf-digests.mjs')], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
}

function runPnpm(arguments_) {
  execFileSync(pnpmExecutable(), arguments_, { cwd: process.cwd(), stdio: 'inherit' });
}

function pnpmExecutable() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function git(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitFiles(arguments_) {
  return git(arguments_).split('\0').filter(Boolean);
}

try {
  runHook();
} catch (error) {
  process.stderr.write(`pre-commit: ${error instanceof Error ? error.message : String(error)}.\n`);
  process.exitCode = 1;
}
