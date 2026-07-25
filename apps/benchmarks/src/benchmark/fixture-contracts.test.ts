import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

const contractRoot = new URL('../../fixtures/contracts/', import.meta.url)

async function contract(name: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(new URL(name, contractRoot), 'utf8'))
}

describe('milestone-one fixture contracts', () => {
  it('pins bitmap, paragraph, GLB, malformed-input, and GPU-readback source contracts', async () => {
    const [bitmap, paragraph, glb, malformed, gpu] = await Promise.all([
      contract('bitmap-strike-v0.json'),
      contract('paragraph-layout-v0.json'),
      contract('glb-v0.json'),
      contract('malformed-input-v0.json'),
      contract('gpu-readback-v0.json'),
    ])

    expect(bitmap.strike).toMatchObject({ recordStride: 20, gpuFormat: 'r8unorm' })
    expect(paragraph.constraints.map(({ width }: { width: number }) => width)).toEqual([720, 360])
    expect(glb.container).toMatchObject({ version: 2, alignment: 4, chunkOrder: ['JSON', 'BIN'] })
    expect(new Set(malformed.cases).size).toBe(malformed.cases.length)
    expect(malformed.mustNot).toContain('unbounded-allocation')
    expect(gpu.backends).toEqual(['webgpu', 'webgl2'])
    expect(gpu.status).toBe('capability-gated-until-renderer')
  })

  it('materializes the maximum dense record table with valid logical-page boundaries', async () => {
    const fixture = await contract('max-glyph-pages-v0.json')
    const records = new Uint8Array(fixture.glyphCount * fixture.recordStride)
    const view = new DataView(records.buffer)
    const absent = new Set<number>(fixture.absentGlyphIds)

    for (let glyphId = 0; glyphId < fixture.glyphCount; glyphId += 1) {
      const page = absent.has(glyphId)
        ? fixture.absenceSentinel
        : Math.floor(glyphId / fixture.pageCapacity)
      view.setUint16(glyphId * fixture.recordStride + 16, page, true)
    }

    expect(records.byteLength).toBe(fixture.expectedRecordBytes)
    expect(view.getUint16(16, true)).toBe(fixture.absenceSentinel)
    expect(view.getUint16(16383 * 20 + 16, true)).toBe(0)
    expect(view.getUint16(16384 * 20 + 16, true)).toBe(1)
    expect(view.getUint16(32768 * 20 + 16, true)).toBe(2)
    expect(view.getUint16(49152 * 20 + 16, true)).toBe(3)
    expect(view.getUint16(65534 * 20 + 16, true)).toBe(fixture.absenceSentinel)
    expect(fixture.resources.map(({ page }: { page: number }) => page)).toEqual([0, 1, 2, 3])
  })

  it('defines the identity-neutral empty multi-font/multi-raster state', async () => {
    const fixture = await contract('empty-identities-v0.json')

    expect(fixture.fontHandles).toEqual([])
    expect(fixture.rasterBindings).toEqual([])
    expect(fixture.drawBatches).toEqual([])
    expect(fixture.assertions).toEqual({
      fontCount: 0,
      rasterCount: 0,
      batchCount: 0,
      crossFontGlyphAliasing: false,
    })
  })

  it('keeps the admission record bound to the exact causal probe', async () => {
    const record = JSON.parse(
      await readFile(new URL('../../fixtures/admission/harness-v0.json', import.meta.url), 'utf8'),
    )
    const probe = await readFile(new URL('../../vitexec/admission.probe.ts', import.meta.url))

    expect(createHash('sha256').update(probe).digest('hex')).toBe(record.probe.sha256)
    expect(record.policy).toEqual({
      retries: 0,
      executions: 100,
      freshBrowserServerLifecycles: 10,
      executionsPerLifecycle: 10,
    })
    expect(record.lifecycles).toHaveLength(10)
    expect(
      record.lifecycles.every(
        (lifecycle: { executions: number; uniqueCompletions: number }) =>
          lifecycle.executions === 10 && lifecycle.uniqueCompletions === 10,
      ),
    ).toBe(true)
    expect(record.capabilityClaim.gpuWorkload).toBe(false)
  })
})
