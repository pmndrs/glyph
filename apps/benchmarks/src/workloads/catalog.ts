import {
  ICON_GRID_FONT_FIXTURE,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from '../benchmark/font-fixtures';
import type { HarnessLayout, RasterTechnique } from '../benchmark/url-state';

import type { ComparisonWorkloadId } from './contracts';

/** Every runnable live example, including the two retained single-paragraph scenes. */
export type BenchmarkWorkloadId = 'benchmark-ipsum' | 'advanced-shaping' | ComparisonWorkloadId;

export type LiveWorkloadSurfaceKind = 'advanced-shaping' | 'comparison' | 'single-paragraph';
export type LiveWorkloadPreloadKind = 'comparison-module' | 'technique-module';

export interface WorkloadRange {
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly scale: 'linear' | 'logarithmic';
  readonly step: number;
}

export interface WorkloadPaintControls {
  readonly opacity: WorkloadRange;
  readonly shadowTechniques: readonly RasterTechnique[];
  readonly strokeTechniques: readonly RasterTechnique[];
}

export interface WorkloadControls {
  readonly animation: boolean;
  readonly amount: WorkloadRange | undefined;
  readonly fontSize: WorkloadRange | undefined;
  readonly layoutBounds: boolean;
  readonly layoutWidth: WorkloadRange | undefined;
  readonly paint: WorkloadPaintControls | undefined;
}

export interface WorkloadInteraction {
  readonly pan: boolean;
  readonly zoom: boolean;
}

export interface WorkloadRuntimeDefaults {
  readonly animationEnabled: boolean;
  readonly animationSpeed: number;
  readonly fontSize: number;
  readonly layoutWidthPercent: number;
  readonly paintOpacityPercent: number;
  readonly paintShadowEnabled: boolean;
  readonly paintStrokePercent: number;
  readonly showGrid: boolean;
  readonly showLayoutBounds: boolean;
  readonly workloadAmount: number;
}

export type WorkloadFontPolicy =
  | {
      readonly defaultFixture: BenchmarkFontFixture;
      readonly kind: 'advanced-case';
    }
  | {
      readonly defaultFixture: SelectableFontFixture;
      readonly kind: 'fixed';
    }
  | {
      readonly iconFixture: typeof ICON_GRID_FONT_FIXTURE;
      readonly kind: 'icon-grid';
      readonly labelDefaultFixture: SelectableFontFixture;
    }
  | {
      readonly defaultFixture: SelectableFontFixture;
      readonly kind: 'selectable';
    };

/**
 * Declarative benchmark-app policy. Workload modules own the Text examples;
 * the route/UI consume this metadata rather than recreating workload-ID lists.
 */
export interface BenchmarkWorkloadDefinition {
  readonly controls: WorkloadControls;
  readonly defaults: Readonly<Record<HarnessLayout, WorkloadRuntimeDefaults>>;
  readonly description: string;
  readonly fontPolicy: WorkloadFontPolicy;
  readonly id: BenchmarkWorkloadId;
  readonly interaction: WorkloadInteraction;
  readonly label: string;
  readonly preload: LiveWorkloadPreloadKind;
  readonly surface: LiveWorkloadSurfaceKind;
  readonly techniques: Readonly<Record<RasterTechnique, { readonly kind: 'ready' }>>;
}

const READY_TECHNIQUES = {
  bitmap: { kind: 'ready' },
  mtsdf: { kind: 'ready' },
  slug: { kind: 'ready' },
} as const;

const STANDARD_RUNTIME_DEFAULTS = {
  animationEnabled: true,
  animationSpeed: 50,
  layoutWidthPercent: 82,
  paintOpacityPercent: 100,
  paintShadowEnabled: false,
  paintStrokePercent: 0,
  showGrid: true,
  showLayoutBounds: true,
  workloadAmount: 50,
} as const;

const DEFAULT_FONT_SIZE = {
  main: 20,
  presentation: 24,
} as const;

const FONT_SIZE = {
  label: 'Rendered size',
  maximum: 96,
  minimum: 8,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

const ICON_SIZE = {
  label: 'Icon size',
  maximum: 1_024,
  minimum: 8,
  scale: 'logarithmic',
  step: 1,
} as const satisfies WorkloadRange;

const LAYOUT_WIDTH = {
  label: 'Layout width',
  maximum: 100,
  minimum: 40,
  scale: 'linear',
  step: 2,
} as const satisfies WorkloadRange;

const OFF_AXIS_LAYOUT_WIDTH = {
  ...LAYOUT_WIDTH,
  maximum: 200,
} as const satisfies WorkloadRange;

const PERSPECTIVE_AMOUNT = {
  label: 'Perspective intensity',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

const REFLOW_AMOUNT = {
  label: 'Reflow amplitude',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

const TEXT_VOLUME_AMOUNT = {
  label: 'Text volume',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

const HUE_SPREAD_AMOUNT = {
  label: 'Hue spread',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

const PAINT_CONTROLS = {
  opacity: {
    label: 'Opacity',
    maximum: 100,
    minimum: 0,
    scale: 'linear',
    step: 1,
  },
  shadowTechniques: ['mtsdf'],
  strokeTechniques: ['mtsdf'],
} as const satisfies WorkloadPaintControls;

const NO_CONTROLS = {
  animation: false,
  amount: undefined,
  fontSize: undefined,
  layoutBounds: false,
  layoutWidth: undefined,
  paint: undefined,
} as const satisfies WorkloadControls;

function defaults(
  mainFontSize: number,
  presentationFontSize: number,
  options: Partial<WorkloadRuntimeDefaults> = {},
): Readonly<Record<HarnessLayout, WorkloadRuntimeDefaults>> {
  return {
    main: { ...STANDARD_RUNTIME_DEFAULTS, fontSize: mainFontSize, ...options },
    presentation: { ...STANDARD_RUNTIME_DEFAULTS, fontSize: presentationFontSize, ...options },
  };
}

export const BENCHMARK_WORKLOADS = {
  'benchmark-ipsum': {
    controls: {
      ...NO_CONTROLS,
      fontSize: FONT_SIZE,
      layoutWidth: LAYOUT_WIDTH,
    },
    defaults: defaults(DEFAULT_FONT_SIZE.main, DEFAULT_FONT_SIZE.presentation),
    description: 'Tests the everyday cost of rendering and reflowing a full paragraph.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'benchmark-ipsum',
    interaction: { pan: true, zoom: false },
    label: 'Benchmark ipsum',
    preload: 'technique-module',
    surface: 'single-paragraph',
    techniques: READY_TECHNIQUES,
  },
  'advanced-shaping': {
    controls: {
      ...NO_CONTROLS,
      fontSize: FONT_SIZE,
    },
    defaults: defaults(DEFAULT_FONT_SIZE.main, 48),
    description: 'Tests whether complex text stays correct as it types and wraps.',
    fontPolicy: { kind: 'advanced-case', defaultFixture: 'noto-sans-cjk-showcase' },
    id: 'advanced-shaping',
    interaction: { pan: true, zoom: false },
    label: 'Advanced shaping',
    preload: 'technique-module',
    surface: 'advanced-shaping',
    techniques: READY_TECHNIQUES,
  },
  'text-ladder': {
    controls: { ...NO_CONTROLS, animation: true },
    defaults: defaults(DEFAULT_FONT_SIZE.main, DEFAULT_FONT_SIZE.presentation),
    description: 'Tests how text quality holds up from 8 to 1024 pixels.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'text-ladder',
    interaction: { pan: true, zoom: false },
    label: 'Text ladder',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'zoom-text': {
    controls: { ...NO_CONTROLS, animation: true },
    defaults: defaults(DEFAULT_FONT_SIZE.main, DEFAULT_FONT_SIZE.presentation),
    description: 'Cycles through translations of “Shape” while scaling from 8 pt to the largest size that fits.',
    fontPolicy: { kind: 'fixed', defaultFixture: 'inter' },
    id: 'zoom-text',
    interaction: { pan: false, zoom: false },
    label: 'Zoom text',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'icon-grid': {
    controls: { ...NO_CONTROLS, animation: true, fontSize: ICON_SIZE },
    defaults: defaults(56, 64),
    description: 'Tests a labeled icon font across scale, movement, and raster techniques.',
    fontPolicy: {
      iconFixture: ICON_GRID_FONT_FIXTURE,
      kind: 'icon-grid',
      labelDefaultFixture: 'inter',
    },
    id: 'icon-grid',
    interaction: { pan: true, zoom: false },
    label: 'Icon grid',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'off-axis-3d': {
    controls: {
      ...NO_CONTROLS,
      amount: PERSPECTIVE_AMOUNT,
      animation: true,
      fontSize: FONT_SIZE,
      layoutWidth: OFF_AXIS_LAYOUT_WIDTH,
    },
    defaults: defaults(96, 96, { layoutWidthPercent: 120, workloadAmount: 100 }),
    description: 'Tests text quality and cost at steep, moving viewing angles.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'off-axis-3d',
    interaction: { pan: true, zoom: true },
    label: 'Off-axis / 3D',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'dynamic-layout': {
    controls: {
      ...NO_CONTROLS,
      amount: REFLOW_AMOUNT,
      animation: true,
      fontSize: FONT_SIZE,
      layoutBounds: true,
      layoutWidth: LAYOUT_WIDTH,
    },
    defaults: defaults(28, 32),
    description: 'Tests whether animated containers reflow text smoothly and correctly.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'dynamic-layout',
    interaction: { pan: true, zoom: false },
    label: 'Dynamic layout',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'paragraph-stress': {
    controls: {
      ...NO_CONTROLS,
      amount: TEXT_VOLUME_AMOUNT,
      animation: true,
      fontSize: FONT_SIZE,
      layoutWidth: LAYOUT_WIDTH,
    },
    defaults: defaults(DEFAULT_FONT_SIZE.main, DEFAULT_FONT_SIZE.presentation, { workloadAmount: 100 }),
    description: 'Tests rendering cost as paragraphs, glyphs, and atlas pressure grow.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'paragraph-stress',
    interaction: { pan: true, zoom: false },
    label: 'Paragraph stress',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
  'paint-effects': {
    controls: {
      ...NO_CONTROLS,
      amount: HUE_SPREAD_AMOUNT,
      animation: true,
      fontSize: FONT_SIZE,
      layoutWidth: LAYOUT_WIDTH,
      paint: PAINT_CONTROLS,
    },
    defaults: defaults(44, 52),
    description: 'Tests the live cost and visual quality of animated text effects.',
    fontPolicy: { kind: 'selectable', defaultFixture: 'inter' },
    id: 'paint-effects',
    interaction: { pan: true, zoom: false },
    label: 'Paint & effects',
    preload: 'comparison-module',
    surface: 'comparison',
    techniques: READY_TECHNIQUES,
  },
} as const satisfies Record<BenchmarkWorkloadId, BenchmarkWorkloadDefinition>;

export const BENCHMARK_WORKLOAD_IDS = Object.freeze(Object.keys(BENCHMARK_WORKLOADS) as readonly BenchmarkWorkloadId[]);

export function benchmarkWorkloadDefinition(workload: BenchmarkWorkloadId): BenchmarkWorkloadDefinition {
  return BENCHMARK_WORKLOADS[workload];
}

export function comparisonWorkloadId(workload: BenchmarkWorkloadId): ComparisonWorkloadId | undefined {
  return benchmarkWorkloadDefinition(workload).surface === 'comparison'
    ? (workload as ComparisonWorkloadId)
    : undefined;
}

export function isBenchmarkWorkloadId(value: string): value is BenchmarkWorkloadId {
  return Object.hasOwn(BENCHMARK_WORKLOADS, value);
}
