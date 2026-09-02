import { describe, expect, test } from 'vitest';

import { run, runNodeScript } from './support/command-cli.mts';

const timeout = 20 * 60 * 1_000;

describe.sequential('runtime repository gates', () => {
  gate('core package', () => pnpm(['--filter', '@pmndrs/glyph', 'check']));
  gate('glyph example package', () => pnpm(['--filter', '@pmndrs/glyph-example-raster', 'check']));
  gate('example renderer package', () => pnpm(['--filter', '@pmndrs/glyph-example-renderer', 'check']));
  gate('benchmark application types', () => runPnpm(['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit']));
  gate('benchmark scripts types', () => runPnpm(['exec', 'tsc', '-p', 'tsconfig.scripts.json', '--noEmit']));
  gate('package-size contract', () => runNodeScript('scripts/measure-package-sizes.mts', ['--check']));
  gate('paragraph fixture references', () => runNodeScript('scripts/check-paragraph-contract-fixtures.mts'));
  gate('bidi contract', () => runNodeScript('scripts/generate-paragraph-bidi-contract.mts', ['--check']));
  gate('CJK contract', () => runNodeScript('scripts/generate-paragraph-cjk-contract.mts', ['--check']));
  gate('benchmark unit tests', () =>
    runPnpm([
      'exec',
      'vitest',
      'run',
      '--exclude',
      'scripts/static.ci.vitest.mts',
      '--exclude',
      'scripts/runtime.ci.vitest.mts',
    ]),
  );
  gate('workflow registry', () => run(process.execPath, ['--test', 'scripts/workflows.test.mts']));
  gate('browser conformance', () =>
    runNodeScript('scripts/run-headless.mts', [
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
    ]),
  );
  gate('packed consumer', () => runNodeScript('scripts/run-packed-consumer.mts'));
  gate('benchmark build', () => runNodeScript('scripts/build.mts'));
  gate('Three and React Three Fiber examples', () => pnpm(['--filter', '@pmndrs/glyph-examples', 'check']));
  gate('Japanese showcase fixture', () => pnpm(['scripts', 'run', 'fixture:japanese-showcase:check']));
});

function gate(name: string, command: () => Promise<void>): void {
  // oxlint-disable-next-line vitest/valid-title -- the wrapper preserves the literal title supplied at each call site.
  test(name, { timeout }, async () => {
    await expect(command()).resolves.toBeUndefined();
  });
}

function pnpm(arguments_: readonly string[]): Promise<void> {
  return runPnpm(['--dir', '../..', ...arguments_]);
}

function runPnpm(arguments_: readonly string[]): Promise<void> {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', arguments_);
}
