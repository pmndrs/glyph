import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Rebase staged maps onto the source tree that ships beside dist, without changing their mappings. */
export async function rewritePublishedSourceMaps(stagingDirectory, distributionDirectory, sourceDirectory) {
  for (const entry of await readdir(stagingDirectory, { recursive: true })) {
    if (!entry.endsWith('.map')) continue;
    const stagedFile = join(stagingDirectory, entry);
    const map = JSON.parse(await readFile(stagedFile, 'utf8'));
    map.sources = map.sources.map((source) => {
      const sourcePath = resolve(dirname(stagedFile), map.sourceRoot ?? '', source);
      const sourceRelative = relative(sourceDirectory, sourcePath);
      if (isAbsolute(sourceRelative) || sourceRelative === '..' || sourceRelative.startsWith(`..${sep}`)) {
        throw new Error(`Source map ${entry} references a source outside the published tree: ${source}`);
      }
      return relative(dirname(join(distributionDirectory, entry)), sourcePath)
        .split(sep)
        .join('/');
    });
    delete map.sourceRoot;
    await writeFile(stagedFile, JSON.stringify(map));
  }
}
