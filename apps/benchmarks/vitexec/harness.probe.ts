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

export {}
