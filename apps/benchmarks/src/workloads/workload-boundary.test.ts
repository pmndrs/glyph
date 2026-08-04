import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workloadDirectory = fileURLToPath(new URL('.', import.meta.url));
const rendererDependencyPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)*)['"](?:\.\.\/)+renderer\/([^'"]+)['"]/g;
const allowedRendererDependencies = new Set([
  'canvas-surface',
  'live-frame-telemetry',
  'persistent-render-host',
  'persistent-scene-activation',
  'retained-font-fixture',
  'text-update-telemetry',
  'webgpu-renderer',
]);

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

function rendererDependencies(source: string): readonly string[] {
  return [...source.matchAll(rendererDependencyPattern)].map((match) => match[1]!);
}

describe('workload source boundaries', () => {
  it('recognizes direct, nested, and dynamic renderer imports', () => {
    const renderer = 'renderer/bitmap-text';
    expect(rendererDependencies(`import { text } from '../${renderer}';`)).toEqual(['bitmap-text']);
    expect(rendererDependencies(`import { text } from '../../${renderer}';`)).toEqual(['bitmap-text']);
    expect(rendererDependencies(`await import('../${renderer}');`)).toEqual(['bitmap-text']);
    expect(rendererDependencies(`import(/* eager */ '../../${renderer}');`)).toEqual(['bitmap-text']);
  });

  it('depends only on generic renderer host and scene primitives', async () => {
    const files = await sourceFiles(workloadDirectory);
    const offenders = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        const unsupported = rendererDependencies(source).filter(
          (dependency) => !allowedRendererDependencies.has(dependency),
        );
        return unsupported.length === 0
          ? undefined
          : `${file.slice(workloadDirectory.length + 1)}: ${unsupported.join(', ')}`;
      }),
    );

    expect(offenders.filter((file): file is string => file !== undefined)).toEqual([]);
  });

  it('keeps the retained comparison scene local and the standalone adapter target-owned', async () => {
    const source = await readFile(new URL('./comparison/scene.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('createComparisonWorkloadPreview');
    expect(source).not.toContain('createConfiguredRenderer');
    expect(source).not.toContain('setAnimationLoop');
    expect(source).not.toContain('createGpuFrameTimer');
  });
});
