#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { packageDigest } from '../.agents/skills/open-knowledge-format/scripts/package-digest.mjs';
import { formatValidation, validateOkf } from '../.agents/skills/open-knowledge-format/scripts/validate-okf.mjs';

const packageConcepts = new Map([
  ['benches', '.agents/docs/packages/benchmarks.md'],
  ['apps/r3f-hello-world', '.agents/docs/packages/examples.md'],
  ['packages/glyph', '.agents/docs/packages/glyph.md'],
  ['packages/glyph-example-raster', '.agents/docs/packages/glyph-example-raster.md'],
  ['packages/glyph-example-renderer', '.agents/docs/packages/glyph-example-renderer.md'],
]);

async function runHook() {
  const repositoryRoot = git(['rev-parse', '--show-toplevel']).trim();
  process.chdir(repositoryRoot);
  const staged = gitBuffer(['diff', '--cached', '--name-only', '-z']).toString('utf8').split('\0').filter(Boolean);
  if (staged.length === 0) return;

  const affected = [...packageConcepts.keys()].filter((root) =>
    staged.some((filePath) => filePath.startsWith(`${root}/`)),
  );
  const docsChanged = staged.some((filePath) => filePath.startsWith('.agents/docs/'));
  if (affected.length === 0 && !docsChanged) return;

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'glyph-okf-index-'));
  try {
    if (affected.length > 0) {
      await materializeIndex(affected, temporaryRoot);
      for (const packageRoot of affected) {
        const conceptPath = packageConcepts.get(packageRoot);
        const digest = await packageDigest(path.join(temporaryRoot, packageRoot));
        if (await updateDigestPin(conceptPath, digest)) {
          process.stdout.write(`okf-digests: re-pinned ${conceptPath}\n`);
        }
      }
    }
    await rm(temporaryRoot, { recursive: true, force: true });
    await materializeIndex(['.agents', '.github', 'README.md', 'RESEARCH.md', 'apps', 'benches', 'packages'], temporaryRoot);
    await validateStagedSnapshot(temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function materializeIndex(roots, destinationRoot) {
  const files = gitBuffer(['ls-files', '-z', '--', ...roots]);
  gitBuffer(['checkout-index', `--prefix=${destinationRoot}${path.sep}`, '-z', '--stdin'], files);
}

async function updateDigestPin(conceptPath, digest) {
  const indexSource = gitBuffer(['show', `:${conceptPath}`]).toString('utf8');
  const indexUpdated = replaceDigest(indexSource, digest, conceptPath);
  if (indexUpdated === indexSource) return false;

  const indexEntry = git(['ls-files', '-s', '--', conceptPath]).trim();
  const mode = /^(\d+) /u.exec(indexEntry)?.[1];
  if (mode === undefined) throw new Error(`could not read index mode for ${conceptPath}`);
  const object = git(['hash-object', '-w', '--stdin'], indexUpdated).trim();
  git(['update-index', '--cacheinfo', `${mode},${object},${conceptPath}`]);

  const workingSource = await readFile(conceptPath, 'utf8');
  const workingUpdated = replaceDigest(workingSource, digest, conceptPath);
  if (workingUpdated !== workingSource) await writeFile(conceptPath, workingUpdated);
  return true;
}

function replaceDigest(source, digest, conceptPath) {
  const updated = source.replace(/source_digest: 'sha256:[0-9a-f]{64}'/u, `source_digest: '${digest}'`);
  if (updated === source && !source.includes(`source_digest: '${digest}'`)) {
    throw new Error(`could not find source_digest in ${conceptPath}`);
  }
  return updated;
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
  process.stderr.write(`okf-digests: ${error instanceof Error ? error.message : String(error)}.\n`);
  process.exitCode = 1;
});
