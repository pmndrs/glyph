import assert from 'node:assert/strict';
import test from 'node:test';

import { reproducibleRustEnvironment, standardLibrarySource } from '../../../scripts/support/reproducible-rust-env.mjs';

test('the pinned toolchain names its standard-library source and commit', () => {
  const source = standardLibrarySource(new URL('../../../', import.meta.url).pathname);
  assert.match(source.directory, /lib[\\/]rustlib[\\/]src[\\/]rust$/);
  assert.match(source.commit, /^[0-9a-f]{40}$/);
});

test('canonical Rust builds replace host paths and ambient flags', () => {
  const environment = reproducibleRustEnvironment(
    '/checkout/text',
    {
      CARGO_HOME: '/home/runner/.cargo',
      CARGO_ENCODED_RUSTFLAGS: '--ambient-encoded-flag',
      RUSTFLAGS: '--ambient-rust-flag',
      RUSTUP_TOOLCHAIN: '1.97.1',
    },
    { directory: '/home/runner/.rustup/toolchains/pinned/lib/rustlib/src/rust', commit: 'c0ffee' },
  );

  assert.deepEqual(environment, {
    CARGO_HOME: '/home/runner/.cargo',
    CARGO_ENCODED_RUSTFLAGS:
      '--remap-path-prefix=/checkout/text=/workspace\u001f--remap-path-prefix=/home/runner/.cargo=/cargo\u001f--remap-path-prefix=/home/runner/.rustup/toolchains/pinned/lib/rustlib/src/rust=/rustc/c0ffee',
    RUSTUP_TOOLCHAIN: '1.97.1',
  });
});
