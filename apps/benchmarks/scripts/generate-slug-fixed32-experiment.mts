import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { bakeFont } from '@pmndrs/text/bake'
import { createSlugBaker, slugBakerFromCore } from '@pmndrs/text/bakers/slug'

const experimentName =
  process.argv
    .find((argument) => argument.startsWith('--experiment='))
    ?.slice('--experiment='.length) ?? 'fixed32'
const experiments = {
  fixed32: {
    experimentId: 'slug-fixed32-bands-001',
    baseCommit: '24976c6c2f67a3fc1879cd6f672fca332e297fec',
    changedVariable: 'fixed per-glyph band count',
    cargoFeature: 'autoresearch-fixed32-bands',
    fileLabel: 'fixed32',
    manifestFields: { bandCount: 32 },
  },
  adaptive: {
    experimentId: 'slug-adaptive-bands-001',
    baseCommit: '76d03f7ebd85d9b31b365ef5313adc89c2567ff2',
    changedVariable: 'adaptive per-glyph band count',
    cargoFeature: 'autoresearch-adaptive-bands',
    fileLabel: 'adaptive',
    manifestFields: {
      bandCounts: [16, 32, 64],
      maximumMeanReferencesPerBand: 6,
    },
  },
} as const
if (experimentName !== 'fixed32' && experimentName !== 'adaptive') {
  throw new TypeError(`Unknown Slug band experiment: ${experimentName}`)
}
const experiment = experiments[experimentName]
const { baseCommit, experimentId } = experiment
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url))
const outputDirectory = resolve('fixtures/autoresearch', experimentId)
const manifestOutput = resolve(outputDirectory, 'artifacts-v0.json')
const check = process.argv.includes('--check')
const requestedFixture = process.argv
  .find((argument) => argument.startsWith('--fixture='))
  ?.slice('--fixture='.length)
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), `pmndrs-text-slug-${experiment.fileLabel}-`),
)
const cargoTarget = resolve(temporaryDirectory, 'cargo-target')

interface ExperimentArtifact {
  readonly fontFixture: string
  readonly file: string
  readonly uncompressed: { readonly bytes: number; readonly sha256: string }
  readonly compressed: { readonly bytes: number; readonly sha256: string }
  readonly raster: {
    readonly metadataBytes: number
    readonly serializedBytes: number
    readonly decodedGpuBytes: number
    readonly pages: readonly {
      readonly index: number
      readonly width: number
      readonly height: number
      readonly format: string
      readonly encodedBytes: number
      readonly decodedGpuBytes: number
    }[]
  }
}

const fixtures = [
  {
    fontFixture: 'inter',
    input: resolve('fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    output: `inter-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'amiri',
    input: resolve('fixtures/fonts/amiri-1.002/Amiri-Regular.ttf'),
    output: `amiri-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'noto-sans-devanagari',
    input: resolve('fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf'),
    output: `noto-sans-devanagari-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'dot-gothic-16',
    input: resolve('fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf'),
    output: `dot-gothic-16-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'noto-sans-cjk-showcase',
    input: resolve('fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf'),
    output: `noto-sans-cjk-showcase-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'source-serif-4',
    input: resolve('fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf'),
    output: `source-serif-4-slug-${experiment.fileLabel}.font.glb.gz`,
  },
  {
    fontFixture: 'dancing-script',
    input: resolve('fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf'),
    output: `dancing-script-slug-${experiment.fileLabel}.font.glb.gz`,
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
  throw new TypeError('--fixture cannot weaken the complete Slug band experiment check')
}

try {
  await run('mise', [
    'exec',
    '--',
    'cargo',
    'build',
    '--manifest-path',
    'packages/text/rust/slug-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
    '--features',
    `artifact-baker,${experiment.cargoFeature}`,
    '--target-dir',
    cargoTarget,
  ])
  const wasm = await readFile(
    resolve(cargoTarget, 'wasm32-unknown-unknown/release/pmndrs_text_slug_baker.wasm'),
  )
  const baker = slugBakerFromCore(await createSlugBaker(wasm))
  const artifacts: ExperimentArtifact[] =
    requestedFixture === undefined
      ? []
      : (
          JSON.parse(await readFile(manifestOutput, 'utf8')) as {
            readonly artifacts: ExperimentArtifact[]
          }
        ).artifacts.filter(({ fontFixture }) => fontFixture !== requestedFixture)

  for (const fixture of selectedFixtures) {
    const bakedOutput = resolve(temporaryDirectory, `${fixture.fontFixture}.font.glb`)
    const report = await bakeFont({
      input: fixture.input,
      output: bakedOutput,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
          options: undefined,
        },
      ],
    })
    const baked = await readFile(bakedOutput)
    const compressed = gzipSync(baked, { level: 9 })
    const raster = report.rasters.find(({ kind }) => kind === 'slug')
    if (raster === undefined) throw new Error(`${fixture.fontFixture} omitted its Slug report`)
    artifacts.push({
      fontFixture: fixture.fontFixture,
      file: fixture.output,
      uncompressed: { bytes: baked.byteLength, sha256: sha256(baked) },
      compressed: { bytes: compressed.byteLength, sha256: sha256(compressed) },
      raster: {
        metadataBytes: raster.metadataBytes,
        serializedBytes: raster.serializedBytes,
        decodedGpuBytes: raster.gpuBytes,
        pages: raster.pages.map((page, index) => ({
          index,
          width: page.width,
          height: page.height,
          format: page.format,
          encodedBytes: page.encodedBytes,
          decodedGpuBytes: page.mipBytes,
        })),
      },
    })
    const checkedInOutput = resolve(outputDirectory, fixture.output)
    if (check) {
      const checkedIn = await readFile(checkedInOutput)
      if (!compressed.equals(checkedIn)) {
        throw new Error(`${fixture.output} is not byte-identical to a fresh experiment bake`)
      }
    } else {
      await writeFile(resolve(temporaryDirectory, fixture.output), compressed)
    }
  }

  artifacts.sort(
    (left, right) =>
      fixtures.findIndex(({ fontFixture }) => fontFixture === left.fontFixture) -
      fixtures.findIndex(({ fontFixture }) => fontFixture === right.fontFixture),
  )
  const manifest = {
    schemaVersion: 0,
    experimentId,
    baseCommit,
    changedVariable: experiment.changedVariable,
    ...experiment.manifestFields,
    cargoFeature: experiment.cargoFeature,
    artifacts,
  }
  if (check) {
    const expected = JSON.parse(await readFile(manifestOutput, 'utf8'))
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
      throw new Error('fresh Slug band experiment manifest does not match checked-in evidence')
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
    for (const fixture of selectedFixtures) {
      await copyFile(
        resolve(temporaryDirectory, fixture.output),
        resolve(outputDirectory, fixture.output),
      )
    }
    await writeFile(manifestOutput, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: workspaceRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with ${String(code ?? signal)}`))
    })
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
