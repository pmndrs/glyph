/** Where a crate's build writes: `rust/<crate>/target`, or `<CARGO_TARGET_DIR>/pmndrs-glyph/<crate>` when that is set. */
export function rustTargetDirectory(
  crate: string,
  subdirectory?: string,
  environment?: Readonly<Record<string, string | undefined>>,
): string;

/** `environment` building into `targetDirectory`, path-remapped when that is outside the workspace. */
export function withRustTarget<Environment extends Readonly<Record<string, string | undefined>>>(
  environment: Environment,
  targetDirectory: string,
): Environment & { CARGO_TARGET_DIR: string };
