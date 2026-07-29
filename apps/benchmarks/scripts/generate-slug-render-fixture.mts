import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { bakeFont } from '@pmndrs/text/bake'
import { slugBaker } from '@pmndrs/text/bakers/slug'

const outputDirectory = resolve('fixtures/rendering')
const showcaseManifestOutput = resolve(outputDirectory, 'showcase-slug-fixtures-v0.json')
const check = process.argv.includes('--check')
const requestedFixture = process.argv
  .find((argument) => argument.startsWith('--fixture='))
  ?.slice('--fixture='.length)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-text-slug-fixture-'))

const fixtures = [
  {
    fontFixture: 'inter',
    input: resolve('fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    output: 'inter-slug.font.glb.gz',
  },
  {
    fontFixture: 'amiri',
    input: resolve('fixtures/fonts/amiri-1.002/Amiri-Regular.ttf'),
    output: 'amiri-slug.font.glb.gz',
  },
  {
    fontFixture: 'noto-sans-devanagari',
    input: resolve('fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf'),
    output: 'noto-sans-devanagari-slug.font.glb.gz',
  },
  {
    fontFixture: 'dot-gothic-16',
    input: resolve('fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf'),
    output: 'dot-gothic-16-slug.font.glb.gz',
  },
  {
    fontFixture: 'noto-sans-cjk-showcase',
    input: resolve('fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf'),
    output: 'noto-sans-cjk-showcase-slug.font.glb.gz',
  },
  {
    fontFixture: 'source-serif-4',
    input: resolve('fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf'),
    output: 'source-serif-4-slug.font.glb.gz',
  },
  {
    fontFixture: 'dancing-script',
    input: resolve('fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf'),
    output: 'dancing-script-slug.font.glb.gz',
  },
] as const

const selectedFixtures =
  requestedFixture === undefined
    ? fixtures
    : fixtures.filter(({ fontFixture }) => fontFixture === requestedFixture)
if (selectedFixtures.length === 0) {
  throw new TypeError(`Unknown Slug fixture: ${String(requestedFixture)}`)
}
if (check && requestedFixture !== undefined) {
  throw new TypeError('--fixture cannot weaken the complete Slug fixture check')
}

try {
  const artifacts =
    requestedFixture === undefined
      ? []
      : (
          JSON.parse(await readFile(showcaseManifestOutput, 'utf8')) as {
            readonly artifacts: Array<{ readonly fontFixture: string }>
          }
        ).artifacts.filter(({ fontFixture }) => fontFixture !== requestedFixture)

  for (const fixture of selectedFixtures) {
    const startedAt = performance.now()
    console.log(`Baking full ${fixture.fontFixture} Slug fixture...`)
    const bakedOutput = resolve(temporaryDirectory, `${fixture.fontFixture}-slug.font.glb`)
    const report = await bakeFont({
      input: fixture.input,
      output: bakedOutput,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker: slugBaker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
          options: undefined,
        },
      ],
    })
    const baked = await readFile(bakedOutput)
    const compressed = gzipSync(baked, { level: 9 })
    const raster = report.rasters.find(({ kind }) => kind === 'slug')
    if (raster === undefined) throw new Error(`${fixture.fontFixture} bake omitted its Slug report`)
    const artifact = {
      fontFixture: fixture.fontFixture,
      file: fixture.output,
      transport: 'gzip',
      uncompressed: { bytes: baked.byteLength, sha256: sha256(baked) },
      compressed: { bytes: compressed.byteLength, sha256: sha256(compressed) },
      raster: {
        kind: raster.kind,
        metadataBytes: raster.metadataBytes,
        serializedBytes: raster.serializedBytes,
        decodedGpuBytes: raster.gpuBytes,
        pages: raster.pages.map((page, index) => ({
          index,
          width: page.width,
          height: page.height,
          format: page.format,
          encodedBytes: page.encodedBytes,
          decodedGpuBytes: page.gpuBytes,
        })),
      },
    }
    artifacts.push(artifact)

    const compressedOutput = resolve(outputDirectory, fixture.output)
    if (check) {
      const checkedIn = await readFile(compressedOutput)
      if (!compressed.equals(checkedIn)) {
        throw new Error(`${fixture.output} is not byte-identical to a fresh package-owned bake`)
      }
    } else {
      await writeFile(resolve(temporaryDirectory, fixture.output), compressed)
    }
    console.log(
      `Baked ${fixture.fontFixture}: ${raster.pages.length} pages, ${formatBytes(baked.byteLength)} raw, ${formatBytes(compressed.byteLength)} gzip in ${formatDuration(performance.now() - startedAt)}`,
    )
  }

  artifacts.sort(
    (left, right) =>
      fixtures.findIndex(({ fontFixture }) => fontFixture === left.fontFixture) -
      fixtures.findIndex(({ fontFixture }) => fontFixture === right.fontFixture),
  )

  const showcaseManifest = { schemaVersion: 0, artifacts }

  if (check) {
    const expectedShowcase = JSON.parse(await readFile(showcaseManifestOutput, 'utf8'))
    if (JSON.stringify(showcaseManifest) !== JSON.stringify(expectedShowcase)) {
      throw new Error('fresh showcase Slug fixtures do not match their canonical manifest')
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
    for (const fixture of selectedFixtures) {
      await copyFile(
        resolve(temporaryDirectory, fixture.output),
        resolve(outputDirectory, fixture.output),
      )
    }
    await writeFile(showcaseManifestOutput, `${JSON.stringify(showcaseManifest, undefined, 2)}\n`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)} s`
}
