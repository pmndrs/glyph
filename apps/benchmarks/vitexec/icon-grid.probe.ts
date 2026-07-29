type Technique = 'bitmap' | 'mtsdf' | 'slug'

export {}

const techniqueLabels: Readonly<Record<Technique, string>> = {
  bitmap: 'Bitmap',
  mtsdf: 'MSDF',
  slug: 'Slug',
}

function numberAttribute(element: HTMLElement, name: string): number {
  const value = Number(element.getAttribute(name))
  if (!Number.isFinite(value)) throw new Error(`${name} is not finite`)
  return value
}

async function waitFor(
  predicate: () => HTMLElement | undefined,
  message: string,
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 1_800; attempt += 1) {
    const result = predicate()
    if (result !== undefined) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

async function click(label: string): Promise<void> {
  const button = await waitFor(() => {
    const candidate = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (current) => current.textContent?.trim().startsWith(label) === true && !current.disabled,
    )
    return candidate
  }, `${label} button is unavailable`)
  button.click()
}

async function ready(technique: Technique): Promise<HTMLElement> {
  return waitFor(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]')
    return viewport?.getAttribute('data-workload') === 'icon-grid' &&
      viewport.getAttribute('data-technique') === technique &&
      viewport.getAttribute('data-missing-glyph-count') === '0'
      ? viewport
      : undefined
  }, `${technique} icon grid did not become ready`)
}

await click('Icon grid')

for (const technique of ['bitmap', 'mtsdf', 'slug'] as const) {
  await click(techniqueLabels[technique])
  const viewport = await ready(technique)
  if (
    numberAttribute(viewport, 'data-icon-item-count') !== 1_402 ||
    numberAttribute(viewport, 'data-icon-label-count') !== 1_402 ||
    numberAttribute(viewport, 'data-icon-column-count') !== 38 ||
    numberAttribute(viewport, 'data-icon-row-count') !== 37 ||
    numberAttribute(viewport, 'data-icon-label-size') !== 11 ||
    numberAttribute(viewport, 'data-icon-first-visible-index') !== 0
  ) {
    throw new Error(`${technique} icon catalog contract is invalid`)
  }
  const poolCapacity = numberAttribute(viewport, 'data-icon-pool-capacity')
  if (poolCapacity <= 0 || poolCapacity >= 1_402) {
    throw new Error(`${technique} icon pool is not virtualized`)
  }
  const maximumScrollX = numberAttribute(viewport, 'data-icon-maximum-scroll-x')
  const maximumScrollY = numberAttribute(viewport, 'data-icon-maximum-scroll-y')
  const recycleCount = numberAttribute(viewport, 'data-icon-recycle-count')
  if (maximumScrollX <= 0 || maximumScrollY <= 0) {
    throw new Error(`${technique} grid is not two-dimensionally pannable`)
  }
  const canvas = viewport.querySelector<HTMLCanvasElement>('canvas[data-pan-enabled="true"]')
  if (canvas === null) throw new Error(`${technique} canvas is unavailable`)
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    }),
  )
  canvas.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      button: 0,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: -maximumScrollX,
      clientY: -maximumScrollY,
    }),
  )
  canvas.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      button: 0,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: -maximumScrollX,
      clientY: -maximumScrollY,
    }),
  )
  await waitFor(
    () =>
      numberAttribute(viewport, 'data-icon-last-visible-index') === 1_401 &&
      numberAttribute(viewport, 'data-icon-recycle-count') > recycleCount
        ? viewport
        : undefined,
    `${technique} did not recycle through the final icon`,
  )
  if (
    numberAttribute(viewport, 'data-icon-scroll-x') !== maximumScrollX ||
    numberAttribute(viewport, 'data-icon-scroll-y') !== maximumScrollY
  ) {
    throw new Error(`${technique} did not clamp at the bottom-right grid edge`)
  }
  canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await waitFor(
    () =>
      numberAttribute(viewport, 'data-icon-first-visible-index') === 0 &&
      numberAttribute(viewport, 'data-icon-scroll-x') === 0 &&
      numberAttribute(viewport, 'data-icon-scroll-y') === 0
        ? viewport
        : undefined,
    `${technique} did not reset to the top-left icon`,
  )
  console.log(
    'virtual-icon-grid-ready',
    JSON.stringify({ technique, poolCapacity, maximumScrollX, maximumScrollY }),
  )
}
