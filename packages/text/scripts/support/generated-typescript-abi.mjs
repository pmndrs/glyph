import { mkdir, readFile, writeFile } from 'node:fs/promises';

export async function writeGeneratedTypescriptAbi(target, exportName, jsonBytes, options = {}) {
  const contract = JSON.parse(jsonBytes.toString('utf8'));
  const source = [
    '// Generated from Rust compiler layout facts. Do not edit.',
    `export const ${exportName} = ${JSON.stringify(contract, null, 2)} as const`,
    '',
    `export type ${upperFirst(exportName)} = typeof ${exportName}`,
    '',
  ].join('\n');
  if (options.check === true) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== source) {
      throw new Error(`${target.pathname} is stale; run the package build and commit the result`);
    }
    return;
  }
  await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, source);
}

function upperFirst(value) {
  return value[0].toUpperCase() + value.slice(1);
}
