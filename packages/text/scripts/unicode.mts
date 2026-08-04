/* @workflow
{
  "name": "text:unicode-data:generate",
  "summary": "Regenerate Unicode script and bidi tables.",
  "requirements": "Repository-pinned Node.js.",
  "writes": "Generated Unicode TypeScript data.",
  "args": ["generate-data"]
}
*/
/* @workflow
{
  "name": "text:unicode-data:check",
  "summary": "Verify Unicode script and bidi tables without writing.",
  "requirements": "Repository-pinned Node.js.",
  "writes": "Nothing.",
  "args": ["check-data"]
}
*/
/* @workflow
{
  "name": "text:unicode-tests:sync",
  "summary": "Synchronize official Unicode conformance vectors.",
  "requirements": "Network access to the pinned Unicode sources.",
  "writes": "Authenticated Unicode test fixtures.",
  "args": ["sync-tests"]
}
*/
/* @workflow
{
  "name": "text:unicode-tests:check",
  "summary": "Verify official Unicode conformance vectors without downloading.",
  "requirements": "Checked-in authenticated fixtures.",
  "writes": "Nothing.",
  "args": ["check-tests"]
}
*/

import { commandArguments, isMainModule, runNode } from './support/command.mts';

export async function runUnicode(arguments_: readonly string[]): Promise<void> {
  const { command, rest } = commandArguments(arguments_, 'unicode');
  switch (command) {
    case 'generate-data':
      await runNode('scripts/generate-unicode-script-data.mjs', rest);
      await runNode('scripts/generate-unicode-bidi-data.mjs', rest);
      return;
    case 'check-data':
      await runNode('scripts/generate-unicode-script-data.mjs', ['--check', ...rest]);
      await runNode('scripts/generate-unicode-bidi-data.mjs', ['--check', ...rest]);
      return;
    case 'sync-tests':
      await runNode('scripts/sync-unicode-test-data.mjs', rest);
      return;
    case 'check-tests':
      await runNode('scripts/sync-unicode-test-data.mjs', ['--check', ...rest]);
      return;
    default:
      throw new Error(`Unknown unicode command: ${command}`);
  }
}

if (isMainModule(import.meta.url)) {
  runUnicode(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
