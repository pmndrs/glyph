import { isAbsolute, relative, sep } from 'node:path';

import { reproducibleRustEnvironment } from './reproducible-rust-env.mjs';

// The shipped module's panic handler discards its message and traps, so every byte that formats
// one is unobservable. `-Cpanic=immediate-abort` makes each panic site trap in place, and
// `-Zbuild-std` rebuilds `core` and `alloc` the same way; together they remove the formatting
// code, the message strings and the source locations. Both are unstable, so this one Cargo
// invocation runs the repository-pinned compiler with `RUSTC_BOOTSTRAP=1` instead of switching
// to a nightly toolchain: the artifact is then built by the same rustc that runs the native
// tests, and `rust-toolchain.toml` supplies the `rust-src` component `-Zbuild-std` needs.
const immediateAbortRustFlags = ['-Zunstable-options', '-Cpanic=immediate-abort'];
const rebuiltStandardLibrary = '-Zbuild-std=core,alloc';

export function shaperBuildEnvironment(workspaceRoot, targetDirectory, simd) {
  const environment = reproducibleRustEnvironment(workspaceRoot);
  return {
    ...environment,
    CARGO_TARGET_DIR: targetDirectory,
    RUSTC_BOOTSTRAP: '1',
    CARGO_ENCODED_RUSTFLAGS: [
      environment.CARGO_ENCODED_RUSTFLAGS,
      '-C',
      `target-feature=${simd ? '+simd128' : '-simd128'}`,
      ...immediateAbortRustFlags,
    ].join('\u001f'),
  };
}

export function shaperCargoArguments(simd) {
  return [
    'build',
    '--manifest-path',
    'rust/shaper/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    rebuiltStandardLibrary,
    '--no-default-features',
    ...(simd ? ['--features', 'simd128'] : []),
  ];
}

export function shaperOptimizationArguments(simd) {
  return [
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    ...(simd ? ['--enable-simd'] : []),
    '--one-caller-inline-max-function-size=0',
    '--merge-similar-functions',
    '-Oz',
    '--merge-similar-functions',
    '-Oz',
  ];
}

export function assertDiagnosticOutputOutsideDist(distributionDirectory, output) {
  const path = relative(distributionDirectory, output);
  if (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) {
    throw new Error('--output must be outside the shipped dist directory');
  }
}
