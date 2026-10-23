import { dirname, resolve } from 'node:path';

/** Redirect only the benchmark font library's private loader import into the installed archive. */
export function archiveBenchmarkLoaderResolution(
  id: string,
  importer: string | undefined,
  benchesRoot: string,
  installedRoot: string,
): string | undefined {
  if (importer === undefined) return undefined;
  const importerPath = normalizedVitePath(importer);
  if (importerPath !== resolve(benchesRoot, 'src/workloads/font-assets/library.ts')) return undefined;
  const requestedPath = id.startsWith('.') ? resolve(dirname(importerPath), id) : normalizedVitePath(id);
  if (requestedPath !== resolve(benchesRoot, '../packages/glyph/src/loader.js')) return undefined;
  return resolve(installedRoot, 'dist/loader.js');
}

function normalizedVitePath(id: string): string {
  const pathname = id.split(/[?#]/u, 1)[0] ?? '';
  return resolve(pathname.startsWith('/@fs/') ? pathname.slice('/@fs'.length) : pathname);
}
