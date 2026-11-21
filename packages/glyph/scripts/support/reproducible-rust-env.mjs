import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const encodedFlagSeparator = '\u001f';

/**
 * Where the toolchain selected for `workspaceRoot` keeps the standard library's source, and the commit rustc names in
 * its place when that source is absent.
 */
export function standardLibrarySource(workspaceRoot, environment = process.env) {
  const rustc = (...arguments_) => {
    const result = spawnSync('rustc', arguments_, { cwd: workspaceRoot, env: environment, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`rustc ${arguments_.join(' ')} failed: ${result.error?.message ?? result.stderr}`);
    }
    return result.stdout;
  };
  const commit = /^commit-hash: ([0-9a-f]{40})$/m.exec(rustc('-vV'))?.[1];
  if (commit === undefined) throw new Error('rustc -vV did not report a commit hash');
  return { directory: join(rustc('--print', 'sysroot').trim(), 'lib', 'rustlib', 'src', 'rust'), commit };
}

export function reproducibleRustEnvironment(
  workspaceRoot,
  environment = process.env,
  standardLibrary = standardLibrarySource(workspaceRoot, environment),
) {
  const cargoHome = environment.CARGO_HOME ?? join(homedir(), '.cargo');
  const { CARGO_ENCODED_RUSTFLAGS: _encodedFlags, RUSTFLAGS: _rustFlags, ...inherited } = environment;
  return {
    ...inherited,
    CARGO_ENCODED_RUSTFLAGS: [
      `--remap-path-prefix=${workspaceRoot}=/workspace`,
      `--remap-path-prefix=${cargoHome}=/cargo`,
      // A toolchain with the `rust-src` component, which the shaper build needs, reports standard-library sources at
      // their path on this machine; one without it reports `/rustc/<commit>`. Mapping the first onto the second keeps
      // every artifact identical on both and keeps the local path out of panic locations.
      `--remap-path-prefix=${standardLibrary.directory}=/rustc/${standardLibrary.commit}`,
    ].join(encodedFlagSeparator),
  };
}
