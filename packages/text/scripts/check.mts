import { isMainModule, runNode, runPnpm } from './support/command.mts';
import { runTextTest } from './test.mts';

export async function runTextCheck(): Promise<void> {
  await runTextTest();
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.slug-tsl.json', '--noEmit']);
  await runPnpm(['exec', 'oxlint', '--deny-warnings', '.']);
  await runPnpm(['exec', 'oxfmt', '--check', '.']);
}

if (isMainModule(import.meta.url)) {
  runTextCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
