import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workloadDirectory = fileURLToPath(new URL('.', import.meta.url));
const rendererDependencyPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*)['"](?:\.\.\/)+renderer(?:\/|['"])/;

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    }),
  );
  return nested.flat();
}

describe('workload source boundaries', () => {
  it('recognizes direct, nested, and dynamic renderer imports', () => {
    const renderer = 'renderer/text';
    expect(rendererDependencyPattern.test(`import { text } from '../${renderer}';`)).toBe(true);
    expect(rendererDependencyPattern.test(`import { text } from '../../${renderer}';`)).toBe(true);
    expect(rendererDependencyPattern.test(`await import('../${renderer}');`)).toBe(true);
    expect(rendererDependencyPattern.test(`import(/* eager */ '../../${renderer}');`)).toBe(true);
  });

  it('does not depend on renderer implementation modules', async () => {
    const files = await sourceFiles(workloadDirectory);
    const offenders = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        return rendererDependencyPattern.test(source) ? file.slice(workloadDirectory.length + 1) : undefined;
      }),
    );

    expect(offenders.filter((file): file is string => file !== undefined)).toEqual([]);
  });
});
