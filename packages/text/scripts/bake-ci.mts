/* @workflow
{
  "name": "text:bake-check",
  "summary": "Verify generated Unicode data, test vectors, Wasm artifacts, and the native MTSDF oracle.",
  "requirements": "The core Node, stable Rust, and Binaryen toolchain.",
  "writes": "Temporary build outputs only; checked-in evidence must remain unchanged.",
  "args": []
}
*/

import { isMainModule, runNode } from './support/command.mts';

export async function runBakeCi(): Promise<void> {
  await runNode('scripts/generate-unicode-script-data.mjs', ['--check']);
  await runNode('scripts/generate-unicode-bidi-data.mjs', ['--check']);
  await runNode('scripts/sync-unicode-test-data.mjs', ['--check']);
  await runNode('scripts/build.mjs');
  await runNode('scripts/generate-mtsdf-oracle-evidence.mjs', ['--check']);
}

if (isMainModule(import.meta.url)) {
  runBakeCi().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
