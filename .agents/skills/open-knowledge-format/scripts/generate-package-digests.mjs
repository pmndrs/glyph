#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageDigest, workspacePackages } from './package-digest.mjs';

export async function generatePackageDigests(workspaceRoot = '.') {
  const absoluteRoot = path.resolve(workspaceRoot);
  const packages = await workspacePackages(absoluteRoot);
  return Promise.all(
    packages.map(async ([name, packageRoot]) => [
      name,
      await packageDigest(packageRoot),
      path.relative(absoluteRoot, packageRoot).split(path.sep).join('/'),
    ]),
  );
}

if (isMainModule(import.meta.url)) {
  const workspaceRoot = path.resolve(process.argv[2] ?? '.');
  try {
    for (const fields of await generatePackageDigests(workspaceRoot)) process.stdout.write(`${fields.join('\t')}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isMainModule(url) {
  return process.argv[1] !== undefined && url === pathToFileURL(path.resolve(process.argv[1])).href;
}
