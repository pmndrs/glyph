import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegisteredTarget } from './targets';
import { createConformanceTargets } from './targets/conformance';
import { createProductTargets } from './targets/product';
import { registeredTargetIds } from './targets/registry';

const benchmarkDirectory = fileURLToPath(new URL('.', import.meta.url));
const rendererDirectory = fileURLToPath(new URL('../renderer', import.meta.url));
const directWasmDependencyModule = 'targets/shared/direct-wasm.ts';

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

describe('benchmark target boundaries', () => {
  it('keeps direct font-baker and Wasm URL imports in the shared selected-ABI adapter', async () => {
    const files = await sourceFiles(benchmarkDirectory);
    const offenders = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        return /@pmndrs\/text-font-baker(?:\/font-baker\.wasm\?url)?|@pmndrs\/text\/text-shaper\.wasm\?url/.test(source)
          ? file.slice(benchmarkDirectory.length + 1)
          : undefined;
      }),
    );
    expect(offenders.filter((file): file is string => file !== undefined)).toEqual([directWasmDependencyModule]);
  });

  it('keeps low-level targets downstream from renderer infrastructure', async () => {
    const files = await sourceFiles(rendererDirectory);
    const offenders = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        return /benchmark\/targets/.test(source) ? file.slice(rendererDirectory.length + 1) : undefined;
      }),
    );
    expect(offenders.filter((file): file is string => file !== undefined)).toEqual([]);
  });

  it('resolves targets through the lazy group registry without importing the monolithic implementation facade', async () => {
    const registry = await readFile(new URL('./targets/registry.ts', import.meta.url), 'utf8');
    const execution = await readFile(new URL('./execution.ts', import.meta.url), 'utf8');
    const conformance = await readFile(new URL('./targets/conformance/index.ts', import.meta.url), 'utf8');
    const product = await readFile(new URL('./targets/product/index.ts', import.meta.url), 'utf8');
    const mtsdfAdapter = await readFile(new URL('./targets/conformance/raster/mtsdf.ts', import.meta.url), 'utf8');
    const slugAdapter = await readFile(new URL('./targets/conformance/raster/slug.ts', import.meta.url), 'utf8');

    expect(registry).toContain("import('./product')");
    expect(registry).toContain("import('./measurement/font-baker')");
    expect(registry).toContain("import('./conformance')");
    expect(execution).toContain('await loadRegisteredTarget(request.targetId)');
    expect(conformance).toContain("import('./advanced-shaping')");
    expect(conformance).toContain("import('./raster/runtime-fallback')");
    expect(conformance).not.toContain('renderer/advanced-shaping-conformance');
    expect(conformance).not.toContain('renderer/runtime-fallback-conformance');
    expect(product).toContain("import('./external-raster-proof')");
    expect(product).toContain("import('./react-text')");
    expect(product).not.toContain('renderer/external-raster-proof');
    expect(product).not.toContain('renderer/react-text');
    expect(mtsdfAdapter).toContain("import('../../../../renderer/mtsdf-text')");
    expect(slugAdapter).toContain("import('../../../../renderer/slug-text')");
    const { createAdvancedShapingConformanceTarget } = await import('./targets/conformance/advanced-shaping');
    expect(createAdvancedShapingConformanceTarget().id).toBe('advanced-shaping-conformance');
    expect(await loadRegisteredTarget('missing')).toBeUndefined();
  });

  it('classifies public Worker fallback parity as conformance rather than a rendering product target', () => {
    expect(createProductTargets().some(({ id }) => id === 'font-loader-worker')).toBe(false);
    expect(createConformanceTargets().some(({ id }) => id === 'font-loader-worker')).toBe(true);
  });

  it('resolves every registered identity from its declared target group', async () => {
    const resolved = await Promise.all(registeredTargetIds.map((targetId) => loadRegisteredTarget(targetId)));
    expect(resolved.map((target) => target?.id)).toEqual(registeredTargetIds);
  });
});
