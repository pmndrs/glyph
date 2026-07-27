import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  SELECTABLE_FONT_FIXTURES,
  benchmarkIpsumForFont,
  conformanceTextForFont,
  selectableFontFixture,
} from './font-fixtures'

interface ImmutableFontFixture {
  readonly directory: string
  readonly expected: {
    readonly id: string
    readonly family: string
    readonly version: string
    readonly glyphCount: number
    readonly outlineFormat: string
  }
}

const fixtureRoot = new URL('../../fixtures/fonts/', import.meta.url)
const fixtures: readonly ImmutableFontFixture[] = [
  {
    directory: 'source-serif-4.005/',
    expected: {
      id: 'source-serif-4-regular-v0',
      family: 'Source Serif 4',
      version: '4.005',
      glyphCount: 1464,
      outlineFormat: 'truetype',
    },
  },
  {
    directory: 'dancing-script-3.000/',
    expected: {
      id: 'dancing-script-regular-v0',
      family: 'Dancing Script',
      version: '3.000',
      glyphCount: 1017,
      outlineFormat: 'cff',
    },
  },
]

describe.each(fixtures)('$expected.family fixture', ({ directory, expected }) => {
  it('authenticates its immutable font and license bytes', async () => {
    const fixtureDirectory = new URL(directory, fixtureRoot)
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', fixtureDirectory), 'utf8'),
    ) as {
      readonly schemaVersion: number
      readonly id: string
      readonly source: {
        readonly family: string
        readonly version: string
        readonly fontFile: string
        readonly fontBytes: number
        readonly fontSha256: string
        readonly licenseFile: string
        readonly licenseBytes: number
        readonly licenseSha256: string
      }
      readonly face: {
        readonly fontIndex: number
        readonly variations: Readonly<Record<string, number>>
        readonly glyphCount: number
        readonly outlineFormat: string
      }
    }
    const [font, license] = await Promise.all([
      readFile(new URL(manifest.source.fontFile, fixtureDirectory)),
      readFile(new URL(manifest.source.licenseFile, fixtureDirectory)),
    ])

    expect(manifest).toMatchObject({
      schemaVersion: 0,
      id: expected.id,
      source: {
        family: expected.family,
        version: expected.version,
        license: 'OFL-1.1',
      },
      face: {
        fontIndex: 0,
        variations: {},
        glyphCount: expected.glyphCount,
        outlineFormat: expected.outlineFormat,
      },
    })
    expect(font.byteLength).toBe(manifest.source.fontBytes)
    expect(createHash('sha256').update(font).digest('hex')).toBe(manifest.source.fontSha256)
    expect(license.byteLength).toBe(manifest.source.licenseBytes)
    expect(createHash('sha256').update(license).digest('hex')).toBe(manifest.source.licenseSha256)
  })
})

describe('human-selectable font fixtures', () => {
  it('keeps one explicit sans, serif, and script choice', () => {
    expect(SELECTABLE_FONT_FIXTURES.map(({ id }) => id)).toEqual([
      'inter',
      'source-serif-4',
      'dancing-script',
    ])
  })

  it('narrows UI values without a type assertion', () => {
    expect(selectableFontFixture('source-serif-4')).toBe('source-serif-4')
    expect(() => selectableFontFixture('unknown')).toThrow('Unknown selectable font fixture')
  })

  it('uses a Latin-only long and finite corpus for the script face', () => {
    expect(benchmarkIpsumForFont('dancing-script')).not.toContain('∞')
    expect(benchmarkIpsumForFont('dancing-script').length).toBeGreaterThan(900)
    expect(conformanceTextForFont('dancing-script')).not.toContain('π')
    expect(benchmarkIpsumForFont('source-serif-4')).toContain('π')
  })
})
