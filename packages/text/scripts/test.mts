import { isMainModule, runCargo, runNode, runNodeTests } from './support/command.mts';

const completeRustManifests = [
  'rust/bitmap-baker/Cargo.toml',
  'rust/shaper/Cargo.toml',
  'rust/slug-baker/Cargo.toml',
] as const;

const libraryRustManifests = [
  'rust/mtsdf-core/Cargo.toml',
  'rust/mtsdf-baker/Cargo.toml',
  'rust/mtsdf-admission/Cargo.toml',
  'rust/slug-core/Cargo.toml',
  'rust/slug-fontations/Cargo.toml',
] as const;

export async function runTextTest(): Promise<void> {
  await runNode('scripts/unicode.mts', ['check-data']);
  await runNode('scripts/build.mjs');
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.types.json']);
  for (const manifest of completeRustManifests) {
    await runCargo(['test', '--manifest-path', manifest, '--locked']);
  }
  for (const manifest of libraryRustManifests) {
    await runCargo(['test', '--manifest-path', manifest, '--lib', '--locked']);
  }
  await runNode('scripts/test-mtsdf-core-wasm.mjs');
  await runNode('scripts/generate-mtsdf-oracle-evidence.mjs', ['--check']);
  await runNode('scripts/sync-unicode-test-data.mjs', ['--check']);
  await runNodeTests(['tests/package/*.test.mjs', 'tests/integration/*.test.mjs']);
  await runNodeTests(['tests/fuzz/*.test.mjs']);
}

if (isMainModule(import.meta.url)) {
  runTextTest().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
