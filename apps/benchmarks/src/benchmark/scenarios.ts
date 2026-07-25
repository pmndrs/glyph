import type { BenchmarkScenario } from './contracts'

function deterministicValidation(hashes: readonly string[]): string {
  if (hashes.length === 0) throw new Error('Scenario produced no measurements')
  const unique = new Set(hashes)
  if (unique.size !== 1) throw new Error('Output hash changed between samples')
  return `${hashes.length}/${hashes.length} deterministic outputs`
}

function shapingValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.metrics?.boundaryCrossings !== 1 ||
      value.metrics.goldenCases !== 8 ||
      value.metrics.planCount !== 3
    ) {
      throw new Error('Shaping sample did not preserve its call, corpus, and plan-cache contract')
    }
  }
  return `${values.length}/${values.length} exact corpus outputs · 1 Wasm call/sample`
}

function paragraphValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.metrics?.shapeBoundaryCrossings !== 1 ||
      value.metrics.reshapeBoundaryCrossings !== 0 ||
      value.metrics.reflowBoundaryCrossings !== 0 ||
      value.metrics.measurementCount !== 3 ||
      value.metrics.positionedGlyphBytes !== 0
    ) {
      throw new Error('Paragraph sample did not preserve its prepare-once, cached-reflow contract')
    }
  }
  return `${values.length}/${values.length} exact paragraph outputs · 0 Wasm reflow calls/sample`
}

function paragraphLayoutValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.hash !== 'bb15bbcc:4f111a3f:e8c0e9d5' ||
      value.metrics?.shapeBoundaryCrossings !== 1 ||
      value.metrics.reshapeBoundaryCrossings !== 2 ||
      value.metrics.batchedBoundaryLayouts !== 2 ||
      value.metrics.layoutCount !== 3 ||
      value.metrics.glyphCount !== 165
    ) {
      throw new Error('Paragraph layout sample did not preserve its exact SoA and batch contract')
    }
  }
  return `${values.length}/${values.length} exact positioned outputs · 1 reshape batch/changed width`
}

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Runner lifecycle, validation, and environment readiness.',
    requiredCapabilities: new Set(['deterministic']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'cold-load-payload',
    label: 'Cold load + payload',
    description: 'Wasm startup, source-to-GLB bake time, output bytes, and determinism.',
    requiredCapabilities: new Set(['font-bytes', 'wasm']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'worker-fallback',
    label: 'Worker fallback',
    description: 'Missing baked probe, module-Worker bake, validation, and registration.',
    requiredCapabilities: new Set(['loader', 'font-bytes', 'wasm']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'shaping-conformance',
    label: 'HarfRust shaping conformance',
    description: 'Eight pinned runs in one Wasm call with exact SoA output and cache accounting.',
    requiredCapabilities: new Set(['shaping', 'font-bytes', 'wasm']),
    validate: shapingValidation,
  },
  {
    id: 'paragraph-measurement',
    label: 'Paragraph measurement',
    description: 'Exact GLB-backed broad shape followed by cached wide and narrow reflow.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphValidation,
  },
  {
    id: 'paragraph-layout',
    label: 'Positioned paragraph layout',
    description: 'Exact natural, wide, and narrow SoA output with cached batched boundary reshape.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphLayoutValidation,
  },
]

export const plannedScenarios = [
  'Screen-space ladder',
  'Off-axis / 3D',
  'Dynamic layout',
  'Paragraph stress',
  'Glyph coverage',
] as const

export function scenarioById(id: string): BenchmarkScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!
}
