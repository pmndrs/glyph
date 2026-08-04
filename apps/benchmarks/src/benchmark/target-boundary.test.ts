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
    expect(files.map((file) => file.slice(rendererDirectory.length + 1))).not.toContain('tsl-baseline.ts');
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
    const bitmapCapture = await readFile(
      new URL('./targets/conformance/raster/bitmap-capture.ts', import.meta.url),
      'utf8',
    );
    const mtsdfAdapter = await readFile(new URL('./targets/conformance/raster/mtsdf.ts', import.meta.url), 'utf8');
    const slugAdapter = await readFile(new URL('./targets/conformance/raster/slug.ts', import.meta.url), 'utf8');
    const runtimeFallback = await readFile(
      new URL('./targets/conformance/raster/runtime-fallback.ts', import.meta.url),
      'utf8',
    );
    const finiteCaptureSurface = await readFile(new URL('../surfaces/conformance/capture.ts', import.meta.url), 'utf8');
    const slugCaptureProbes = await Promise.all(
      ['slug-adaptive32-quality', 'slug-external-render-parity', 'slug-fixed32-quality', 'slug-role-scenes'].map(
        (name) => readFile(new URL(`../../vitexec/${name}.probe.ts`, import.meta.url), 'utf8'),
      ),
    );

    expect(registry).toContain("import('./product')");
    expect(registry).toContain("import('./measurement/font-baker')");
    expect(registry).toContain("import('./conformance')");
    expect(execution).toContain('await loadRegisteredTarget(request.targetId)');
    expect(conformance).toContain("import('./advanced-shaping')");
    expect(conformance).toContain("import('./tsl-baseline')");
    expect(conformance).toContain("import('./raster/runtime-fallback')");
    expect(conformance).toContain("import('./raster/bitmap-capture')");
    expect(conformance).not.toContain('renderer/advanced-shaping-conformance');
    expect(conformance).not.toContain('renderer/tsl-baseline');
    expect(conformance).not.toContain('renderer/runtime-fallback-conformance');
    expect(conformance).not.toContain('renderer/bitmap-text');
    expect(product).toContain("import('./external-raster-proof')");
    expect(product).toContain("import('./react-text')");
    expect(product).toContain("import('./mtsdf-text')");
    expect(product).toContain("import('./slug-text')");
    expect(product).toContain("import('./bitmap-text')");
    expect(product).not.toContain('renderer/external-raster-proof');
    expect(product).not.toContain('renderer/react-text');
    expect(product).not.toContain('renderer/mtsdf-text');
    expect(product).not.toContain('renderer/slug-text');
    expect(product).not.toContain('renderer/bitmap-text');
    expect(mtsdfAdapter).toContain("import { createMtsdfConformanceSession } from './mtsdf-capture'");
    expect(mtsdfAdapter).not.toContain('renderer/mtsdf-text');
    expect(slugAdapter).toContain("import { createSlugConformanceSession } from './slug-capture'");
    expect(slugAdapter).not.toContain('renderer/slug-text');
    expect(bitmapCapture).toContain('createBitmapFiniteScene');
    expect(bitmapCapture).not.toContain('renderer/bitmap-text');
    expect(runtimeFallback).toContain("from './bitmap-capture'");
    expect(runtimeFallback).not.toContain('renderer/bitmap-text');
    expect(finiteCaptureSurface).toContain("import('../../benchmark/targets/conformance/raster/bitmap-capture')");
    expect(finiteCaptureSurface).not.toContain('renderer/bitmap-text');
    expect(
      slugCaptureProbes.every((probe) => probe.includes('/benchmark/targets/conformance/raster/slug-capture.ts')),
    ).toBe(true);
    expect(slugCaptureProbes.every((probe) => !probe.includes('/renderer/slug-text.ts'))).toBe(true);
    expect(slugCaptureProbes.every((probe) => !probe.includes('/renderer/slug-role-scenes.ts'))).toBe(true);
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
