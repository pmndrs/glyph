import { defineFont } from '@pmndrs/text'
import { useFont } from '@pmndrs/text/react'
import { bitmap } from '@pmndrs/text/raster/bitmap'
import { act, createElement, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const originalFetch = globalThis.fetch
const fontUrl = '/fixtures/rendering/inter-bitmap-16.font.glb'
const requestedUrl = new URL(`${fontUrl}?react-suspense`, location.href).href
const gate = deferred()
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : new URL(String(input), location.href).href
  if (url !== requestedUrl) return originalFetch(input, init)
  await gate.promise
  init?.signal?.throwIfAborted()
  return originalFetch(fontUrl, init)
}

const font = defineFont(requestedUrl, bitmap({ strikes: [16] as const }))
const container = document.createElement('div')
document.body.append(container)
const root = createRoot(container)

function FontConsumer() {
  const loaded = useFont(font)
  return createElement(
    'output',
    { 'data-font-key': loaded.font.key, 'data-state': 'ready' },
    loaded.font.glyphCount,
  )
}

try {
  await act(async () => {
    root.render(
      createElement(
        Suspense,
        { fallback: createElement('output', { 'data-state': 'pending' }) },
        createElement(FontConsumer),
      ),
    )
  })
  if (
    container.querySelector('[data-state="pending"]') === null ||
    container.querySelector('[data-state="ready"]') !== null
  ) {
    throw new Error('React font resource did not enter its deterministic Suspense fallback')
  }

  const preload = useFont.preload(font)
  await act(async () => {
    gate.resolve()
    await preload
  })
  const output = container.querySelector('[data-state="ready"]')
  if (output?.textContent !== '2937' || output.getAttribute('data-font-key') === null) {
    throw new Error('React font resource did not leave Suspense with the canonical Inter font')
  }

  const loaded = await preload
  console.log(
    'react-font-suspense-ready',
    JSON.stringify({ fontKey: loaded.font.key, glyphCount: loaded.font.glyphCount }),
  )
  loaded.font.dispose()
  useFont.clear(font)
} finally {
  gate.resolve()
  await act(async () => root.unmount())
  container.remove()
  globalThis.fetch = originalFetch
  delete reactEnvironment.IS_REACT_ACT_ENVIRONMENT
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve() {
      resolvePromise?.()
    },
  }
}

export {}
