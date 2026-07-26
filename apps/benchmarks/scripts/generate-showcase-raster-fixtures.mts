import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { bitmapBaker } from '@pmndrs/text/bakers/bitmap'
import { bakeFont } from '@pmndrs/text/bake'

import manifest from '../fixtures/rendering/showcase-raster-fixtures-v0.json' with { type: 'json' }

const outputDirectory = resolve('fixtures/rendering')
await mkdir(outputDirectory, { recursive: true })
const check = process.argv.includes('--check')
const temporaryDirectory = check
  ? await mkdtemp(join(tmpdir(), 'pmndrs-text-showcase-'))
  : undefined

const fixtures = [
  {
    input: resolve('fixtures/fonts/amiri-1.002/Amiri-Regular.ttf'),
    output: 'amiri-bitmap-16.font.glb',
  },
  {
    input: resolve('fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf'),
    output: 'noto-sans-devanagari-bitmap-16.font.glb',
  },
  {
    input: resolve('fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf'),
    output: 'dot-gothic-16-bitmap-16.font.glb',
  },
] as const

try {
  for (const fixture of fixtures) {
    const output = resolve(temporaryDirectory ?? outputDirectory, fixture.output)
    await bakeFont({
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
    if (!check) continue
    const expected = manifest.artifacts.find((artifact) => artifact.file === basename(output))
    if (expected === undefined) throw new Error(`showcase manifest is missing ${basename(output)}`)
    const generated = await readFile(output)
    const checkedIn = await readFile(resolve(outputDirectory, fixture.output))
    const hash = createHash('sha256').update(generated).digest('hex')
    if (generated.byteLength !== expected.bytes || hash !== expected.sha256) {
      throw new Error(`${fixture.output} does not match its canonical size and SHA-256`)
    }
    if (!generated.equals(checkedIn)) {
      throw new Error(`${fixture.output} is not byte-identical to a fresh package-owned bake`)
    }
  }
} finally {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
