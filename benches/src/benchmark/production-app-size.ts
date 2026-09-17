import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export interface ProductionJavaScriptMeasurement {
  readonly id: string;
  readonly label: string;
  readonly status: 'measured';
  readonly format: 'javascript';
  readonly sha256: string;
  readonly rawBytes: number;
  readonly minifiedBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

export async function measureR3fHelloWorldProductionBundle(
  workspace = process.cwd(),
): Promise<ProductionJavaScriptMeasurement> {
  return measureProductionJavaScriptBundle(
    'r3f-hello-world-production-js',
    'R3F hello-world app JS',
    join(workspace, 'apps/r3f-hello-world/dist'),
  );
}

async function measureProductionJavaScriptBundle(
  id: string,
  label: string,
  directory: string,
): Promise<ProductionJavaScriptMeasurement> {
  const files = (await findJavaScriptFiles(directory)).sort();
  if (files.length === 0) {
    throw new Error(`Production JavaScript measurement found no emitted chunks under ${directory}`);
  }

  const hash = createHash('sha256');
  let bytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  for (const file of files) {
    const source = await readFile(file);
    const name = relative(directory, file);
    hash.update(name).update('\0').update(source).update('\0');
    bytes += source.byteLength;
    gzipBytes += gzipSync(source, { level: 9 }).byteLength;
    brotliBytes += brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength;
  }

  return {
    id,
    label,
    status: 'measured',
    format: 'javascript',
    sha256: hash.digest('hex'),
    // These are production chunks, so their emitted and minified sizes are the same.
    rawBytes: bytes,
    minifiedBytes: bytes,
    gzipBytes,
    brotliBytes,
  };
}

async function findJavaScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findJavaScriptFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
  }
  return files;
}
