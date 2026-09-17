import { SELECTABLE_FONT_FIXTURE_IDS, type SelectableFontFixture } from './font-fixtures';
import { isBenchmarkWorkloadId, type BenchmarkWorkloadId } from '../workloads/catalog';

export type HarnessLayout = 'main' | 'presentation';
export type RasterFormatName = 'bitmap' | 'mtsdf' | 'slug';
export type GraphicsBackend = 'webgpu' | 'webgl2';
export type FontDelivery = 'baked' | 'runtime';

export interface HarnessLocation {
  readonly layout: HarnessLayout;
  readonly technique: RasterFormatName;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontFixture: SelectableFontFixture;
  readonly workload: BenchmarkWorkloadId;
  readonly view: 'scene' | 'controls';
}

export const defaultLocation: HarnessLocation = {
  layout: 'main',
  technique: 'bitmap',
  backend: 'webgpu',
  delivery: 'baked',
  dpr: 1,
  fontFixture: 'inter',
  workload: 'benchmark-ipsum',
  view: 'scene',
};

export function readHarnessLocation(
  search: string,
  defaultDpr: 1 | 2 = defaultLocation.dpr,
  layout: HarnessLayout = defaultLocation.layout,
): HarnessLocation {
  const values = new URLSearchParams(search);
  const view = values.get('view');
  const requestedWorkload = values.get('workload') ?? defaultLocation.workload;
  return {
    layout,
    technique: enumValue(values.get('technique'), ['bitmap', 'mtsdf', 'slug'], 'bitmap'),
    backend: enumValue(values.get('backend'), ['webgpu', 'webgl2'], defaultLocation.backend),
    delivery: enumValue(values.get('delivery'), ['baked', 'runtime'], defaultLocation.delivery),
    dpr: numericEnumValue(values.get('dpr'), [1, 2], defaultDpr),
    fontFixture: enumValue(values.get('font'), SELECTABLE_FONT_FIXTURE_IDS, defaultLocation.fontFixture),
    workload: isBenchmarkWorkloadId(requestedWorkload) ? requestedWorkload : defaultLocation.workload,
    view: enumValue(view, ['scene', 'controls'], defaultLocation.view),
  };
}

export function writeHarnessLocation(value: HarnessLocation): string {
  const values = new URLSearchParams();
  values.set('technique', value.technique);
  values.set('backend', value.backend);
  values.set('delivery', value.delivery);
  values.set('dpr', String(value.dpr));
  values.set('font', value.fontFixture);
  values.set('workload', value.workload);
  if (value.view !== 'scene') values.set('view', value.view);
  return `?${values.toString()}`;
}

export function writeHarnessUrl(value: HarnessLocation): string {
  const pathname = value.layout === 'presentation' ? '/presentation' : '/';
  return `${pathname}${writeHarnessLocation(value)}`;
}

function numericEnumValue<const Value extends number>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const numericValue = value === null ? Number.NaN : Number(value);
  return allowed.find((candidate) => candidate === numericValue) ?? fallback;
}

function enumValue<const Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
