import type { BenchmarkMeasurement } from '../src/benchmark/contracts'

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

export {}
