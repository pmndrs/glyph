import { isAbsolute, relative, sep } from 'node:path';

import { reproducibleRustEnvironment } from './reproducible-rust-env.mjs';

export function shaperBuildEnvironment(workspaceRoot, targetDirectory, simd) {
  const environment = reproducibleRustEnvironment(workspaceRoot);
  return {
    ...environment,
    CARGO_TARGET_DIR: targetDirectory,
    CARGO_ENCODED_RUSTFLAGS: `${environment.CARGO_ENCODED_RUSTFLAGS}\u001f-C\u001ftarget-feature=${simd ? '+simd128' : '-simd128'}`,
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
    '--no-default-features',
    ...(simd ? ['--features', 'simd128'] : []),
  ];
}

export function shaperOptimizationArguments(simd) {
  return [
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    ...(simd ? ['--enable-simd'] : []),
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
