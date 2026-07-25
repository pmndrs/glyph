import { createFontBaker, type FontBaker } from '@pmndrs/text-font-baker'
import wasmUrl from '@pmndrs/text-font-baker/font-baker.wasm?url'
import type { BenchmarkTarget } from './contracts'

function stableSyntheticHash(sample: number): string {
  let value = 2166136261
  for (let index = 0; index < 4096; index += 1) {
    value = Math.imul(value ^ ((index + sample) & 0xff), 16777619)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

const syntheticTarget: BenchmarkTarget = {
  id: 'synthetic',
  label: 'Runner contract',
  detail: 'deterministic · CPU',
  color: 'violet',
  capabilities: new Set(['deterministic']),
  status: () => 'ready',
  load: async () => undefined,
  run: async (_input, sample) => ({ bytes: 4096, hash: stableSyntheticHash(sample) }),
  dispose: async () => undefined,
}

let baker: FontBaker | undefined
const bakerTarget: BenchmarkTarget = {
  id: 'font-baker',
  label: 'Rust font baker',
  detail: 'Wasm · direct memory ABI',
  color: 'green',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm']),
  status: (input) => (input.fontBytes === undefined ? 'needs-fixture' : 'ready'),
  load: async () => {
    if (baker !== undefined) return
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`Unable to load font baker Wasm (${response.status})`)
    baker = await createFontBaker(await response.arrayBuffer())
  },
  run: async (input) => {
    if (baker === undefined) throw new Error('Font baker target was not loaded')
    if (input.fontBytes === undefined)
      throw new Error('Select a font fixture before running the baker')
    const result = baker.bakeFont(input.fontBytes)
    const artifact = result.artifacts[0]
    if (artifact === undefined) throw new Error('Font baker returned no artifact')
    return { bytes: artifact.bytes.byteLength, hash: artifact.sha256 }
  },
  dispose: async () => undefined,
}

function unavailableTarget(
  id: string,
  label: string,
  detail: string,
  color: BenchmarkTarget['color'],
): BenchmarkTarget {
  return {
    id,
    label,
    detail,
    color,
    capabilities: new Set(['raster']),
    status: () => 'unavailable',
    load: async () => {
      throw new Error(`${label} is not implemented yet`)
    },
    run: async () => {
      throw new Error(`${label} is not implemented yet`)
    },
    dispose: async () => undefined,
  }
}

export const targets: readonly BenchmarkTarget[] = [
  syntheticTarget,
  bakerTarget,
  unavailableTarget('bitmap', 'Bitmap atlas', 'capability not landed', 'amber'),
  unavailableTarget('msdf', 'MSDF atlas', 'capability not landed', 'cyan'),
  unavailableTarget('slug', 'Three Flatland Slug', 'adapter not landed', 'green'),
]

export function targetById(id: string): BenchmarkTarget {
  return targets.find((target) => target.id === id) ?? syntheticTarget
}
