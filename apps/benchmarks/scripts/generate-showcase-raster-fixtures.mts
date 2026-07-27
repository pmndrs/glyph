import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { bitmapBaker } from '@pmndrs/text/bakers/bitmap'
import { bakeFont } from '@pmndrs/text/bake'

import manifest from '../fixtures/rendering/showcase-raster-fixtures-v0.json' with { type: 'json' }

const outputDirectory = resolve('fixtures/rendering')
const manifestOutput = resolve(outputDirectory, 'showcase-raster-fixtures-v0.json')
await mkdir(outputDirectory, { recursive: true })
const check = process.argv.includes('--check')
const temporaryDirectory = check
  ? await mkdtemp(join(tmpdir(), 'pmndrs-text-showcase-'))
  : undefined

const fixtures = [
  {
    fontFixture: 'inter',
    input: resolve('fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    output: 'inter-bitmap-16.font.glb',
  },
  {
    fontFixture: 'amiri',
    input: resolve('fixtures/fonts/amiri-1.002/Amiri-Regular.ttf'),
    output: 'amiri-bitmap-16.font.glb',
  },
  {
    fontFixture: 'noto-sans-devanagari',
    input: resolve('fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf'),
    output: 'noto-sans-devanagari-bitmap-16.font.glb',
  },
  {
    fontFixture: 'dot-gothic-16',
    input: resolve('fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf'),
    output: 'dot-gothic-16-bitmap-16.font.glb',
  },
  {
    fontFixture: 'noto-sans-cjk-showcase',
    input: resolve('fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf'),
    output: 'noto-sans-cjk-showcase-bitmap-16.font.glb',
  },
  {
    fontFixture: 'source-serif-4',
    input: resolve('fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf'),
    output: 'source-serif-4-bitmap-16.font.glb',
  },
  {
    fontFixture: 'dancing-script',
    input: resolve('fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf'),
    output: 'dancing-script-bitmap-16.font.glb',
  },
] as const

try {
  const artifacts = []
  for (const fixture of fixtures) {
    const output = resolve(temporaryDirectory ?? outputDirectory, fixture.output)
    const report = await bakeFont({
      input: fixture.input,
      output,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker: bitmapBaker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
          options: { strikes: [16] },
        },
      ],
    })
    const raster = report.rasters.find(({ kind }) => kind === 'bitmap')
    if (raster === undefined)
      throw new Error(`${fixture.fontFixture} bake omitted its bitmap report`)
    const generated = await readFile(output)
    const hash = createHash('sha256').update(generated).digest('hex')
    artifacts.push({
      fontFixture: fixture.fontFixture,
      file: fixture.output,
      bytes: generated.byteLength,
      sha256: hash,
      raster: {
        decodedGpuBytes: raster.gpuBytes,
        pages: raster.pages.map((page, index) => ({
          index,
          width: page.width,
          height: page.height,
          encodedBytes: page.encodedBytes,
          decodedGpuBytes: page.mipBytes,
        })),
      },
    })
    if (check) {
      const checkedIn = await readFile(resolve(outputDirectory, fixture.output))
      if (!generated.equals(checkedIn)) {
        throw new Error(`${fixture.output} is not byte-identical to a fresh package-owned bake`)
      }
    }
  }
  const generatedManifest = {
    schemaVersion: 0,
    strikePpem: 16,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    artifacts,
  }
  if (check) {
    if (JSON.stringify(generatedManifest) !== JSON.stringify(manifest)) {
      throw new Error('fresh showcase bitmap fixtures do not match their canonical manifest')
    }
  } else {
    await writeFile(manifestOutput, `${JSON.stringify(generatedManifest, undefined, 2)}\n`)
  }
} finally {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
