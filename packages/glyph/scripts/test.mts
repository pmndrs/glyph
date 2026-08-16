import { isMainModule, runCargo, runNode, runNodeTests } from './support/command.mts';

const completeRustTargets = [
  { manifest: 'rust/bitmap-baker/Cargo.toml' },
  { manifest: 'rust/font-baker/Cargo.toml', features: 'subsetting' },
  { manifest: 'rust/shaper/Cargo.toml' },
  { manifest: 'rust/slug-baker/Cargo.toml' },
] as const;

const libraryRustManifests = [
  'rust/mtsdf-core/Cargo.toml',
  'rust/mtsdf-baker/Cargo.toml',
  'rust/mtsdf-admission/Cargo.toml',
  'rust/slug-core/Cargo.toml',
  'rust/slug-fontations/Cargo.toml',
] as const;

export async function runGlyphTest(): Promise<void> {
  await runNode('scripts/unicode.mts', ['check-data']);
  await runNode('scripts/build.mjs');
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.types.json']);
  for (const target of completeRustTargets) {
    await runCargo([
      'test',
      '--manifest-path',
      target.manifest,
      '--locked',
      ...('features' in target ? ['--features', target.features] : []),
    ]);
  }
  for (const manifest of libraryRustManifests) {
    await runCargo(['test', '--manifest-path', manifest, '--lib', '--locked']);
  }
  await runNode('scripts/test-mtsdf-core-wasm.mjs');
  await runNode('scripts/generate-mtsdf-oracle-evidence.mjs', ['--check']);
  await runNode('scripts/sync-unicode-test-data.mjs', ['--check']);
  await runNodeTests(['tests/package/*.test.mjs', 'tests/integration/*.test.mjs']);
  await runNodeTests(['tests/fuzz/*.test.mjs']);
  await runNodeTests(['tests/font-baker/integration/*.test.mjs']);
  await runNodeTests(['tests/font-baker/fuzz/*.test.mjs']);
  await runNodeTests(['tests/font-baker/e2e/*.test.mjs']);
}

if (isMainModule(import.meta.url)) {
  runGlyphTest().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
