export {}

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

function waitForHeading(text: string): Promise<void> {
  const matches = (): boolean =>
    [...document.querySelectorAll('h1')].some((heading) => heading.textContent?.trim() === text)
  if (matches()) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!matches()) return
      observer.disconnect()
      resolve()
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  })
}

function waitForReadyComparison(): Promise<HTMLElement> {
  return waitForElement('[data-testid="raster-technique-comparison"]').then((surface) => {
    if (surface.dataset.conformanceReady === 'true') return surface
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const error = surface.querySelector<HTMLElement>('.text-danger')
        if (error !== null) {
          observer.disconnect()
          reject(new Error(error.textContent ?? 'GPU comparison failed'))
          return
        }
        if (surface.dataset.conformanceReady !== 'true') return
        observer.disconnect()
        resolve(surface)
      })
      observer.observe(surface, { attributes: true, childList: true, subtree: true })
    })
  })
}

function workloadButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.includes(label) === true && !candidate.disabled,
  )
  if (button === undefined) throw new Error(`${label} workload is unavailable`)
  return button
}

await waitForHeading('MSDF / Slug compare')
let surface = await waitForReadyComparison()
const canvas = surface.querySelector('canvas')
if (!(canvas instanceof HTMLCanvasElement) || canvas.width <= 0 || canvas.height <= 0) {
  throw new Error('GPU comparison did not allocate a visible canvas')
}
for (const label of ['MSDF', 'Slug', 'Delta ×8 · red MSDF / cyan Slug']) {
  if (!surface.textContent?.includes(label)) throw new Error(`${label} comparison panel is missing`)
}
const comparisonInput = document.querySelector<HTMLTextAreaElement>('textarea')
const setTextareaValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)?.set
if (comparisonInput === null || setTextareaValue === undefined) {
  throw new Error('Comparison text input is missing')
}
const authoredText = 'MSDF ↔ Slug\nAVATAR ffi 0123456789'
setTextareaValue.call(comparisonInput, authoredText)
comparisonInput.dispatchEvent(new Event('input', { bubbles: true }))
if (surface.dataset.comparisonText !== authoredText) {
  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (surface.dataset.comparisonText !== authoredText) return
      observer.disconnect()
      resolve()
    })
    observer.observe(surface, { attributes: true, attributeFilter: ['data-comparison-text'] })
  })
}

const pipeline = workloadButton('Pipeline accuracy')
const switchStartedAt = performance.now()
pipeline.click()
await waitForHeading('Pipeline accuracy')
const switchElapsedMs = performance.now() - switchStartedAt
const finiteSurface = await waitForElement('[data-testid="conformance-surface"]')
if (finiteSurface.dataset.conformanceReady !== 'false') {
  throw new Error('Finite CPU conformance started before the explicit run action')
}

const runButton = document.querySelector<HTMLButtonElement>('button[aria-label="Run conformance"]')
if (runButton === null || runButton.disabled)
  throw new Error('Explicit conformance action is unavailable')
runButton.click()
workloadButton('MSDF / Slug compare').click()
await waitForHeading('MSDF / Slug compare')
const liveAction = document.querySelector<HTMLButtonElement>(
  'button[aria-label="Live GPU comparison"]',
)
if (liveAction === null) throw new Error('Live comparison action is missing')
if (liveAction.textContent?.includes('Running') === true) {
  await new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      if (liveAction.textContent?.includes('Running') === true) return
      observer.disconnect()
      resolve()
    })
    observer.observe(liveAction, { childList: true, subtree: true, characterData: true })
  })
}
workloadButton('Pipeline accuracy').click()
await waitForHeading('Pipeline accuracy')
const postRunSurface = await waitForElement('[data-testid="conformance-surface"]')
if (postRunSurface.dataset.conformanceReady !== 'false') {
  throw new Error('A completed run crossed workloads and started the finite CPU capture')
}

workloadButton('MSDF / Slug compare').click()
await waitForHeading('MSDF / Slug compare')
surface = await waitForReadyComparison()
const zoom = document.querySelector<HTMLInputElement>('input[type="range"][min="1"][max="8"]')
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
if (zoom === null || setInputValue === undefined)
  throw new Error('Comparison zoom control is missing')
setInputValue.call(zoom, '4')
zoom.dispatchEvent(new Event('input', { bubbles: true }))
const updatedCanvas = surface.querySelector('canvas')
if (!(updatedCanvas instanceof HTMLCanvasElement)) throw new Error('Comparison canvas was replaced')
await new Promise<void>((resolve) => {
  if (updatedCanvas.dataset.zoom === '4') {
    resolve()
    return
  }
  const observer = new MutationObserver(() => {
    if (updatedCanvas.dataset.zoom !== '4') return
    observer.disconnect()
    resolve()
  })
  observer.observe(updatedCanvas, { attributes: true, attributeFilter: ['data-zoom'] })
})

console.log(
  'raster-technique-compare-ready',
  JSON.stringify({
    backend: new URL(location.href).searchParams.get('backend'),
    dpr: new URL(location.href).searchParams.get('dpr'),
    switchElapsedMs,
    width: updatedCanvas.width,
    height: updatedCanvas.height,
    text: surface.dataset.comparisonText,
    zoom: updatedCanvas.dataset.zoom,
  }),
)
