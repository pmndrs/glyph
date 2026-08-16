/* @workflow
{
  "name": "glyph:bitmap-fixture:generate",
  "summary": "Regenerate the canonical Bitmap artifact through the public baker.",
  "requirements": "Stable Rust, Binaryen, and the @pmndrs/glyph package build.",
  "writes": "The checked-in canonical Bitmap fixture.",
  "args": ["bitmap"]
}
*/

import { commandArguments, isMainModule, runNode, runPnpm } from './support/command.mts';

export async function runFixtures(arguments_: readonly string[]): Promise<void> {
  const { command, rest } = commandArguments(arguments_, 'fixtures');
  if (command !== 'bitmap') throw new Error(`Unknown fixture command: ${command}`);
  await runPnpm(['run', 'build']);
  await runNode('scripts/generate-bitmap-fixture.mjs', rest);
}

if (isMainModule(import.meta.url)) {
  runFixtures(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
