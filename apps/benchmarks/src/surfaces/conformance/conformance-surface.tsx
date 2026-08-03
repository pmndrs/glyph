import { FiniteConformanceSurface } from './finite-conformance-surface';
import { RasterTechniqueComparisonSurface } from './raster-technique-comparison-surface';
import type { ConformanceSurfaceProps } from './types';

/** Routes finite captures and the retained GPU comparison through the same host-owned renderer. */
export function ConformanceSurface({ workload, ...properties }: ConformanceSurfaceProps) {
  return workload === 'mtsdf-slug-compare' ? (
    <RasterTechniqueComparisonSurface
      backend={properties.backend}
      comparisonText={properties.comparisonText}
      conformanceView={properties.conformanceView}
      fontFixture={properties.fontFixture}
      onPan={properties.onPan}
      onZoom={properties.onZoom}
    />
  ) : (
    <FiniteConformanceSurface {...properties} workload={workload} />
  );
}
