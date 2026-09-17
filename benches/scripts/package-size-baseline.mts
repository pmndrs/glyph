import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createPackageSizeBaseline, parsePackageSizeBaseline } from '../src/benchmark/package-size-baseline.ts';

const [operation, ...arguments_] = process.argv.slice(2);
const options = new Map(
  arguments_.map((argument) => {
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator === -1) throw new Error(`invalid argument: ${argument}`);
    return [argument.slice(2, separator), argument.slice(separator + 1)];
  }),
);

if (operation === 'create') {
  const report = JSON.parse(await readFile(requiredPath('report'), 'utf8')) as unknown;
  await writeJson(requiredPath('output'), createPackageSizeBaseline(required('commit'), report));
} else if (operation === 'extract') {
  const artifact = JSON.parse(await readFile(requiredPath('artifact'), 'utf8')) as unknown;
  const baseline = parsePackageSizeBaseline(artifact, required('commit'));
  await writeJson(requiredPath('output'), baseline.report);
} else {
  throw new Error('usage: package-size-baseline.mts <create|extract> --commit=<sha> --output=<path>');
}

function required(name: string): string {
  const value = options.get(name);
  if (value === undefined || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

function requiredPath(name: string): string {
  return resolve(required(name));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
