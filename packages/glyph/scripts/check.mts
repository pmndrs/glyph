import { isMainModule, runNode, runPnpm } from './support/command.mts';
import { runGlyphTest } from './test.mts';

export async function runGlyphCheck(): Promise<void> {
  await runGlyphTest();
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.slug-tsl.json', '--noEmit']);
  // Emitted public declarations must survive strict consumers: stripInternal can orphan a
  // symbol that source-level checks never see.
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.dist-declarations.json']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  await runPnpm(['exec', 'oxfmt', '--check', '.']);
}

if (isMainModule(import.meta.url)) {
  runGlyphCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
