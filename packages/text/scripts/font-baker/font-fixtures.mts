/* @workflow
{
  "name": "font-baker:shaping-oracle",
  "summary": "Generate shaping oracle output for a supplied font and corpus.",
  "requirements": "Stable Rust and the package oracle feature.",
  "writes": "The caller-selected oracle output.",
  "args": ["shaping-oracle"]
}
*/
/* @workflow
{
  "name": "font-baker:inspect-font",
  "summary": "Inspect one font fixture through the package oracle tooling.",
  "requirements": "Stable Rust and the package oracle feature.",
  "writes": "Standard output only.",
  "args": ["inspect"]
}
*/

import { commandArguments, isMainModule, runCargo } from '../support/command.mts';

export async function runFontFixtures(arguments_: readonly string[]): Promise<void> {
  const { command, rest } = commandArguments(arguments_, 'font-fixtures');
  const binary =
    command === 'shaping-oracle'
      ? 'generate-shaping-oracle'
      : command === 'inspect'
        ? 'inspect-font-fixture'
        : undefined;
  if (binary === undefined) throw new Error(`Unknown font fixture command: ${command}`);
  await runCargo([
    'run',
    '--manifest-path',
    'rust/font-baker/Cargo.toml',
    '--bin',
    binary,
    '--features',
    'oracle',
    '--locked',
    '--quiet',
    '--',
    ...rest,
  ]);
}

if (isMainModule(import.meta.url)) {
  runFontFixtures(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
