import type {
  BenchmarkFontFixture,
  ICON_GRID_FONT_FIXTURE,
  SelectableFontFixture,
} from '../../benchmark/font-fixtures';
import type { HarnessLayout, RasterTechnique } from '../../benchmark/url-state';

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
  | { readonly defaultFixture: BenchmarkFontFixture; readonly kind: 'advanced-case' }
  | { readonly defaultFixture: SelectableFontFixture; readonly kind: 'fixed' }
  | {
      readonly iconFixture: typeof ICON_GRID_FONT_FIXTURE;
      readonly kind: 'icon-grid';
      readonly labelDefaultFixture: SelectableFontFixture;
    }
  | { readonly defaultFixture: SelectableFontFixture; readonly kind: 'selectable' };

/** Route policy colocated with the authored scene that it presents. */
export interface BenchmarkWorkloadDefinition<Id extends string = string> {
  readonly controls: WorkloadControls;
  readonly defaults: Readonly<Record<HarnessLayout, WorkloadRuntimeDefaults>>;
  readonly description: string;
  readonly fontPolicy: WorkloadFontPolicy;
  readonly id: Id;
  readonly interaction: WorkloadInteraction;
  readonly label: string;
  readonly preload: LiveWorkloadPreloadKind;
  readonly surface: LiveWorkloadSurfaceKind;
  readonly techniques: Readonly<Record<RasterTechnique, { readonly kind: 'ready' }>>;
}

export const readyTechniques = {
  bitmap: { kind: 'ready' },
  mtsdf: { kind: 'ready' },
  slug: { kind: 'ready' },
} as const;

const standardRuntimeDefaults = {
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

export const fontSizeControl = {
  label: 'Rendered size',
  maximum: 96,
  minimum: 8,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const iconSizeControl = {
  label: 'Icon size',
  maximum: 1_024,
  minimum: 8,
  scale: 'logarithmic',
  step: 1,
} as const satisfies WorkloadRange;

export const layoutWidthControl = {
  label: 'Layout width',
  maximum: 100,
  minimum: 40,
  scale: 'linear',
  step: 2,
} as const satisfies WorkloadRange;

export const offAxisLayoutWidthControl = {
  ...layoutWidthControl,
  maximum: 200,
} as const satisfies WorkloadRange;

export const perspectiveAmountControl = {
  label: 'Perspective intensity',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const reflowAmountControl = {
  label: 'Reflow amplitude',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const textVolumeAmountControl = {
  label: 'Text volume',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const hueSpreadAmountControl = {
  label: 'Hue spread',
  maximum: 100,
  minimum: 0,
  scale: 'linear',
  step: 1,
} as const satisfies WorkloadRange;

export const paintControls = {
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

export const noControls = {
  animation: false,
  amount: undefined,
  fontSize: undefined,
  layoutBounds: false,
  layoutWidth: undefined,
  paint: undefined,
} as const satisfies WorkloadControls;

export function workloadDefaults(
  mainFontSize: number,
  presentationFontSize: number,
  options: Partial<WorkloadRuntimeDefaults> = {},
): Readonly<Record<HarnessLayout, WorkloadRuntimeDefaults>> {
  return {
    main: { ...standardRuntimeDefaults, fontSize: mainFontSize, ...options },
    presentation: { ...standardRuntimeDefaults, fontSize: presentationFontSize, ...options },
  };
}
