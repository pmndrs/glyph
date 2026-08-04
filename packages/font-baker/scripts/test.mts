import { isMainModule, runCargo, runNode, runNodeTests } from './support/command.mts';

export async function runFontBakerTest(): Promise<void> {
  await runNode('scripts/build.mjs');
  await runCargo(['test', '--manifest-path', 'rust/Cargo.toml', '--locked']);
  await runNodeTests(['tests/integration/*.test.mjs']);
  await runNodeTests(['tests/fuzz/*.test.mjs']);
  await runNodeTests(['tests/e2e/*.test.mjs']);
}

if (isMainModule(import.meta.url)) {
  runFontBakerTest().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
