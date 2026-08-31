import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { NodeBakeError } from './node-bake-error.js';

export interface NodeFileOutput {
  readonly bytes: Uint8Array;
  readonly file: string;
}

interface StagedFileOutput {
  readonly temporaryFile: string;
  readonly target: string;
  backupFile?: string;
  published: boolean;
}

export async function assertDistinctInputOutputs(input: string, outputs: readonly string[]): Promise<void> {
  const inputIdentity = await stat(input);
  const targets = new Set<string>();
  for (const output of outputs) {
    const canonical = resolve(output);
    if (targets.has(canonical)) {
      throw new NodeBakeError('OUTPUT_CONFLICT', 'multiple artifacts resolve to one output', canonical);
    }
    targets.add(canonical);
    if (resolve(input) === canonical) {
      throw new NodeBakeError('OUTPUT_OVERLAPS_INPUT', 'output must not overwrite its source', output);
    }
    let outputIdentity;
    try {
      outputIdentity = await stat(output);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (inputIdentity.dev === outputIdentity.dev && inputIdentity.ino === outputIdentity.ino) {
      throw new NodeBakeError('OUTPUT_OVERLAPS_INPUT', 'output must not alias its source', output);
    }
    if (!outputIdentity.isFile()) {
      throw new NodeBakeError('OUTPUT_TARGET_TYPE', 'existing artifact output must be a regular file', output);
    }
  }
}

export async function publishFilesWithRollback(
  outputs: readonly NodeFileOutput[],
  signal?: AbortSignal,
): Promise<void> {
  const staged: StagedFileOutput[] = [];
  let publicationCompleted = false;
  let rollbackCompleted = false;
  try {
    for (const { bytes, file } of outputs) {
      signal?.throwIfAborted();
      await mkdir(dirname(file), { recursive: true });
      const temporaryFile = join(dirname(file), `.${file.split(sep).at(-1)}.${randomUUID()}.tmp`);
      staged.push({ temporaryFile, target: file, published: false });
      const handle = await open(temporaryFile, 'wx');
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    signal?.throwIfAborted();
    for (const entry of staged) await preservePreviousTarget(entry);
    for (const entry of staged) {
      await rename(entry.temporaryFile, entry.target);
      entry.published = true;
    }
    publicationCompleted = true;
  } catch (error) {
    try {
      await rollbackPublication(staged);
      rollbackCompleted = true;
    } catch (rollbackError) {
      throw new Error(
        `artifact publication failed (${error instanceof Error ? error.message : String(error)}) ` +
          `and rollback was incomplete: ${
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }`,
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    await Promise.all(
      staged.flatMap(({ temporaryFile, backupFile }) => [
        rm(temporaryFile, { force: true }),
        ...(backupFile === undefined || (!publicationCompleted && !rollbackCompleted)
          ? []
          : [rm(backupFile, { force: true })]),
      ]),
    );
  }
}

async function preservePreviousTarget(entry: StagedFileOutput): Promise<void> {
  try {
    const previous = await lstat(entry.target);
    if (!previous.isFile()) {
      throw new NodeBakeError('OUTPUT_TARGET_TYPE', 'existing artifact output must be a regular file', entry.target);
    }
    const backupFile = join(dirname(entry.target), `.${entry.target.split(sep).at(-1)}.${randomUUID()}.bak`);
    await rename(entry.target, backupFile);
    entry.backupFile = backupFile;
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function rollbackPublication(staged: readonly StagedFileOutput[]): Promise<void> {
  const failures: unknown[] = [];
  for (const entry of [...staged].reverse()) {
    try {
      if (entry.published) await rm(entry.target, { force: true });
      if (entry.backupFile !== undefined) {
        await rename(entry.backupFile, entry.target);
        delete entry.backupFile;
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, 'failed to restore pre-existing artifact outputs');
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
