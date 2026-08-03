import type { BenchmarkTarget } from '../contracts';

type TargetGroup = 'product' | 'measurement' | 'conformance';

const targetGroups: Readonly<Record<string, TargetGroup>> = {
  synthetic: 'product',
  'font-loader-worker': 'product',
  'external-raster-proof-webgl2': 'product',
  'external-raster-proof-webgpu': 'product',
  'bitmap-text-webgl2': 'product',
  'bitmap-text-webgpu': 'product',
  'mtsdf-text-webgl2': 'product',
  'mtsdf-text-webgpu': 'product',
  'slug-text-webgl2': 'product',
  'slug-text-webgpu': 'product',
  'react-text-reconciliation': 'product',
  'font-baker': 'measurement',
  'harfrust-shaper': 'conformance',
  'paragraph-engine': 'conformance',
  'paragraph-layout-engine': 'conformance',
  'paragraph-bidi-policy': 'conformance',
  'cjk-universality': 'conformance',
  'tsl-webgl2-baseline': 'conformance',
  'tsl-webgpu-baseline': 'conformance',
  'advanced-shaping-conformance': 'conformance',
  'mtsdf-conformance-webgl2': 'conformance',
  'mtsdf-conformance-webgpu': 'conformance',
  'slug-conformance-webgl2': 'conformance',
  'slug-conformance-webgpu': 'conformance',
  'source-outline-bitmap-webgl2': 'conformance',
  'source-outline-bitmap-webgpu': 'conformance',
  'source-outline-mtsdf-webgl2': 'conformance',
  'source-outline-mtsdf-webgpu': 'conformance',
  'source-outline-slug-webgl2': 'conformance',
  'source-outline-slug-webgpu': 'conformance',
  'runtime-fallback-bitmap-webgl2': 'conformance',
  'runtime-fallback-bitmap-webgpu': 'conformance',
  'runtime-fallback-mtsdf-webgl2': 'conformance',
  'runtime-fallback-mtsdf-webgpu': 'conformance',
  'runtime-fallback-slug-webgl2': 'conformance',
  'runtime-fallback-slug-webgpu': 'conformance',
};

async function loadTargetGroup(group: TargetGroup): Promise<readonly BenchmarkTarget[]> {
  switch (group) {
    case 'product':
      return (await import('./product')).createProductTargets();
    case 'measurement':
      return (await import('./measurement/font-baker')).createFontBakerMeasurementTargets();
    case 'conformance':
      return (await import('./conformance')).createConformanceTargets();
  }
}

export const registeredTargetIds = Object.keys(targetGroups);

export async function loadRegisteredTarget(targetId: string): Promise<BenchmarkTarget | undefined> {
  const group = targetGroups[targetId];
  if (group === undefined) return undefined;
  return (await loadTargetGroup(group)).find((target) => target.id === targetId);
}
