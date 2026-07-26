import assert from 'node:assert/strict'
import test from 'node:test'

import { reproducibleRustEnvironment } from '../../scripts/reproducible-rust-env.mjs'

test('canonical Rust builds replace host paths and ambient flags', () => {
  const environment = reproducibleRustEnvironment('/checkout/text', {
    CARGO_HOME: '/home/runner/.cargo',
    CARGO_ENCODED_RUSTFLAGS: '--ambient-encoded-flag',
    RUSTFLAGS: '--ambient-rust-flag',
    RUSTUP_TOOLCHAIN: '1.97.1',
  })

  assert.deepEqual(environment, {
    CARGO_HOME: '/home/runner/.cargo',
    CARGO_ENCODED_RUSTFLAGS:
      '--remap-path-prefix=/checkout/text=/workspace\u001f--remap-path-prefix=/home/runner/.cargo=/cargo',
    RUSTUP_TOOLCHAIN: '1.97.1',
  })
})
