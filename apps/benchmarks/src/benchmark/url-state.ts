export type HarnessMode = 'benchmark' | 'conformance'
export type RasterTechnique = 'bitmap' | 'mtsdf' | 'slug'
export type GraphicsBackend = 'webgpu' | 'webgl2'

export interface HarnessLocation {
  readonly mode: HarnessMode
  readonly technique: RasterTechnique
  readonly backend: GraphicsBackend
  readonly workload: string
  readonly view: 'scene' | 'controls' | 'report' | 'export'
}

export const defaultLocation: HarnessLocation = {
  mode: 'benchmark',
  technique: 'bitmap',
  backend: 'webgpu',
  workload: 'benchmark-ipsum',
  view: 'scene',
}

export function readHarnessLocation(search: string): HarnessLocation {
  const values = new URLSearchParams(search)
  const view = values.get('view')
  const legacyTarget = values.get('target')
  const legacyScenario = values.get('scenario')
  const hasLegacySelection = legacyTarget !== null || legacyScenario !== null
  return {
    mode: enumValue(
      values.get('mode'),
      ['benchmark', 'conformance'],
      hasLegacySelection ? 'conformance' : defaultLocation.mode,
    ),
    technique: enumValue(values.get('technique'), ['bitmap', 'mtsdf', 'slug'], 'bitmap'),
    backend: enumValue(
      values.get('backend'),
      ['webgpu', 'webgl2'],
      legacyTarget?.endsWith('webgl2') === true ? 'webgl2' : defaultLocation.backend,
    ),
    workload:
      values.get('workload') ??
      (hasLegacySelection ? legacyWorkload(legacyScenario) : defaultLocation.workload),
    view: enumValue(view, ['scene', 'controls', 'report', 'export'], defaultLocation.view),
  }
}

export function writeHarnessLocation(value: HarnessLocation): string {
  const values = new URLSearchParams()
  values.set('mode', value.mode)
  values.set('technique', value.technique)
  values.set('backend', value.backend)
  values.set('workload', value.workload)
  if (value.view !== 'scene') values.set('view', value.view)
  return `?${values.toString()}`
}

function legacyWorkload(scenario: string | null): string {
  return scenario === 'bitmap-text-frame' ? 'bitmap-frame' : (scenario ?? 'runner-contract')
}

function enumValue<const Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  fallback: Value,
): Value {
  return allowed.includes(value as Value) ? (value as Value) : fallback
}
