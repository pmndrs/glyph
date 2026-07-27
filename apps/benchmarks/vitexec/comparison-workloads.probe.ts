const WORKLOADS = [
  { label: 'Text ladder', id: 'text-ladder' },
  { label: 'Off-axis / 3D', id: 'off-axis-3d', amountLabel: 'Perspective intensity' },
  { label: 'Dynamic layout', id: 'dynamic-layout', amountLabel: 'Reflow amplitude' },
  { label: 'Paragraph stress', id: 'paragraph-stress', amountLabel: 'Text volume' },
  { label: 'Paint & effects', id: 'paint-effects', amountLabel: 'Hue spread' },
] as const

for (const technique of ['bitmap', 'mtsdf'] as const) {
  await clickButton(technique === 'mtsdf' ? 'MSDF' : 'bitmap', true)
  for (const workload of WORKLOADS) {
    await clickButton(workload.label, false)
    let viewport = await waitForReadyViewport(technique, workload.id)

    if (workload.id !== 'text-ladder') {
      const revision = numericAttribute(viewport, 'data-configuration-revision')
      assertRangeVisualTravel(rangeControl('Rendered size'))
      const renderedSize = setDifferentRange('Rendered size', technique === 'mtsdf' ? 52 : 28)
      viewport = await waitForViewportAttribute(
        technique,
        workload.id,
        'data-rendered-device-px',
        String(renderedSize),
      )
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision)
    }

    if ('amountLabel' in workload) {
      const revision = numericAttribute(viewport, 'data-configuration-revision')
      const amount = setDifferentRange(workload.amountLabel, 72)
      await waitForAttribute(viewport, 'data-workload-amount', String(amount))
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision)
    }

    if (workload.id === 'dynamic-layout') {
      const reflowCount = numericAttribute(viewport, 'data-reflow-count')
      setRange('Layout width', 64)
      setCheckbox('Animate', false)
      await waitForAttribute(viewport, 'data-animation-enabled', 'false')
      console.log('dynamic-layout-animation-paused', technique)
      const speed = setDifferentRange('Animation speed', 37)
      await waitForAttribute(viewport, 'data-animation-speed', String(speed))
      console.log('dynamic-layout-speed-applied', technique)
      setCheckbox('Animate', true)
      await waitForAttribute(viewport, 'data-animation-enabled', 'true')
      console.log('dynamic-layout-animation-resumed', technique)
      await waitForGreaterAttribute(viewport, 'data-reflow-count', reflowCount)
      if (numericAttribute(viewport, 'data-reflow-ms') <= 0) {
        throw new Error('Dynamic layout did not publish a measured asynchronous reflow')
      }
    }

    if (workload.id === 'paint-effects') {
      const revision = numericAttribute(viewport, 'data-configuration-revision')
      const opacity = setDifferentRange('Opacity', 68)
      await waitForAttribute(viewport, 'data-paint-opacity', String(opacity / 100))
      await waitForGreaterAttribute(viewport, 'data-configuration-revision', revision)
      const stroke = rangeControl('Stroke width')
      if (technique === 'bitmap') {
        if (!stroke.disabled || stroke.value !== '0') {
          throw new Error('Bitmap Paint & Effects exposed an active stroke control')
        }
      } else {
        if (stroke.disabled) throw new Error('MSDF Paint & Effects disabled its stroke control')
        const strokeRevision = numericAttribute(viewport, 'data-configuration-revision')
        setRange('Stroke width', 61)
        await waitForAttribute(viewport, 'data-paint-stroke-width', '0.61')
        await waitForGreaterAttribute(viewport, 'data-configuration-revision', strokeRevision)
      }
    }
    console.log('comparison-workload-ready', technique, workload.id)
  }
}

console.log('comparison-workloads-ready', JSON.stringify({ techniques: 2, workloads: 5 }))

async function clickButton(label: string, exact: boolean): Promise<void> {
  const find = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => {
      const content = candidate.textContent?.trim() ?? ''
      return !candidate.disabled && (exact ? content === label : content.includes(label))
    })
  const button = find() ?? (await observeDocument(find))
  button.click()
}

function rangeControl(label: string): HTMLInputElement {
  const control = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.includes(label) === true,
  )
  if (control === undefined) throw new Error(`${label} range control is unavailable`)
  return control
}

function assertRangeVisualTravel(control: HTMLInputElement): void {
  const style = getComputedStyle(control)
  const shell = control.parentElement
  if (shell === null || !shell.classList.contains('range-shell')) {
    throw new Error('Range control is missing its filled-track surface')
  }
  if (style.paddingLeft !== '0px' || style.paddingRight !== '0px') {
    throw new Error('Range control retains padding that creates false endpoint space')
  }
  if (style.getPropertyValue('--range-track-inset').trim() !== '7px') {
    throw new Error('Range control does not align its visible track with the thumb-center travel')
  }
  const progress = Number(getComputedStyle(shell).getPropertyValue('--range-progress'))
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error('Range control fill does not represent its current value')
  }
  if (getComputedStyle(shell, '::before').backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error('Range control has no visible neutral rail')
  }
  if (getComputedStyle(shell, '::after').backgroundColor === 'rgba(0, 0, 0, 0)') {
    throw new Error('Range control has no visible value fill')
  }
}

function setRange(label: string, value: number): void {
  const control = rangeControl(label)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter === undefined) throw new Error('Native input value setter is unavailable')
  setter.call(control, String(value))
  control.dispatchEvent(new Event('input', { bubbles: true }))
}

function setDifferentRange(label: string, preferred: number): number {
  const control = rangeControl(label)
  const current = control.valueAsNumber
  const alternative = preferred < Number(control.max) ? preferred + 1 : preferred - 1
  const value = current === preferred ? alternative : preferred
  setRange(label, value)
  return value
}

function setCheckbox(label: string, checked: boolean): void {
  const control = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  )
  if (control === undefined) throw new Error(`${label} checkbox is unavailable`)
  if (control.checked !== checked) control.click()
}

function readyViewport(technique: 'bitmap' | 'mtsdf', workload: string): HTMLElement | undefined {
  const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]')
  if (
    viewport === null ||
    viewport.getAttribute('data-technique') !== technique ||
    viewport.getAttribute('data-workload') !== workload ||
    viewport.getAttribute('data-missing-glyph-count') !== '0' ||
    positiveAttribute(viewport, 'data-glyph-count') === false ||
    positiveAttribute(viewport, 'data-draw-count') === false ||
    positiveAttribute(viewport, 'data-submit-history-length') === false
  ) {
    return undefined
  }
  const gpuTiming = viewport.getAttribute('data-gpu-timing-supported')
  if (gpuTiming !== 'true' && gpuTiming !== 'false') return undefined
  return viewport
}

function waitForReadyViewport(
  technique: 'bitmap' | 'mtsdf',
  workload: string,
): Promise<HTMLElement> {
  const current = readyViewport(technique, workload)
  if (current !== undefined) return Promise.resolve(current)
  return observeDocument(() => readyViewport(technique, workload))
}

function waitForViewportAttribute(
  technique: 'bitmap' | 'mtsdf',
  workload: string,
  name: string,
  value: string,
): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => {
    const viewport = readyViewport(technique, workload)
    return viewport?.getAttribute(name) === value ? viewport : undefined
  }
  const current = find()
  return current === undefined ? observeDocument(find) : Promise.resolve(current)
}

function waitForAttribute(element: HTMLElement, name: string, value: string): Promise<void> {
  if (element.getAttribute(name) === value) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (element.getAttribute(name) !== value) return
      observer.disconnect()
      resolve()
    })
    observer.observe(element, { attributes: true, attributeFilter: [name] })
  })
}

function waitForGreaterAttribute(
  element: HTMLElement,
  name: string,
  previous: number,
): Promise<void> {
  if (numericAttribute(element, name) > previous) return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (numericAttribute(element, name) <= previous) return
      observer.disconnect()
      resolve()
    })
    observer.observe(element, { attributes: true, attributeFilter: [name] })
  })
}

function observeDocument<Element extends HTMLElement>(
  find: () => Element | undefined,
): Promise<Element> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const value = find()
      if (value === undefined) return
      observer.disconnect()
      resolve(value)
    })
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    })
  })
}

function positiveAttribute(element: HTMLElement, name: string): boolean {
  const value = Number(element.getAttribute(name))
  return Number.isFinite(value) && value > 0
}

function numericAttribute(element: HTMLElement, name: string): number {
  const value = Number(element.getAttribute(name))
  if (!Number.isFinite(value)) throw new Error(`${name} is not a finite renderer measurement`)
  return value
}

export {}
