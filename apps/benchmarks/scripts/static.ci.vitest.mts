import { describe, expect, test } from 'vitest';

import { run } from './support/command-cli.mts';

const timeout = 5 * 60 * 1_000;

describe.sequential('static repository gates', () => {
  gate('repository formatting', () =>
    pnpm([
      'exec',
      'oxfmt',
      '--check',
      '.claude/hooks',
      '.claude/settings.json',
      '.claude/tsconfig.json',
      'package.json',
      'docs/log.md',
    ]),
  );
  gate('core formatting', () => pnpmAt('../../packages/glyph', ['exec', 'oxfmt', '--check', '.']));
  gate('glyph example formatting', () =>
    pnpmAt('../../packages/glyph-example-raster', [
      'exec',
      'oxfmt',
      '--check',
      'package.json',
      'src',
      'tests',
      'tsconfig.json',
      'tsconfig.build.json',
    ]),
  );
  gate('benchmark formatting', () => runPnpm(['exec', 'oxfmt', '--check', '.']));
  gate('React Three Fiber example formatting', () => pnpmAt('../r3f-hello-world', ['exec', 'oxfmt', '--check', '.']));
  gate('core lint', () => pnpm(['--filter', '@pmndrs/glyph', 'exec', 'oxlint', '--deny-warnings', '.']));
  gate('glyph example lint', () =>
    pnpm(['--filter', '@pmndrs/glyph-example-raster', 'exec', 'oxlint', '--deny-warnings', '.']),
  );
  gate('benchmark lint', () => runPnpm(['exec', 'oxlint', '--deny-warnings', '.']));
  gate('React Three Fiber example lint', () =>
    pnpm(['--filter', '@pmndrs/glyph-r3f-hello-world', 'exec', 'oxlint', '--deny-warnings', '.']),
  );
  gate('repository tooling types', () => pnpm(['exec', 'tsc', '-p', '.claude/tsconfig.json']));
  gate('repository tooling synchronization', () =>
    run(process.execPath, ['../../.claude/hooks/sync-agent-config.test.ts']),
  );
  gate('knowledge base', () =>
    run('ruby', [
      '../../.agents/skills/open-knowledge-format/scripts/validate_okf.rb',
      '../../docs',
      '--workspace-root',
      '../..',
    ]),
  );
});

function gate(name: string, command: () => Promise<void>): void {
  // oxlint-disable-next-line vitest/valid-title -- the wrapper preserves the literal title supplied at each call site.
  test(name, { timeout }, async () => {
    await expect(command()).resolves.toBeUndefined();
  });
}

function pnpm(arguments_: readonly string[]): Promise<void> {
  return pnpmAt('../..', arguments_);
}

function pnpmAt(directory: string, arguments_: readonly string[]): Promise<void> {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', directory, ...arguments_]);
}

function runPnpm(arguments_: readonly string[]): Promise<void> {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', arguments_);
}
