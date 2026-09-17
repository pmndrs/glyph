import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const excludedDirectories = new Set(['.cache', 'coverage', 'dist', 'node_modules', 'target']);

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

/** Computes the deterministic OKF source digest for one package directory. */
export async function packageDigest(packageRoot) {
  const value = createHash('sha256');
  for (const absolutePath of await packageFiles(packageRoot)) {
    const relativePath = path.relative(packageRoot, absolutePath).split(path.sep).join('/');
    value.update(relativePath);
    value.update('\0');
    value.update(await readFile(absolutePath));
    value.update('\0');
  }
  return `sha256:${value.digest('hex')}`;
}

/** Lists package files in the same order used by {@link packageDigest}. */
export async function packageFiles(packageRoot) {
  const files = [];
  await visit(packageRoot, files);
  return files.sort(comparePaths);
}

async function visit(directory, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(absolutePath, files);
    } else if (
      entry.name !== '.DS_Store' &&
      path.extname(entry.name) !== '.tsbuildinfo' &&
      (entry.isFile() || (entry.isSymbolicLink() && (await stat(absolutePath)).isFile()))
    ) {
      files.push(absolutePath);
    }
  }
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
