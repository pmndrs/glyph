import { spawnSync } from 'node:child_process';

const arguments_ = process.argv.slice(2);
if (arguments_[0] === '--') arguments_.shift();
const result = spawnSync(
  'cargo',
  [
    'run',
    '--manifest-path',
    'rust/Cargo.toml',
    '--bin',
    'fuzz-bake',
    '--release',
    '--locked',
    '--no-default-features',
    '--features',
    'fuzzing',
    '--',
    '--source',
    '../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
    ...arguments_,
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
