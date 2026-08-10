import { buildRuntimePackages, isMainModule, run, runNodeScript } from './support/command-cli.mts';

export async function runBenchmarkTest(options: { readonly runtimePackagesReady?: boolean } = {}): Promise<void> {
  if (!options.runtimePackagesReady) await buildRuntimePackages();
  await runNodeScript('scripts/measure-package-sizes.mts', ['--check']);
  await runNodeScript('scripts/check-paragraph-contract-fixtures.mts');
  await runNodeScript('scripts/generate-paragraph-bidi-contract.mts', ['--check']);
  await runNodeScript('scripts/generate-paragraph-cjk-contract.mts', ['--check']);
  await runNodeScript('node_modules/vitest/vitest.mjs', ['run']);
  await run(process.execPath, ['--test', 'scripts/workflows.test.mts']);
  await runNodeScript('scripts/run-headless.mts', [
    '--suite',
    'conformance',
    '--dpr',
    '1',
    '--samples',
    '3',
    '--warmup',
    '1',
    '--port',
    '5181',
  ]);
  await runNodeScript('scripts/run-packed-consumer.mts');
}

if (isMainModule(import.meta.url)) {
  runBenchmarkTest().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
