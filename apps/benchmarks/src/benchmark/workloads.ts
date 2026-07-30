import type { HarnessMode, RasterTechnique } from './url-state';

export interface WorkloadOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly techniques: Readonly<Record<RasterTechnique, WorkloadTechniqueStatus>>;
}

export interface WorkloadScrollEdges {
  readonly before: boolean;
  readonly after: boolean;
}

type WorkloadTechniqueStatus = { readonly kind: 'ready' } | { readonly kind: 'planned'; readonly milestone: 8 | 9 };

const READY: WorkloadTechniqueStatus = { kind: 'ready' };

const benchmarkWorkloads: readonly WorkloadOption[] = [
  {
    id: 'benchmark-ipsum',
    label: 'Benchmark ipsum',
    description: 'Tests the everyday cost of rendering and reflowing a full paragraph.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'advanced-shaping',
    label: 'Advanced shaping',
    description: 'Tests whether complex text stays correct as it types and wraps.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'text-ladder',
    label: 'Text ladder',
    description: 'Tests how text quality holds up from 8 to 1024 pixels.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'zoom-text',
    label: 'Zoom text',
    description: 'Cycles through translations of “Shape” while scaling from 8 pt to the largest size that fits.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'icon-grid',
    label: 'Icon grid',
    description: 'Tests a labeled icon font across scale, movement, and raster techniques.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'off-axis-3d',
    label: 'Off-axis / 3D',
    description: 'Tests text quality and cost at steep, moving viewing angles.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'dynamic-layout',
    label: 'Dynamic layout',
    description: 'Tests whether animated containers reflow text smoothly and correctly.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'paragraph-stress',
    label: 'Paragraph stress',
    description: 'Tests rendering cost as paragraphs, glyphs, and atlas pressure grow.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'paint-effects',
    label: 'Paint & effects',
    description: 'Tests the live cost and visual quality of animated text effects.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
];

const conformanceWorkloads: readonly WorkloadOption[] = [
  {
    id: 'mtsdf-slug-compare',
    label: 'MSDF / Slug compare',
    description: 'Renders MSDF and Slug side by side and compares their coverage in a live GPU heatmap.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'runtime-fallback',
    label: 'Runtime fallback parity',
    description: 'Tests whether source-font runtime baking reproduces the checked-in baked render.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'text-accuracy',
    label: 'Pipeline accuracy',
    description: 'Technique-specific renderer output, sampling reference, difference, and error statistics.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
  {
    id: 'cross-technique-fidelity',
    label: 'Cross-technique fidelity',
    description: 'Bitmap, MSDF, and Slug compared independently with the same outline-derived coverage reference.',
    techniques: { bitmap: READY, mtsdf: READY, slug: READY },
  },
];

export function workloadScrollEdges({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
}): WorkloadScrollEdges {
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  return {
    before: scrollTop > 0.5,
    after: scrollTop < maximumScrollTop - 0.5,
  };
}

export function workloadsFor(mode: HarnessMode): readonly WorkloadOption[] {
  return mode === 'benchmark' ? benchmarkWorkloads : conformanceWorkloads;
}

export function workloadById(mode: HarnessMode, id: string): WorkloadOption {
  const workloads = workloadsFor(mode);
  return workloads.find((workload) => workload.id === id) ?? workloads[0]!;
}
