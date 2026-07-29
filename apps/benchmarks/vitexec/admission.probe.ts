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
if (!scene.textContent?.includes('Benchmark ipsum'))
  throw new Error('Human default is not the live benchmark control plane')

const executionPath = '/src/benchmark/execution.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ executionPath),
  import(/* @vite-ignore */ environmentPath),
])
const environment = await environmentResource()

const completions: string[] = []
for (let execution = 0; execution < 10; execution += 1) {
  const result = await runRegisteredBenchmark({
    targetId: 'synthetic',
    scenarioId: 'overview',
    input: {},
    controls: { dpr: 1, samples: 32, warmup: 4 },
    environment,
  })
  if (result.validation !== '32/32 deterministic outputs') {
    throw new Error(`Execution ${execution} did not publish its deterministic validation`)
  }
  completions.push(result.executionId)
  console.log(
    'admission-execution',
    JSON.stringify({
      execution,
      completion: completions.at(-1),
      actionSettled: true,
    }),
  )
}

console.log(
  'admission-lifecycle',
  JSON.stringify({
    schemaVersion: 0,
    executions: completions.length,
    uniqueCompletions: new Set(completions).size,
    environment,
  }),
)

export {}
