/** Runtime dependencies needed by every isolated installed-package Labs consumer. */
export function installedPackageDependencies(glyph: string) {
  return {
    '@pmndrs/glyph': glyph,
    three: '0.185.1',
    typegpu: '0.12.5',
  } as const;
}
