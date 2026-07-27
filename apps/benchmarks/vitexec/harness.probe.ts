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
let viewport = await waitForElement('[data-testid="bitmap-live-viewport"]')
const controls = await waitForElement('[data-testid="controls"]')
const gpuResourceInspector = await waitForElement('[data-testid="gpu-resource-inspector"]')
const sparklineCards = [...document.querySelectorAll<HTMLElement>('[data-testid^="sparkline-"]')]
const sparklineContract = sparklineCards.map((card) => ({
  id: card.dataset.testid,
  tone: card.dataset.tone,
  text: card.textContent,
}))
if (
  JSON.stringify(sparklineContract.map(({ id, tone }) => [id, tone])) !==
  JSON.stringify([
    ['sparkline-fps', 'success'],
    ['sparkline-cpu', 'cyan'],
    ['sparkline-gpu', 'warning'],
  ])
) {
  throw new Error('Live telemetry graphs did not preserve FPS/CPU/GPU order and tones')
}
if (sparklineContract.some(({ text }) => !text?.includes('LOW') || !text.includes('HIGH'))) {
  throw new Error('Live telemetry graphs did not expose readable low/high watermarks')
}
await waitForText(gpuResourceInspector, 'Texture pages · 1')
if (!gpuResourceInspector.textContent?.includes('16 px · page 1 · 1024×679')) {
  throw new Error('Bitmap payload inspector did not expose the canonical strike page')
}
const controlsText = controls.textContent ?? ''
if (controlsText.indexOf('Show canvas grid') > controlsText.indexOf('Live workload')) {
  throw new Error('Global canvas-grid control must precede workload-specific controls')
}
await verifyGpuTiming(viewport, 'webgpu')
const renderedSizeControl = document.querySelector<HTMLInputElement>(
  'input[type="range"][min="8"][max="96"]',
)
if (renderedSizeControl === null) throw new Error('Shared rendered-size control is missing')
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
if (setInputValue === undefined) throw new Error('Native input value setter is unavailable')
setInputValue.call(renderedSizeControl, '96')
renderedSizeControl.dispatchEvent(new Event('input', { bubbles: true }))
await waitForAttribute(viewport, 'data-rendered-device-px', '96')
if (numericAttribute(viewport, 'data-scale-ratio') !== 6) {
  throw new Error('Bitmap did not expose its 96 px / 16 px strike scaling cost')
}
const msdfButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.trim() === 'MSDF' && !candidate.disabled,
)
if (msdfButton === undefined) throw new Error('MSDF technique control is missing')
msdfButton.click()
const mtsdfViewport = await waitForElement('[data-testid="mtsdf-live-viewport"]')
await waitForAttribute(mtsdfViewport, 'data-rendered-device-px', '96')
if (numericAttribute(mtsdfViewport, 'data-scale-ratio') !== 1.5) {
  throw new Error('MSDF did not preserve the shared 96 px rendered size')
}
const bitmapButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.trim() === 'bitmap' && !candidate.disabled,
)
if (bitmapButton === undefined) throw new Error('Bitmap technique control is missing')
bitmapButton.click()
viewport = await waitForElement('[data-testid="bitmap-live-viewport"]')
await waitForAttribute(viewport, 'data-rendered-device-px', '96')
const initialLayoutWidth = numericAttribute(viewport, 'data-layout-width')
const initialLineCount = numericAttribute(viewport, 'data-line-count')
const layoutWidthControl = document.querySelector<HTMLInputElement>(
  'input[type="range"][min="40"][max="100"]',
)
if (layoutWidthControl === null) throw new Error('Live layout width control is missing')
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
const benchmarkSourceTextLength = numericAttribute(viewport, 'data-source-text-length')

for (const fixture of [
  { id: 'source-serif-4', label: 'Source Serif 4', artifactBytes: 468_784 },
  { id: 'dancing-script', label: 'Dancing Script', artifactBytes: 291_556 },
  { id: 'inter', label: 'Inter Regular', artifactBytes: 927_164 },
] as const) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes(fixture.label) === true && !candidate.disabled,
  )
  if (button === undefined) throw new Error(`${fixture.label} font fixture control is missing`)
  const previousViewport = viewport
  button.click()
  viewport = await waitForReplacement(previousViewport, '[data-testid="bitmap-live-viewport"]')
  await waitForAttribute(viewport, 'data-font-fixture', fixture.id)
  await waitForAttribute(viewport, 'data-artifact-bytes', String(fixture.artifactBytes))
  if (numericAttribute(viewport, 'data-source-text-length') !== benchmarkSourceTextLength) {
    throw new Error(`${fixture.label} changed the benchmark source corpus`)
  }
  numericAttribute(viewport, 'data-missing-glyph-count')
}

captureWindow.click()
await waitForText(scene, 'Captured the current rolling window')

const webglButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.trim() === 'WebGL2' && !candidate.disabled,
)
if (webglButton === undefined) throw new Error('WebGL2 live backend control is missing')
webglButton.click()
const webglViewport = await waitForReplacement(viewport, '[data-testid="bitmap-live-viewport"]')
await verifyGpuTiming(webglViewport, 'webgl2')

const webgpuButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.trim() === 'WebGPU' && !candidate.disabled,
)
if (webgpuButton === undefined) throw new Error('WebGPU live backend control is missing')
webgpuButton.click()
const restoredWebgpuViewport = await waitForReplacement(
  webglViewport,
  '[data-testid="bitmap-live-viewport"]',
)
await verifyGpuTiming(restoredWebgpuViewport, 'webgpu')

const paintEffectsButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.includes('Paint & effects') === true && !candidate.disabled,
)
if (paintEffectsButton === undefined) throw new Error('Paint & Effects workload is missing')
paintEffectsButton.click()
let paintViewport = await waitForElement('[data-testid="comparison-live-viewport"]')
await waitForAttribute(paintViewport, 'data-workload', 'paint-effects')
await waitForAttribute(paintViewport, 'data-technique', 'bitmap')

const opacityControl = await waitForRangeControl('Opacity')
setInputValue.call(opacityControl, '65')
opacityControl.dispatchEvent(new Event('input', { bubbles: true }))
await waitForAttribute(paintViewport, 'data-paint-opacity', '0.65')

let strokeControl = await waitForRangeControl('Stroke width')
if (!strokeControl.disabled || strokeControl.value !== '0') {
  throw new Error('Bitmap Paint & Effects must expose a disabled zero-width stroke control')
}

msdfButton.click()
paintViewport = await waitForElementState('[data-testid="comparison-live-viewport"]', {
  'data-workload': 'paint-effects',
  'data-technique': 'mtsdf',
})
await waitForAttribute(paintViewport, 'data-paint-opacity', '0.65')
strokeControl = await waitForRangeControl('Stroke width')
if (strokeControl.disabled) {
  throw new Error('MSDF Paint & Effects stroke control must be enabled')
}
setInputValue.call(strokeControl, '70')
strokeControl.dispatchEvent(new Event('input', { bubbles: true }))
await waitForAttribute(paintViewport, 'data-paint-stroke-width', '0.7')
bitmapButton.click()
await waitForElementState('[data-testid="comparison-live-viewport"]', {
  'data-workload': 'paint-effects',
  'data-technique': 'bitmap',
})

const advancedShapingPath = '/src/benchmark/advanced-shaping.ts'
const { ADVANCED_SHAPING_CASES } = await import(/* @vite-ignore */ advancedShapingPath)
const advancedShapingButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) =>
    candidate.textContent?.includes('Advanced shaping') === true && !candidate.disabled,
)
if (advancedShapingButton === undefined) throw new Error('Advanced-shaping workload is missing')
advancedShapingButton.click()
const caseSelector = await waitForSelect('Case')
await waitForLiveViewportState({
  'data-backend': 'webgpu',
  'data-presentation-progress': '1',
})
const initialPause = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
  (candidate) => candidate.textContent?.trim() === 'Pause' && !candidate.disabled,
)
if (initialPause === undefined) throw new Error('Advanced shaping did not load playing')
initialPause.click()
await waitForButtonText('Play')
console.log('advanced-shaping-start')
const setSelectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
if (setSelectValue === undefined) throw new Error('Native select value setter is unavailable')
const setTextareaValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)?.set
if (setTextareaValue === undefined) throw new Error('Native textarea value setter is unavailable')

for (const definition of ADVANCED_SHAPING_CASES) {
  console.log('advanced-shaping-select', definition.id)
  setSelectValue.call(caseSelector, definition.id)
  caseSelector.dispatchEvent(new Event('change', { bubbles: true }))
  const authoredText = definition.showcaseRevealUnits.join('')
  const timeline = await waitForRangeMaximum(
    'Timeline',
    String(definition.showcaseRevealUnits.length),
  )
  setInputValue.call(timeline, String(definition.showcaseRevealUnits.length))
  timeline.dispatchEvent(new Event('input', { bubbles: true }))
  const settledViewport = await waitForLiveViewportState({
    'data-backend': 'webgpu',
    'data-anchor': 'measure-center',
    'data-text-align': 'start',
    'data-layout-width-ratio': String(definition.showcaseWidthPermille / 1000),
    'data-presentation-progress': '1',
    'data-settled-tick': String(definition.showcaseRevealUnits.length),
    'data-settled-text-length': String(authoredText.length),
    'data-missing-glyph-count': '0',
  })
  if (numericAttribute(settledViewport, 'data-line-count') <= 1) {
    throw new Error(`${definition.id} did not expose live paragraph wrapping`)
  }
  console.log('advanced-shaping-settled', definition.id)
  const editors = document.querySelectorAll<HTMLTextAreaElement>('textarea')
  const editor = editors.length === 1 ? editors[0] : undefined
  if (editor === undefined || editor.value !== authoredText) {
    throw new Error(`${definition.id} did not expose its exact authored text`)
  }
  setInputValue.call(timeline, String(definition.showcaseRevealUnits.length - 1))
  timeline.dispatchEvent(new Event('input', { bubbles: true }))
  const scrubbedViewport = await waitForLiveViewportState({
    'data-backend': 'webgpu',
    'data-presentation-progress': '1',
    'data-settled-tick': String(definition.showcaseRevealUnits.length - 1),
    'data-missing-glyph-count': '0',
  })
  if (
    numericAttribute(scrubbedViewport, 'data-presentation-matched-glyphs') <= 0 ||
    numericAttribute(scrubbedViewport, 'data-presentation-target-glyphs') <= 0
  ) {
    throw new Error(`${definition.id} did not match stable glyphs across its scrubbed layout`)
  }
  if (
    [...document.querySelectorAll<HTMLButtonElement>('button')].some((candidate) =>
      ['−1', '+1'].includes(candidate.textContent?.trim() ?? ''),
    )
  ) {
    throw new Error('Advanced-shaping retained redundant single-step controls')
  }
  console.log('advanced-shaping-scrubbed', definition.id)
  if (definition.id === 'latin-features') {
    const editedText = 'Editable AVATAR office'
    setTextareaValue.call(editor, editedText)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    await waitForLiveViewportState({
      'data-backend': 'webgpu',
      'data-presentation-progress': '1',
      'data-settled-text-length': String(editedText.length),
      'data-missing-glyph-count': '0',
    })
    const reset = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Reset' && !candidate.disabled,
    )
    if (reset === undefined) throw new Error('Advanced-shaping reset control is missing')
    reset.click()
    await waitForLiveViewportState({
      'data-backend': 'webgpu',
      'data-presentation-progress': '1',
      'data-settled-tick': '0',
      'data-settled-text-length': '0',
      'data-missing-glyph-count': '0',
    })
    const play = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Play' && !candidate.disabled,
    )
    if (play === undefined) throw new Error('Advanced-shaping play control is missing')
    play.click()
    const playbackViewport = await waitForLiveViewportState({
      'data-backend': 'webgpu',
      'data-presentation-progress': '1',
      'data-settled-tick': '2',
      'data-missing-glyph-count': '0',
    })
    if (numericAttribute(playbackViewport, 'data-presentation-matched-glyphs') <= 0) {
      throw new Error('Advanced-shaping playback did not interpolate its stable glyph')
    }
    const pause = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Pause' && !candidate.disabled,
    )
    if (pause === undefined) throw new Error('Advanced-shaping pause control is missing')
    pause.click()
    console.log('advanced-shaping-playback')
    console.log('advanced-shaping-edited')
  }
}

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

function waitForButtonText(label: string): Promise<HTMLButtonElement> {
  const find = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label && !candidate.disabled,
    )
  const current = find()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const button = find()
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

function waitForSelect(label: string): Promise<HTMLSelectElement> {
  const current = [...document.querySelectorAll<HTMLSelectElement>('select')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
  )
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find(
        (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
      )
      if (select === undefined) return
      observer.disconnect()
      resolve(select)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

function waitForRangeControl(label: string): Promise<HTMLInputElement> {
  const find = (): HTMLInputElement | undefined =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
      (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
    )
  const current = find()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const control = find()
      if (control === undefined) return
      observer.disconnect()
      resolve(control)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

function waitForRangeMaximum(label: string, maximum: string): Promise<HTMLInputElement> {
  const find = (): HTMLInputElement | undefined =>
    [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
      (candidate) =>
        candidate.labels?.[0]?.textContent?.includes(label) === true && candidate.max === maximum,
    )
  const current = find()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const control = find()
      if (control === undefined) return
      observer.disconnect()
      resolve(control)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

function waitForLiveViewportState(
  attributes: Readonly<Record<string, string>>,
): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="bitmap-live-viewport"]')].find(
      (candidateViewport) =>
        Object.entries(attributes).every(
          ([name, value]) => candidateViewport.getAttribute(name) === value,
        ),
    )
  const current = find()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const candidateViewport = find()
      if (candidateViewport === undefined) return
      observer.disconnect()
      resolve(candidateViewport)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

function waitForElementState(
  selector: string,
  attributes: Readonly<Record<string, string>>,
): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const candidate = document.querySelector<HTMLElement>(selector)
    if (
      candidate === null ||
      Object.entries(attributes).some(([name, value]) => candidate.getAttribute(name) !== value)
    ) {
      return undefined
    }
    return candidate
  }
  const current = find()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const candidate = find()
      if (candidate === undefined) return
      observer.disconnect()
      resolve(candidate)
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

function waitForAttribute(element: HTMLElement, name: string, expected: string): Promise<void> {
  if (element.getAttribute(name) === expected) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (element.getAttribute(name) !== expected) return
      observer.disconnect()
      resolve()
    })
    observer.observe(element, { attributes: true, attributeFilter: [name] })
  })
}

function waitForReplacement(previous: HTMLElement, selector: string): Promise<HTMLElement> {
  const current = document.querySelector<HTMLElement>(selector)
  if (current !== null && current !== previous) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const replacement = document.querySelector<HTMLElement>(selector)
      if (replacement === null || replacement === previous) return
      observer.disconnect()
      resolve(replacement)
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  })
}

function waitForPositiveNumericAttribute(element: HTMLElement, name: string): Promise<number> {
  const current = numericAttribute(element, name)
  if (current > 0) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const next = numericAttribute(element, name)
      if (next <= 0) return
      observer.disconnect()
      resolve(next)
    })
    observer.observe(element, { attributes: true, attributeFilter: [name] })
  })
}

async function verifyGpuTiming(element: HTMLElement, backend: string): Promise<void> {
  await waitForAttribute(element, 'data-backend', backend)
  const supported = element.getAttribute('data-gpu-timing-supported')
  if (supported !== 'true' && supported !== 'false') {
    throw new Error(`${backend} did not publish its GPU timestamp-query capability`)
  }
  let sampleCount = 0
  if (supported === 'true') {
    sampleCount = await waitForPositiveNumericAttribute(element, 'data-gpu-history-length')
  }
  console.log('gpu-timing-ready', JSON.stringify({ backend, supported, sampleCount }))
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
