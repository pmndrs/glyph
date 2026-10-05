import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** Build and dependency output under a package root; never package source. */
export const excludedDirectories = Object.freeze(['.cache', 'coverage', 'dist', 'node_modules', 'target']);

/** Returns every workspace package as `[packageName, absolutePackageRoot]`. */
export async function workspacePackages(workspaceRoot) {
  const manifests = [];
  for (const directory of ['apps', 'packages']) {
    const parent = path.join(workspaceRoot, directory);
    for (const entry of await readDirectoryIfPresent(parent)) {
      if (entry.isDirectory()) manifests.push(path.join(parent, entry.name, 'package.json'));
    }
  }
  manifests.push(path.join(workspaceRoot, 'benches', 'package.json'));
  manifests.sort(comparePaths);

  const packages = [];
  for (const manifest of manifests) {
    if (!(await isFile(manifest))) continue;
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    if (typeof data.name !== 'string' || data.name.length === 0) {
      throw new Error(`package manifest has no name: ${manifest}`);
    }
    packages.push([data.name, path.dirname(manifest)]);
  }
  return packages;
}

async function readDirectoryIfPresent(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function comparePaths(left, right) {
  const leftParts = left.split(path.sep);
  const rightParts = right.split(path.sep);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return leftParts.length - rightParts.length;
}
