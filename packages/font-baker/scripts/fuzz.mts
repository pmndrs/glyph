/* @workflow
{
  "name": "font-baker:fuzz-validator",
  "summary": "Run the JavaScript artifact-validator fuzzer.",
  "requirements": "Repository-pinned Node.js and a built package.",
  "writes": "Ignored local fuzz evidence.",
  "args": ["validator"]
}
*/
/* @workflow
{
  "name": "font-baker:fuzz-rust",
  "summary": "Run the package-owned Rust cargo-fuzz target.",
  "requirements": "The nested dated nightly and cargo-fuzz toolchain.",
  "writes": "Ignored fuzz corpus and crash artifacts.",
  "args": ["rust"]
}
*/
/* @workflow
{
  "name": "font-baker:fuzz-mtsdf",
  "summary": "Run the MTSDF outline cargo-fuzz target.",
  "requirements": "The nested dated nightly and cargo-fuzz toolchain.",
  "writes": "Ignored fuzz corpus and crash artifacts.",
  "args": ["mtsdf"]
}
*/
/* @workflow
{
  "name": "font-baker:fuzz-mutation",
  "summary": "Run deterministic Rust mutation fuzzing.",
  "requirements": "Stable Rust.",
  "writes": "Ignored local fuzz evidence.",
  "args": ["mutation"]
}
*/

import { commandArguments, isMainModule, runNode } from './support/command.mts';

export async function runFuzz(arguments_: readonly string[]): Promise<void> {
  const { command, rest } = commandArguments(arguments_, 'fuzz');
  switch (command) {
    case 'validator':
      await runNode('scripts/build.mjs');
      await runNode('scripts/fuzz-validator.mjs', rest);
      return;
    case 'rust':
      await runNode('scripts/fuzz-rust.mjs', rest);
      return;
    case 'mtsdf':
      await runNode('scripts/fuzz-rust.mjs', ['mtsdf_outline', ...rest]);
      return;
    case 'mutation':
      await runNode('scripts/fuzz-rust-mutation.mjs', rest);
      return;
    default:
      throw new Error(`Unknown fuzz command: ${command}`);
  }
}

if (isMainModule(import.meta.url)) {
  runFuzz(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
