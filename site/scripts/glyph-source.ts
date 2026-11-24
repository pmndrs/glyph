import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `GLYPH_SOURCE` points the `@pmndrs/glyph` imports at another checkout's
 * `packages/glyph` — the API the examples are written against lands on a
 * branch ahead of this one, and the override is how they are built and
 * verified before it merges. Unset, the workspace package resolves as usual.
 *
 * Each published subpath declares its TypeScript entry under the `source`
 * condition, so the exports map is the one place that knows where a subpath
 * lives — including the package's own self-imports such as `/tsl/bitmap`.
 */
export function glyphSourceAliases(
  packageDirectory = process.env['GLYPH_SOURCE'],
): { find: RegExp; replacement: string }[] {
  if (packageDirectory === undefined) return [];
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')) as {
    exports: Record<string, { source?: string } | string | null>;
  };
  const aliases: { find: RegExp; replacement: string }[] = [];
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    const source = entry !== null && typeof entry === 'object' ? entry.source : undefined;
    if (source === undefined) continue;
    const specifier = `@pmndrs/glyph${subpath.slice(1)}`;
    const wildcard = specifier.indexOf('*');
    const sourceWildcard = source.indexOf('*');
    if (wildcard !== -1 && sourceWildcard !== -1) {
      const prefix = escapeRegExp(specifier.slice(0, wildcard));
      const suffix = escapeRegExp(specifier.slice(wildcard + 1));
      aliases.push({
        find: new RegExp(`^${prefix}(.+)${suffix}$`),
        replacement: join(packageDirectory, source.replace('*', '$1')),
      });
      continue;
    }
    aliases.push({
      find: new RegExp(`^${escapeRegExp(specifier)}$`),
      replacement: join(packageDirectory, source),
    });
  }
  return aliases;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
