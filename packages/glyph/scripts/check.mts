import { isMainModule, runNode, runPnpm } from './support/command.mts';
import { runGlyphTest } from './test.mts';

export async function runGlyphCheck(): Promise<void> {
  await runGlyphTest();
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.slug-tsl.json', '--noEmit']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  await runPnpm(['exec', 'oxfmt', '--check', '.']);
}

if (isMainModule(import.meta.url)) {
  runGlyphCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
