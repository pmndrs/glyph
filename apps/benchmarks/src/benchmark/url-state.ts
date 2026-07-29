export type HarnessMode = 'benchmark' | 'conformance';
export type HarnessLayout = 'main' | 'zen';
export type RasterTechnique = 'bitmap' | 'mtsdf' | 'slug';
export type GraphicsBackend = 'webgpu' | 'webgl2';
export type FontDelivery = 'baked' | 'runtime';

export interface HarnessLocation {
  readonly mode: HarnessMode;
  readonly layout: HarnessLayout;
  readonly technique: RasterTechnique;
  readonly backend: GraphicsBackend;
  readonly delivery: FontDelivery;
  readonly dpr: 1 | 2;
  readonly fontFixture: SelectableFontFixture;
  readonly workload: string;
  readonly view: 'scene' | 'controls' | 'report' | 'export';
}

export const defaultLocation: HarnessLocation = {
  mode: 'benchmark',
  layout: 'main',
  technique: 'bitmap',
  backend: 'webgpu',
  delivery: 'baked',
  dpr: 1,
  fontFixture: 'inter',
  workload: 'benchmark-ipsum',
  view: 'scene',
};

export function readHarnessLocation(search: string, defaultDpr: 1 | 2 = defaultLocation.dpr): HarnessLocation {
  const values = new URLSearchParams(search);
  const view = values.get('view');
  const legacyTarget = values.get('target');
  const legacyScenario = values.get('scenario');
  const hasLegacySelection = legacyTarget !== null || legacyScenario !== null;
  return {
    mode: enumValue(
      values.get('mode'),
      ['benchmark', 'conformance'],
      hasLegacySelection ? 'conformance' : defaultLocation.mode,
    ),
    layout: enumValue(values.get('layout'), ['main', 'zen'], defaultLocation.layout),
    technique: enumValue(values.get('technique'), ['bitmap', 'mtsdf', 'slug'], 'bitmap'),
    backend: enumValue(
      values.get('backend'),
      ['webgpu', 'webgl2'],
      legacyTarget?.endsWith('webgl2') === true ? 'webgl2' : defaultLocation.backend,
    ),
    delivery: enumValue(values.get('delivery'), ['baked', 'runtime'], defaultLocation.delivery),
    dpr: numericEnumValue(values.get('dpr'), [1, 2], defaultDpr),
    fontFixture: enumValue(values.get('font'), SELECTABLE_FONT_FIXTURE_IDS, defaultLocation.fontFixture),
    workload:
      values.get('workload') ?? (hasLegacySelection ? legacyWorkload(legacyScenario) : defaultLocation.workload),
    view: enumValue(view, ['scene', 'controls', 'report', 'export'], defaultLocation.view),
  };
}

export function writeHarnessLocation(value: HarnessLocation): string {
  const values = new URLSearchParams();
  values.set('mode', value.mode);
  if (value.layout === 'zen') values.set('layout', value.layout);
  values.set('technique', value.technique);
  values.set('backend', value.backend);
  values.set('delivery', value.delivery);
  values.set('dpr', String(value.dpr));
  values.set('font', value.fontFixture);
  values.set('workload', value.workload);
  if (value.view !== 'scene') values.set('view', value.view);
  return `?${values.toString()}`;
}

function numericEnumValue<const Value extends number>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  const numericValue = value === null ? Number.NaN : Number(value);
  return allowed.find((candidate) => candidate === numericValue) ?? fallback;
}

function legacyWorkload(scenario: string | null): string {
  return scenario === 'bitmap-text-frame' ? 'text-accuracy' : (scenario ?? 'runner-contract');
}

function enumValue<const Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}
import { SELECTABLE_FONT_FIXTURE_IDS, type SelectableFontFixture } from './font-fixtures';
