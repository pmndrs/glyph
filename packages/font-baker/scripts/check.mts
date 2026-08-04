import { isMainModule, runNode } from './support/command.mts';
import { runFontBakerTest } from './test.mts';

export async function runFontBakerCheck(): Promise<void> {
  await runFontBakerTest();
  await runNode('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit']);
}

if (isMainModule(import.meta.url)) {
  runFontBakerCheck().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
