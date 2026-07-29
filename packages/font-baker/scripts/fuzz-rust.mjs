import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';

const fuzzDirectory = new URL('../fuzz/', import.meta.url);
const arguments_ = process.argv.slice(2);
while (arguments_[0] === '--') arguments_.shift();
const target = ['bake_font', 'mtsdf_outline'].includes(arguments_[0]) ? arguments_.shift() : 'bake_font';
while (arguments_[0] === '--') arguments_.shift();
const corpusDirectory = new URL(`target/corpus/${target}/`, fuzzDirectory);
await mkdir(new URL(`target/artifacts/${target}/`, fuzzDirectory), { recursive: true });
await mkdir(corpusDirectory, { recursive: true });
if (target === 'bake_font') {
  await copyFile(
    new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', fuzzDirectory),
    new URL('inter-v4.1-40d692fc.ttf', corpusDirectory),
  );
} else {
  await writeFile(new URL('crossing-contour.bin', corpusDirectory), crossingContourSeed());
}
const rustc = spawnSync('mise', ['exec', '--', 'rustc', '--version'], {
  cwd: fuzzDirectory,
  encoding: 'utf8',
});
const expectedRustc = 'rustc 1.98.0-nightly (14210df0e 2026-05-31)';
if (rustc.error?.code === 'ENOENT') {
  throw new Error('The coverage-guided Rust fuzz lane requires mise. Install mise, then rerun.');
}
if (rustc.status !== 0 || rustc.stdout.trim() !== expectedRustc) {
  throw new Error(`Expected ${expectedRustc}, received ${rustc.stdout.trim() || rustc.stderr.trim()}`);
}
const mise = spawnSync('mise', ['exec', '--', 'cargo', 'fuzz', '--version'], {
  cwd: fuzzDirectory,
  encoding: 'utf8',
});
if (mise.status !== 0) {
  throw new Error('mise could not provision the pinned Rust fuzz toolchain', {
    cause: mise.error ?? mise.stderr.trim(),
  });
}
if (mise.stdout.trim() !== 'cargo-fuzz 0.13.2') {
  throw new Error(`Expected cargo-fuzz 0.13.2, received ${mise.stdout.trim()}`);
}

const result = spawnSync(
  'mise',
  [
    'exec',
    '--',
    'cargo',
    'fuzz',
    'run',
    target,
    '--fuzz-dir',
    '.',
    `target/corpus/${target}`,
    '--',
    '-seed=1347243588',
    `-artifact_prefix=target/artifacts/${target}/`,
    ...(arguments_.length === 0 ? [`-max_len=${target === 'bake_font' ? 1_048_576 : 1_666}`] : arguments_),
  ],
  { cwd: fuzzDirectory, stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

function crossingContourSeed() {
  const points = [
    [100, 100],
    [900, 900],
    [100, 900],
    [900, 100],
  ];
  const bytes = [16, 16];
  for (const [index, [x, y]] of points.entries()) {
    const command = new Uint8Array(13);
    command[0] = index === 0 ? 0 : 1;
    new DataView(command.buffer).setInt16(1, x, true);
    new DataView(command.buffer).setInt16(3, y, true);
    bytes.push(...command);
  }
  const close = new Uint8Array(13);
  close[0] = 4;
  bytes.push(...close);
  return Uint8Array.from(bytes);
}
