import type { BenchmarkEnvironment } from './contracts'

let cached: Promise<BenchmarkEnvironment> | undefined

export function environmentResource(): Promise<BenchmarkEnvironment> {
  cached ??= Promise.resolve({
    browser: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgpu: 'gpu' in navigator,
    crossOriginIsolated: globalThis.crossOriginIsolated,
  })
  return cached
}
