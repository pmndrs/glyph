#!/usr/bin/env node

/* @workflow
{
  "name": "repo:hooks:install",
  "summary": "Install the worktree-safe native pre-commit dispatcher in this clone's shared Git hooks directory.",
  "requirements": "A Git checkout with Node.js and pnpm installed.",
  "writes": "The pre-commit file under git rev-parse --git-common-dir/hooks; existing unrelated hooks and every Git LFS hook are preserved."
}
*/

import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dispatcherMarker = '/.githooks/pre-commit';

async function installHook() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const commonGitDirectory = git(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
  const source = path.join(repositoryRoot, '.githooks/pre-commit');
  const destination = path.join(commonGitDirectory, 'hooks/pre-commit');

  const existing = await readFile(destination, 'utf8').catch((error) => {
    if (hasCode(error, 'ENOENT')) return undefined;
    throw error;
  });
  if (existing?.includes(dispatcherMarker) === true) {
    process.stdout.write(`git-hooks: shared pre-commit hook is already installed for this clone.\n`);
    return;
  }
  if (existing !== undefined) {
    process.stderr.write(`git-hooks: kept existing hook at ${destination}; install .githooks/pre-commit manually.\n`);
    return;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  process.stdout.write(`git-hooks: installed shared pre-commit hook for this clone.\n`);
}

function git(repositoryRoot, arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function hasCode(error, code) {
  return error instanceof Error && 'code' in error && error.code === code;
}

installHook().catch((error) => {
  process.stderr.write(`git-hooks: ${error instanceof Error ? error.message : String(error)}.\n`);
  process.exitCode = 1;
});
