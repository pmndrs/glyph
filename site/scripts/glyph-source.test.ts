import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { glyphSourceAliases } from './glyph-source';

describe('glyphSourceAliases', () => {
  it('resolves wildcard package exports to their source files', () => {
    const packageDirectory = resolve(import.meta.dirname, '../../packages/glyph');
    const aliases = glyphSourceAliases(packageDirectory);
    const specifier = '@pmndrs/glyph/react/msdf';
    const alias = aliases.find(({ find }) => find.test(specifier));

    expect(alias).toBeDefined();
    expect(specifier.replace(alias!.find, alias!.replacement)).toBe(resolve(packageDirectory, 'src/react/msdf.ts'));
  });
});
