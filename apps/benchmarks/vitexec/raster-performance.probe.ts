export {}

const environmentPath = '/src/benchmark/environment.ts'
const packageSizesPath = '/src/generated/package-sizes.json'
const [{ environmentResource }, { default: packageSizes }] = await Promise.all([
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ packageSizesPath),
])

const observations: Array<Record<string, number | string | boolean>> = []
for (const technique of ['bitmap', 'mtsdf'] as const) {
  console.log('raster-performance-selecting', technique)
  if (technique === 'mtsdf') (await enabledButton('MSDF')).click()
  const viewport = await observeUntil(document.documentElement, () => {
    const candidate = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"]',
    )
    return candidate?.dataset.technique === technique &&
      candidate.dataset.workload === 'paint-effects' &&
      numberAttribute(candidate, 'data-gpu-history-length') >= 12 &&
      candidate.dataset.uploadFrameGpuMs !== undefined
      ? candidate
      : undefined
  })
  observations.push({
    technique,
    rendererInitMs: numberAttribute(viewport, 'data-renderer-init-ms'),
    fontLoadMs: numberAttribute(viewport, 'data-font-load-ms'),
    textReadyMs: numberAttribute(viewport, 'data-text-ready-ms'),
    firstDrawSubmitMs: numberAttribute(viewport, 'data-first-draw-ms'),
    uploadFrameGpuMs: numberAttribute(viewport, 'data-upload-frame-gpu-ms'),
    startupMs: numberAttribute(viewport, 'data-startup-ms'),
    framesPerSecond: numberAttribute(viewport, 'data-frames-per-second'),
    medianSubmitMs: numberAttribute(viewport, 'data-median-submit-ms'),
    p95SubmitMs: numberAttribute(viewport, 'data-p95-submit-ms'),
    medianGpuMs: numberAttribute(viewport, 'data-median-gpu-ms'),
    p95GpuMs: numberAttribute(viewport, 'data-p95-gpu-ms'),
    glyphCount: numberAttribute(viewport, 'data-glyph-count'),
    drawCount: numberAttribute(viewport, 'data-draw-count'),
    artifactBytes: numberAttribute(viewport, 'data-artifact-bytes'),
    atlasGpuBytes: numberAttribute(viewport, 'data-atlas-gpu-bytes'),
    totalGpuBytes: numberAttribute(viewport, 'data-total-gpu-bytes'),
  })
  console.log('raster-performance-observed', technique)
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
console.log(
  'raster-performance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'raster-performance-observation',
    capturedAt: new Date().toISOString(),
    backend: 'webgpu',
    dpr: 1,
    workload: 'paint-effects',
    steadyStateReportCount: 12,
    environment: await environmentResource(),
    gpuAdapter: gpuAdapter?.info,
    observations,
    bundleIsolation: packageSizes.entries
      .filter(({ id }: { readonly id: string }) =>
        [
          'browser-core',
          'text-shaper-wasm',
          'bitmap-runtime-js',
          'mtsdf-runtime-js',
          'bitmap-baker-wasm',
          'mtsdf-baker-wasm',
        ].includes(id),
      )
      .map(
        ({
          id,
          rawBytes,
          gzipBytes,
          brotliBytes,
        }: {
          readonly id: string
          readonly rawBytes: number
          readonly gzipBytes: number
          readonly brotliBytes: number
        }) => ({ id, rawBytes, gzipBytes, brotliBytes }),
      ),
  }),
)

function enabledButton(label: string, includes = false): Promise<HTMLButtonElement> {
  return observeUntil(document.documentElement, () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        !button.disabled &&
        (includes ? button.textContent?.includes(label) : button.textContent?.trim() === label),
    ),
  )
}

function numberAttribute(element: HTMLElement, name: string): number {
  const value = Number(element.getAttribute(name))
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} is not a finite metric`)
  return value
}

function observeUntil<T>(root: Node, read: () => T | undefined): Promise<T> {
  const current = read()
  if (current !== undefined) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = read()
      if (value === undefined) return
      observer.disconnect()
      resolve(value)
    })
    observer.observe(root, { attributes: true, childList: true, subtree: true })
  })
}
