import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Where a crate's build writes. By default the crate's own `rust/<crate>/target`. A caller that sets
 * `CARGO_TARGET_DIR` (an agent keeping builds out of the checkout) gets `<CARGO_TARGET_DIR>/pmndrs-glyph/<crate>`
 * instead, so one shared directory still keeps each crate's feature and flag combinations apart.
 */
export function rustTargetDirectory(crate, subdirectory = '', environment = process.env) {
  const shared = environment.CARGO_TARGET_DIR;
  const root =
    shared === undefined || shared === ''
      ? join(packageRoot, 'rust', crate, 'target')
      : join(isAbsolute(shared) ? shared : resolve(shared), 'pmndrs-glyph', crate);
  return subdirectory === '' ? root : join(root, subdirectory);
}

/**
 * `environment` building into `targetDirectory`. A directory outside the workspace is remapped like the workspace
 * itself, so generated sources under it leave no machine path in an artifact.
 */
export function withRustTarget(environment, targetDirectory) {
  // The in-tree default sits under the workspace, which is already remapped; leave its flags untouched.
  if (targetDirectory.startsWith(packageRoot)) return { ...environment, CARGO_TARGET_DIR: targetDirectory };
  const remap = `--remap-path-prefix=${targetDirectory}=/target`;
  const flags = environment.CARGO_ENCODED_RUSTFLAGS;
  return {
    ...environment,
    CARGO_TARGET_DIR: targetDirectory,
    CARGO_ENCODED_RUSTFLAGS: flags === undefined || flags === '' ? remap : `${flags}\u001f${remap}`,
  };
}
