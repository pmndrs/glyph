import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertArchiveSha256(bytes: Uint8Array, expected: string): void {
  if (!/^[a-f0-9]{64}$/u.test(expected) || sha256(bytes) !== expected) {
    throw new Error('Archive SHA-256 does not match expected value');
  }
}

export function assertCompleteArchiveEnvironment(values: readonly (string | undefined)[]): void {
  if (values.some((value) => value !== undefined) && values.some((value) => value === undefined)) {
    throw new Error(
      'Installed archive proof requires package root, output directory, archive artifact, and SHA-256 together',
    );
  }
}

export function assertProofServerNonce(headers: Record<string, string>, expected: string): void {
  if (headers['x-glyph-proof-nonce'] !== expected) {
    throw new Error('Browser response did not route to this proof Vite instance');
  }
}

export async function distInventory(root: string): Promise<Record<string, string>> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(?:js|wasm)$/u.test(entry.name)) files.push(path);
    }
  }
  await visit(root);
  files.sort();
  return Object.fromEntries(
    await Promise.all(files.map(async (path) => [relative(root, path), sha256(await readFile(path))] as const)),
  );
}

export function assertInstalledDist(archive: Record<string, string>, installed: Record<string, string>): void {
  assert.ok(Object.keys(archive).length > 0, 'archive has no JS/Wasm dist members');
  assert.deepStrictEqual(installed, archive, 'every installed JS/Wasm dist member must match the frozen archive');
}

export function assertDeliveredEntries(
  responses: readonly { readonly source: string; readonly status: number }[],
  expected: readonly string[],
): void {
  for (const source of expected) {
    if (!responses.some((response) => response.source === source && response.status >= 200 && response.status < 300)) {
      throw new Error(`Installed ${source} was not served successfully`);
    }
  }
}

/** Resolve a Vite response to a member of the authenticated installed dist tree. */
export function installedDistResponseSource(
  url: string,
  expectedOrigin: string,
  viteRoot: string,
  installedDistRoot: string,
): string | undefined {
  const responseUrl = new URL(url);
  if (responseUrl.origin !== expectedOrigin) return undefined;
  const rawPath = url.slice(responseUrl.origin.length).split(/[?#]/u, 1)[0] ?? '';
  if (
    decodeURIComponent(rawPath)
      .split('/')
      .some((part) => part === '.' || part === '..')
  )
    return undefined;
  const pathname = decodeURIComponent(responseUrl.pathname);
  if (pathname.split('/').some((part) => part === '.' || part === '..')) return undefined;
  const absolutePath = pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : resolve(viteRoot, `.${pathname}`);
  const source = relative(installedDistRoot, absolutePath);
  return source !== '' && source !== '..' && !source.startsWith('../') && !isAbsolute(source) ? source : undefined;
}
