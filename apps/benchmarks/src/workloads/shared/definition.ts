import type {
  BenchmarkFontFixture,
  ICON_GRID_FONT_FIXTURE,
  SelectableFontFixture,
} from '../../benchmark/font-fixtures';
import type { HarnessLayout, RasterFormatName } from '../../benchmark/url-state';

export type LiveWorkloadSurfaceKind = 'advanced-shaping' | 'comparison' | 'single-paragraph';
export type LiveWorkloadPreloadKind = 'comparison-module' | 'format-module';

export interface WorkloadRange {
  readonly label: string;
  readonly maximum: number;
  readonly minimum: number;
  readonly scale: 'linear' | 'logarithmic';
  readonly step: number;
}

export interface WorkloadPaintControls {
  readonly opacity: WorkloadRange;
  readonly shadowFormats: readonly RasterFormatName[];
  readonly strokeFormats: readonly RasterFormatName[];
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
  | {
      readonly companionFixtures: readonly [BenchmarkFontFixture, ...BenchmarkFontFixture[]];
      readonly defaultFixture: SelectableFontFixture;
      readonly kind: 'composed';
    }
  | { readonly defaultFixture: SelectableFontFixture; readonly kind: 'fixed' }
  | {
      readonly iconFixture: typeof ICON_GRID_FONT_FIXTURE;
      readonly kind: 'icon-grid';
      readonly labelDefaultFixture: SelectableFontFixture;
    }
  | { readonly defaultFixture: SelectableFontFixture; readonly kind: 'selectable' };

const NO_COMPANION_FIXTURES: readonly BenchmarkFontFixture[] = Object.freeze([]);

/**
 * The further concrete fixtures a route needs resident beside its selected font, in declaration order.
 *
 * Icon Grid renders its icons from its one companion while its labels come from the selection; a composed route names
 * the faces its spans select for ranges the selection either cannot shape or should not shape. Both are the same host
 * obligation — load further fixtures into the shared registry — so both answer through one accessor rather than
 * through separate host branches. Order is the contract: a composed scene reads its companions positionally.
 */
export function workloadCompanionFontFixtures(policy: WorkloadFontPolicy): readonly BenchmarkFontFixture[] {
  if (policy.kind === 'icon-grid') return [policy.iconFixture];
  if (policy.kind === 'composed') return policy.companionFixtures;
  return NO_COMPANION_FIXTURES;
}

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
  readonly formats: Readonly<Record<RasterFormatName, { readonly kind: 'ready' }>>;
}

export const readyFormats = {
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

export const spanDensityAmountControl = {
  label: 'Span density',
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
  shadowFormats: ['mtsdf'],
  strokeFormats: ['mtsdf'],
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
