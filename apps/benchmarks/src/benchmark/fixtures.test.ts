import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

interface Glyph {
  glyphId: number
  cluster: number
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
  flags: number
}

interface Oracle {
  engine: { name: string; version: string }
  cases: { id: string; glyphs: Glyph[] }[]
}

const fixtureRoot = new URL('../../fixtures/', import.meta.url)

describe('canonical Inter fixtures', () => {
  it('binds checked-in font and license bytes to their manifest hashes', async () => {
    const directory = new URL('fonts/inter-v4.1/', fixtureRoot)
    const [manifestSource, font, license] = await Promise.all([
      readFile(new URL('manifest.json', directory), 'utf8'),
      readFile(new URL('Inter-Regular.ttf', directory)),
      readFile(new URL('LICENSE.txt', directory)),
    ])
    const manifest = JSON.parse(manifestSource)

    expect(font.byteLength).toBe(manifest.source.fontBytes)
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.source.fontSha256)
    expect(createHash('sha256').update(license).digest('hex')).toBe(manifest.source.licenseSha256)
  })

  it('keeps HarfRust and HarfBuzz core shaping equal and makes accepted flag deltas explicit', async () => {
    const directory = new URL('shaping/inter-regular/', fixtureRoot)
    const [harfrust, harfbuzz] = (await Promise.all(
      ['harfrust.json', 'harfbuzz.json'].map(async (name) =>
        JSON.parse(await readFile(new URL(name, directory), 'utf8')),
      ),
    )) as [Oracle, Oracle]

    expect(harfrust.engine).toMatchObject({ name: 'HarfRust', version: '0.12.0' })
    expect(harfbuzz.engine).toMatchObject({ name: 'HarfBuzz', version: '13.0.0' })
    expect(harfrust.cases.map(({ id }) => id)).toEqual(harfbuzz.cases.map(({ id }) => id))

    const flagDeltas: string[] = []
    for (const [caseIndex, rustCase] of harfrust.cases.entries()) {
      const buzzCase = harfbuzz.cases[caseIndex]
      expect(buzzCase?.glyphs).toHaveLength(rustCase.glyphs.length)
      for (const [glyphIndex, rustGlyph] of rustCase.glyphs.entries()) {
        const buzzGlyph = buzzCase?.glyphs[glyphIndex]
        expect(buzzGlyph).toBeDefined()
        const { flags: rustFlags, ...rustCore } = rustGlyph
        const { flags: buzzFlags, ...buzzCore } = buzzGlyph as Glyph
        expect(rustCore).toEqual(buzzCore)
        if (rustFlags !== buzzFlags) {
          flagDeltas.push(`${rustCase.id}:${glyphIndex}:${rustFlags}->${buzzFlags}`)
        }
      }
    }

    expect(flagDeltas).toEqual(['paragraph:14:0->2', 'paragraph:26:0->2', 'combining-mark:0:0->2'])
  })

  it('binds the HTML/CSS reference metadata to the captured PNG', async () => {
    const directory = new URL('visual/inter-regular/', fixtureRoot)
    const [metadataSource, image] = await Promise.all([
      readFile(new URL('browser-html.json', directory), 'utf8'),
      readFile(new URL('browser-html.png', directory)),
    ])
    const metadata = JSON.parse(metadataSource)

    expect(metadata.browser).toEqual({
      engine: 'chromium',
      version: '149.0.7827.55',
      playwright: '1.61.1',
      headless: true,
    })
    expect(image.byteLength).toBe(metadata.image.bytes)
    expect(createHash('sha256').update(image).digest('hex')).toBe(metadata.image.sha256)
  })

  it('records the browser shaping conformance and one-call memory evidence', async () => {
    const result = JSON.parse(
      await readFile(new URL('results/shaping-conformance-chromium149.json', fixtureRoot), 'utf8'),
    )

    expect(result).toMatchObject({
      schemaVersion: 0,
      targetId: 'harfrust-shaper',
      scenarioId: 'shaping-conformance',
      status: 'passed',
      controls: { samples: 3, warmup: 1 },
    })
    expect(result.measurements).toHaveLength(3)
    expect(new Set(result.measurements.map(({ hash }: { hash: string }) => hash))).toEqual(
      new Set(['dc30c21c']),
    )
    expect(
      result.measurements.every(
        ({ metrics }: { metrics: Record<string, number> }) =>
          metrics.boundaryCrossings === 1 &&
          metrics.goldenCases === 8 &&
          metrics.glyphCount === 97 &&
          metrics.planCount === 3 &&
          metrics.retainedFontBytes === 171056,
      ),
    ).toBe(true)
  })

  it('records exact browser paragraph measurement with zero Wasm reflow calls', async () => {
    const result = JSON.parse(
      await readFile(
        new URL('results/paragraph-measurement-chromium149.json', fixtureRoot),
        'utf8',
      ),
    )

    expect(result).toMatchObject({
      targetId: 'paragraph-engine',
      scenarioId: 'paragraph-measurement',
      status: 'passed',
      outputBytes: 168,
    })
    expect(result.measurements).toHaveLength(3)
    expect(new Set(result.measurements.map(({ hash }: { hash: string }) => hash))).toEqual(
      new Set(['79874b9d']),
    )
    expect(
      result.measurements.every(
        ({ metrics }: { metrics: Record<string, number> }) =>
          metrics.shapeBoundaryCrossings === 1 &&
          metrics.reshapeBoundaryCrossings === 0 &&
          metrics.reflowBoundaryCrossings === 0 &&
          metrics.measurementCount === 3 &&
          metrics.positionedGlyphBytes === 0,
      ),
    ).toBe(true)
  })
})
