import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('conformance surface boundaries', () => {
  it('keeps route composition separate from retained and finite renderer ownership', async () => {
    const [app, surface, comparisonSurface, finiteCapture, finiteSurface] = await Promise.all([
      readFile(new URL('../../app.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./conformance-surface.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./raster-technique-comparison-surface.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./capture.ts', import.meta.url), 'utf8'),
      readFile(new URL('./finite-conformance-surface.tsx', import.meta.url), 'utf8'),
    ]);

    expect(app).toContain("from './surfaces/conformance/conformance-surface'");
    expect(app).not.toContain('function ConformanceSurface(');
    expect(app).not.toContain('function captureFiniteConformance(');
    expect(surface).toContain('<RasterTechniqueComparisonSurface');
    expect(surface).toContain('<FiniteConformanceSurface');
    expect(comparisonSurface).toContain("import('./scenes/raster-technique-comparison')");
    expect(comparisonSurface).not.toContain('benchmark/targets/conformance/raster/comparison-scene');
    expect(finiteCapture).toContain('renderer: PersistentRenderSceneRenderer');
    expect(finiteCapture).toContain('signal: AbortSignal');
    expect(finiteSurface).toContain('runExclusiveCapture(');
    expect(finiteSurface).toContain(
      'captureFiniteConformance({ backend, dpr, fontFixture, renderer, signal, technique, workload })',
    );
  });
});
