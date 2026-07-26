import { homedir } from 'node:os'
import { join } from 'node:path'

const encodedFlagSeparator = '\u001f'

export function reproducibleRustEnvironment(workspaceRoot, environment = process.env) {
  const cargoHome = environment.CARGO_HOME ?? join(homedir(), '.cargo')
  const { CARGO_ENCODED_RUSTFLAGS: _encodedFlags, RUSTFLAGS: _rustFlags, ...inherited } =
    environment
  return {
    ...inherited,
    CARGO_ENCODED_RUSTFLAGS: [
      `--remap-path-prefix=${workspaceRoot}=/workspace`,
      `--remap-path-prefix=${cargoHome}=/cargo`,
    ].join(encodedFlagSeparator),
  }
}
