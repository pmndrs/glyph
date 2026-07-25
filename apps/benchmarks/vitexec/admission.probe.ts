function buttonByText(value: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === value,
  )
  if (button === undefined) throw new Error(`Missing button with text ${value}`)
  return button
}

function waitForButton(value: string): Promise<HTMLButtonElement> {
  try {
    return Promise.resolve(buttonByText(value))
  } catch {
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        try {
          const button = buttonByText(value)
          observer.disconnect()
          resolve(button)
        } catch {
          // The owning React tree has not published the control yet.
        }
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
    })
  }
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

function waitForCompletion(scene: HTMLElement, previous: string | undefined): Promise<string> {
  const current = scene.dataset.completedAt
  if (current !== undefined && current !== previous) return Promise.resolve(current)
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const completedAt = scene.dataset.completedAt
      if (completedAt === undefined || completedAt === previous) return
      observer.disconnect()
      resolve(completedAt)
    })
    observer.observe(scene, { attributes: true, attributeFilter: ['data-completed-at'] })
  })
}

function waitForActionSettled(button: HTMLButtonElement): Promise<void> {
  if (!button.disabled && button.textContent?.trim() === 'Run suite') return Promise.resolve()
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (button.disabled || button.textContent?.trim() !== 'Run suite') return
      observer.disconnect()
      resolve()
    })
    observer.observe(button, { attributes: true, childList: true, subtree: true })
  })
}

const scene = await waitForElement('[data-testid="scene"]')
if (!scene.textContent?.includes('Runner contract'))
  throw new Error('Synthetic target is not visible')

const completions: string[] = []
for (let execution = 0; execution < 10; execution += 1) {
  const previous = scene.dataset.completedAt
  const run = await waitForButton('Run suite')
  if (run.disabled) throw new Error(`Run button was disabled before execution ${execution}`)
  const completion = waitForCompletion(scene, previous)
  run.click()
  completions.push(await completion)
  await waitForActionSettled(run)
  console.log(
    'admission-execution',
    JSON.stringify({
      execution,
      completion: completions.at(-1),
      actionSettled: !run.disabled,
    }),
  )
  if (!scene.textContent?.includes('32/32 deterministic outputs')) {
    throw new Error(`Execution ${execution} did not publish its deterministic validation`)
  }
}

const environmentPath = '/src/benchmark/environment.ts'
const { environmentResource } = await import(/* @vite-ignore */ environmentPath)
console.log(
  'admission-lifecycle',
  JSON.stringify({
    schemaVersion: 0,
    executions: completions.length,
    uniqueCompletions: new Set(completions).size,
    environment: await environmentResource(),
  }),
)

export {}
