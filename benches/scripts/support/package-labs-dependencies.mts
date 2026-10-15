/** Core consumers pin suspend-react's required React peer to the version provisioned by the frozen workspace lock. */
export function installedCoreDependencies(glyph: string) {
  return {
    '@pmndrs/glyph': glyph,
    react: '19.2.8',
  } as const;
}

/** Runtime dependencies needed by every isolated installed-package Labs consumer. */
export function installedPackageDependencies(glyph: string) {
  return {
    ...installedCoreDependencies(glyph),
    three: '0.185.1',
    typegpu: '0.12.5',
  } as const;
}
