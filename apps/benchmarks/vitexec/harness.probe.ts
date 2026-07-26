import type { BenchmarkMeasurement } from '../src/benchmark/contracts'

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
if (!scene.textContent?.includes('Benchmark ipsum')) {
  throw new Error('Default live benchmark workload is not visible')
}

const captureWindow = await waitForEnabledButton('Capture window')
const viewport = await waitForElement('[data-testid="bitmap-live-viewport"]')
const initialLayoutWidth = numericAttribute(viewport, 'data-layout-width')
const initialLineCount = numericAttribute(viewport, 'data-line-count')
const layoutWidthControl = document.querySelector<HTMLInputElement>(
  'input[type="range"][min="40"][max="100"]',
)
if (layoutWidthControl === null) throw new Error('Live layout width control is missing')
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
if (setInputValue === undefined) throw new Error('Native input value setter is unavailable')
setInputValue.call(layoutWidthControl, '50')
layoutWidthControl.dispatchEvent(new Event('input', { bubbles: true }))
const reflowedLayoutWidth = await waitForChangedNumericAttribute(
  viewport,
  'data-layout-width',
  initialLayoutWidth,
)
const reflowedLineCount = numericAttribute(viewport, 'data-line-count')
if (reflowedLayoutWidth >= initialLayoutWidth || reflowedLineCount <= initialLineCount) {
  throw new Error('Live layout width control did not commit a narrower paragraph reflow')
}

captureWindow.click()
await waitForText(scene, 'Captured the current rolling window')

const metrics = [...scene.querySelectorAll<HTMLElement>('.font-mono')]
  .map((element) => element.textContent?.trim())
  .filter(Boolean)
console.log('harness-ready', JSON.stringify({ url: location.search, metrics }))

function waitForEnabledButton(label: string): Promise<HTMLButtonElement> {
  const current = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label && !candidate.disabled,
  )
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (candidate) => candidate.getAttribute('aria-label') === label && !candidate.disabled,
      )
      if (button === undefined) return
      observer.disconnect()
      resolve(button)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

function numericAttribute(element: HTMLElement, name: string): number {
  const raw = element.getAttribute(name)
  if (raw === null) throw new Error(`${name} is missing from the live viewport`)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${name} is not a finite live metric`)
  return value
}

function waitForChangedNumericAttribute(
  element: HTMLElement,
  name: string,
  previous: number,
): Promise<number> {
  const current = numericAttribute(element, name)
  if (current !== previous) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const next = numericAttribute(element, name)
      if (next === previous) return
      observer.disconnect()
      resolve(next)
    })
    observer.observe(element, { attributes: true, attributeFilter: [name] })
  })
}

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const contractPath = '/fixtures/contracts/paragraph-bidi-layout-v0.json'
const digestPath = '/src/benchmark/paragraph-layout-digest.ts'
const [
  { runRegisteredBenchmark },
  { environmentResource },
  { default: paragraphBidiContract },
  { paragraphPolicyContractHash },
] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ contractPath),
  import(/* @vite-ignore */ digestPath),
])
const paragraph = await runRegisteredBenchmark({
  targetId: 'paragraph-engine',
  scenarioId: 'paragraph-measurement',
  input: {},
  controls: { dpr: 1, samples: 3, warmup: 1 },
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
  controls: { dpr: 1, samples: 3, warmup: 1 },
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
  controls: { dpr: 1, samples: 3, warmup: 1 },
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
