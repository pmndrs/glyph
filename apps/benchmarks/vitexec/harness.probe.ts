import type { BenchmarkMeasurement } from '../src/benchmark/contracts'
import paragraphBidiContract from '../fixtures/contracts/paragraph-bidi-layout-v0.json'
import { paragraphPolicyContractHash } from '../src/benchmark/paragraph-layout-digest'

function elementByText(selector: string, value: string): HTMLElement {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (candidate) => candidate.textContent?.trim() === value,
  )
  if (element === undefined) throw new Error(`Missing ${selector} with text ${value}`)
  return element
}

function waitForText(root: HTMLElement, value: string): Promise<void> {
  if (root.textContent?.includes(value) === true) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (root.textContent?.includes(value) !== true) return
      observer.disconnect()
      resolve()
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true })
  })
}

function waitForElement(selector: string): Promise<HTMLElement> {
  const current = document.querySelector<HTMLElement>(selector)
  if (current !== null) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const element = document.querySelector<HTMLElement>(selector)
      if (element === null) return
      observer.disconnect()
      resolve(element)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

const scene = await waitForElement('[data-testid="scene"]')
if (!scene.textContent?.includes('Runner contract')) {
  throw new Error('Default deterministic target is not visible')
}

elementByText('button', 'Run suite').click()
await waitForText(scene, 'passed')

const metrics = [...scene.querySelectorAll<HTMLElement>('.font-mono')]
  .map((element) => element.textContent?.trim())
  .filter(Boolean)
console.log('harness-ready', JSON.stringify({ url: location.search, metrics }))

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])
const paragraph = await runRegisteredBenchmark({
  targetId: 'paragraph-engine',
  scenarioId: 'paragraph-measurement',
  input: {},
  controls: { samples: 3, warmup: 1 },
  environment: await environmentResource(),
})
if (
  paragraph.status !== 'passed' ||
  paragraph.measurements.length !== 3 ||
  paragraph.measurements.some(
    (measurement: BenchmarkMeasurement) =>
      measurement.hash !== '79874b9d' ||
      measurement.metrics?.shapeBoundaryCrossings !== 1 ||
      measurement.metrics.reshapeBoundaryCrossings !== 0 ||
      measurement.metrics.reflowBoundaryCrossings !== 0 ||
      measurement.metrics.positionedGlyphBytes !== 0,
  )
) {
  throw new Error('Live paragraph probe did not preserve its exact cached-reflow contract')
}
console.log(
  'paragraph-ready',
  JSON.stringify({
    hash: paragraph.measurements[0]?.hash,
    validation: paragraph.validation,
    webgpu: paragraph.environment.webgpu,
  }),
)

const positioned = await runRegisteredBenchmark({
  targetId: 'paragraph-layout-engine',
  scenarioId: 'paragraph-layout',
  input: {},
  controls: { samples: 3, warmup: 1 },
  environment: await environmentResource(),
})
if (
  positioned.status !== 'passed' ||
  positioned.measurements.length !== 3 ||
  positioned.measurements.some(
    (measurement: BenchmarkMeasurement) =>
      measurement.hash !== 'bb15bbcc:4f111a3f:e8c0e9d5' ||
      measurement.metrics?.shapeBoundaryCrossings !== 1 ||
      measurement.metrics.reshapeBoundaryCrossings !== 2 ||
      measurement.metrics.batchedBoundaryLayouts !== 2,
  )
) {
  throw new Error('Live positioned paragraph probe did not preserve its exact reshape contract')
}
console.log(
  'positioned-ready',
  JSON.stringify({
    hash: positioned.measurements[0]?.hash,
    validation: positioned.validation,
    webgpu: positioned.environment.webgpu,
  }),
)

const paragraphPolicyHash = paragraphPolicyContractHash(paragraphBidiContract)
const policy = await runRegisteredBenchmark({
  targetId: 'paragraph-bidi-policy',
  scenarioId: 'paragraph-bidi-policy',
  input: {},
  controls: { samples: 3, warmup: 1 },
  environment: await environmentResource(),
})
if (
  policy.status !== 'passed' ||
  policy.measurements.length !== 3 ||
  policy.measurements.some(
    (measurement: BenchmarkMeasurement) =>
      measurement.hash !== paragraphPolicyHash ||
      measurement.outputBytes !== 8098 ||
      measurement.metrics?.bidiLayoutCount !== 2 ||
      measurement.metrics.policyLayoutCount !== 9 ||
      measurement.metrics.uikitMeasurementCount !== 25 ||
      measurement.metrics.uikitLayoutCount !== 1 ||
      measurement.metrics.shapeBoundaryCrossings !== 4 ||
      measurement.metrics.reshapeBoundaryCrossings !== 5,
  )
) {
  throw new Error('Live bidi/policy probe did not preserve its exact GLB and uikit contract')
}
console.log(
  'paragraph-policy-ready',
  JSON.stringify({
    hash: policy.measurements[0]?.hash,
    validation: policy.validation,
    webgpu: policy.environment.webgpu,
  }),
)

export {}
