import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

import { reproducibleRustEnvironment } from '../../font-baker/scripts/reproducible-rust-env.mjs'
import {
  MtsdfGenerationError,
  createMtsdfGeneratorFromInstance,
} from '../dist/internal/mtsdf-generator.js'
import { mtsdfOracleCases } from '../tests/fixtures/mtsdf-oracle-cases.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url))
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot)
const encodedFlagSeparator = '\u001f'
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt'
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url))
const temporaryRoot = await mkdtemp(join(tmpdir(), 'pmndrs-mtsdf-simd-'))
const evidenceUrl = new URL('../rust/mtsdf-admission/evidence/simd-v0.json', import.meta.url)

const variantDefinitions = [
  { id: 'scalar', simd: false, features: [] },
  { id: 'auto-vectorized', simd: true, features: [] },
  { id: 'explicit-simd128', simd: true, features: ['simd128-experiment'] },
]

try {
  const variants = []
  for (const definition of variantDefinitions) {
    variants.push(await buildVariant(definition))
  }
  const allocationEvidence = await measureAllocationEvidence()
  if (process.argv.includes('--retain-artifacts')) await retainArtifacts(variants)

  const observations = await prepareObservations(variants)
  for (let pass = 0; pass < 18; pass += 1) {
    const order = pass % 2 === 0 ? observations : observations.toReversed()
    for (const observation of order) {
      observation.samples.push(measureCorpus(observation.generator))
      if (observation.samples.length === 1) {
        observation.memoryAfterColdBytes = observation.memory.buffer.byteLength
      }
    }
  }

  const fullFont = process.argv.includes('--full-font')
    ? await measureFullFont(observations)
    : undefined

  const report = {
    schemaVersion: 0,
    kind: 'mtsdf-simd-comparison',
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      rust: '1.97.1',
      binaryen: '129.0.0',
    },
    corpus: {
      cases: mtsdfOracleCases.length,
      callsPerSample: mtsdfOracleCases.length,
      outputBytesPerSample: mtsdfOracleCases.reduce(
        (bytes, testCase) =>
          bytes +
          (testCase.request.region.innerWidth + testCase.request.region.paddingX * 2) *
            (testCase.request.region.innerHeight + testCase.request.region.paddingY * 2) *
            4,
        0,
      ),
      candidateSha256: Object.fromEntries(
        mtsdfOracleCases.map((testCase) => [testCase.id, testCase.candidateSha256]),
      ),
    },
    variants: observations.map((observation) =>
      summarize(observation, allocationEvidence.get(observation.id)),
    ),
    ...(fullFont === undefined ? {} : { fullFont }),
  }
  if (process.argv.includes('--check')) await checkEvidence(report)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function measureAllocationEvidence() {
  const results = new Map()
  for (const definition of variantDefinitions) {
    const instrumented = await buildVariant({
      ...definition,
      id: `${definition.id}-allocation`,
      features: [...definition.features, 'allocation-evidence'],
    })
    const instance = await WebAssembly.instantiate(
      await WebAssembly.compile(instrumented.optimized),
      {},
    )
    const generator = createMtsdfGeneratorFromInstance(instance)
    measureCorpus(generator)
    const reset = readCounterExport(instance, 'pmndrs_text_mtsdf_reset_allocation_counts')
    const allocationCalls = readCounterExport(instance, 'pmndrs_text_mtsdf_allocation_calls')
    const reallocationCalls = readCounterExport(instance, 'pmndrs_text_mtsdf_reallocation_calls')
    const deallocationCalls = readCounterExport(instance, 'pmndrs_text_mtsdf_deallocation_calls')
    reset()
    measureCorpus(generator)
    results.set(definition.id, {
      allocationCalls: allocationCalls(),
      reallocationCalls: reallocationCalls(),
      deallocationCalls: deallocationCalls(),
    })
  }
  return results
}

function readCounterExport(instance, name) {
  const value = instance.exports[name]
  if (typeof value !== 'function') throw new TypeError(`missing MTSDF allocation export ${name}`)
  return value
}

async function checkEvidence(report) {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'))
  if (evidence.kind !== 'mtsdf-simd-decision' || evidence.decision?.selected !== 'scalar') {
    throw new Error('MTSDF SIMD evidence does not select the admitted scalar kernel')
  }
  for (const variant of report.variants) {
    const recorded = evidence.variants?.[variant.id]
    if (
      recorded?.optimizedBytes !== variant.wasm.optimizedBytes ||
      recorded?.gzipBytes !== variant.wasm.gzipBytes ||
      recorded?.brotliBytes !== variant.wasm.brotliBytes ||
      recorded?.optimizedSha256 !== variant.wasm.optimizedSha256
    ) {
      throw new Error(`${variant.id} MTSDF SIMD size evidence is stale`)
    }
    if (!variant.exactOracleHashes) {
      throw new Error(`${variant.id} no longer matches the native-oracle candidate hashes`)
    }
    const recordedWarmCalls = evidence.allocation?.warmSevenCaseCorpus
    if (
      variant.allocation.warmWasmAllocationCalls !== recordedWarmCalls?.allocations ||
      variant.allocation.warmWasmReallocationCalls !== recordedWarmCalls?.reallocations ||
      variant.allocation.warmWasmDeallocationCalls !== recordedWarmCalls?.deallocations
    ) {
      throw new Error(`${variant.id} MTSDF allocation evidence is stale`)
    }
  }
  const distributed = await readFile(new URL('../dist/mtsdf_baker.wasm', import.meta.url))
  const distributedSha256 = createHash('sha256').update(distributed).digest('hex')
  const scalar = report.variants.find((variant) => variant.id === 'scalar')
  if (scalar === undefined || distributedSha256 !== scalar.wasm.optimizedSha256) {
    throw new Error('distributed MTSDF generator is not the admitted scalar artifact')
  }
}

async function retainArtifacts(variants) {
  const directory = fileURLToPath(new URL('../dist/evidence/mtsdf-simd/', import.meta.url))
  await mkdir(directory, { recursive: true })
  await Promise.all(
    variants.map((variant) =>
      copyFile(variant.optimizedPath, join(directory, `${variant.id}.wasm`)),
    ),
  )
}

async function measureFullFont(observations) {
  const fontPath = fileURLToPath(
    new URL(
      '../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
      import.meta.url,
    ),
  )
  const serialized = await capture(
    'cargo',
    [
      'run',
      '--manifest-path',
      'rust/mtsdf-admission/Cargo.toml',
      '--release',
      '--features',
      'full-font-evidence',
      '--bin',
      'emit-mtsdf-font-requests',
      '--locked',
      '--',
      fontPath,
    ],
    rustEnvironment,
  )
  const corpus = parseFontRequests(serialized)
  const results = new Map(observations.map((observation) => [observation.id, []]))
  for (let pass = 0; pass < 2; pass += 1) {
    const order = pass % 2 === 0 ? observations : observations.toReversed()
    for (const observation of order) {
      const measured = measureFontCorpus(observation.generator, corpus.requests)
      results.get(observation.id).push({
        ...measured,
        memoryBytes: observation.memory.buffer.byteLength,
      })
    }
  }
  const scalar = results.get('scalar')
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'))
  const acceptedInter = evidence.completeInter
  if (
    scalar[0].generatedGlyphs !== acceptedInter?.generatedGlyphs ||
    scalar[0].rejectedGlyphs !== acceptedInter?.rejectedGlyphs ||
    scalar[0].compositeSha256 !== acceptedInter?.compositeSha256 ||
    !sameNumbers(scalar[0].rejectedGlyphIds, acceptedInter?.rejectedGlyphIds ?? [])
  ) {
    throw new Error('scalar complete Inter result changed from the accepted SIMD evidence')
  }
  for (const [variant, passes] of results) {
    for (const pass of passes) {
      if (
        pass.generatedGlyphs !== scalar[0].generatedGlyphs ||
        pass.rejectedGlyphs !== scalar[0].rejectedGlyphs ||
        pass.checksum !== scalar[0].checksum ||
        pass.compositeSha256 !== scalar[0].compositeSha256 ||
        !sameNumbers(pass.rejectedGlyphIds, scalar[0].rejectedGlyphIds)
      ) {
        throw new Error(`${variant} changed the complete Inter result`)
      }
    }
  }
  return {
    fixture: 'apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
    glyphs: corpus.glyphs,
    skippedGlyphs: corpus.skippedGlyphs,
    variants: Object.fromEntries(
      [...results].map(([variant, passes]) => [
        variant,
        {
          generatedGlyphs: passes[0].generatedGlyphs,
          rejectedGlyphs: passes[0].rejectedGlyphs,
          rejectedGlyphIds: passes[0].rejectedGlyphIds,
          checksum: passes[0].checksum.toString(16).padStart(8, '0'),
          compositeSha256: passes[0].compositeSha256,
          coldMilliseconds: passes[0].milliseconds,
          warmMilliseconds: passes[1].milliseconds,
          memoryAfterColdBytes: passes[0].memoryBytes,
          finalMemoryBytes: passes[1].memoryBytes,
          steadyStateMemoryGrowthBytes: passes[1].memoryBytes - passes[0].memoryBytes,
        },
      ]),
    ),
  }
}

function parseFontRequests(serialized) {
  const lines = serialized.trimEnd().split('\n')
  const [magic, rawGlyphs] = lines.shift().split('\t')
  if (magic !== 'pmndrs-mtsdf-font-requests-v0') {
    throw new TypeError('unsupported MTSDF font request corpus')
  }
  const glyphs = Number(rawGlyphs)
  if (!Number.isSafeInteger(glyphs) || glyphs < 0) {
    throw new TypeError('invalid MTSDF font request glyph count')
  }
  const requests = []
  let skippedGlyphs = 0
  let current
  let nextGlyphId = 0
  for (const line of lines) {
    const [kind, ...rawValues] = line.split('\t')
    const values = rawValues.map(Number)
    if (!values.every(Number.isFinite)) throw new TypeError('invalid MTSDF font request number')
    if (kind === 's') {
      if (values.length !== 1 || !Number.isSafeInteger(values[0]) || values[0] !== nextGlyphId) {
        throw new TypeError('invalid skipped MTSDF font glyph')
      }
      skippedGlyphs += 1
      nextGlyphId += 1
      continue
    }
    if (kind === 'g') {
      if (
        current !== undefined ||
        values.length !== 7 ||
        !Number.isSafeInteger(values[0]) ||
        values[0] !== nextGlyphId ||
        values[6] !== 0
      ) {
        throw new TypeError('invalid MTSDF font glyph header')
      }
      current = {
        glyphId: values[0],
        request: {
          unitsPerEm: values[1],
          bounds: { minX: values[2], minY: values[3], maxX: values[4], maxY: values[5] },
          region: { innerWidth: 32, innerHeight: 32, paddingX: 4, paddingY: 4 },
          commands: [],
        },
      }
      continue
    }
    if (kind === 'e') {
      if (current === undefined) throw new TypeError('orphaned MTSDF font glyph terminator')
      requests.push(current)
      current = undefined
      nextGlyphId += 1
      continue
    }
    if (current === undefined) throw new TypeError('orphaned MTSDF font outline command')
    current.request.commands.push(parseCommand(kind, values))
  }
  if (
    current !== undefined ||
    nextGlyphId !== glyphs ||
    requests.length + skippedGlyphs !== glyphs
  ) {
    throw new TypeError('incomplete MTSDF font request corpus')
  }
  return { glyphs, skippedGlyphs, requests }
}

function parseCommand(kind, values) {
  if (kind === 'm' && values.length === 2) return { kind: 'move', x: values[0], y: values[1] }
  if (kind === 'l' && values.length === 2) return { kind: 'line', x: values[0], y: values[1] }
  if (kind === 'q' && values.length === 4) {
    return {
      kind: 'quadratic',
      controlX: values[0],
      controlY: values[1],
      x: values[2],
      y: values[3],
    }
  }
  if (kind === 'c' && values.length === 6) {
    return {
      kind: 'cubic',
      control0X: values[0],
      control0Y: values[1],
      control1X: values[2],
      control1Y: values[3],
      x: values[4],
      y: values[5],
    }
  }
  if (kind === 'z' && values.length === 0) return { kind: 'close' }
  throw new TypeError(`invalid MTSDF font outline command ${kind}`)
}

function measureFontCorpus(generator, requests) {
  const outputs = new Array(requests.length)
  const rejectedGlyphIds = []
  let generatedGlyphs = 0
  let rejectedGlyphs = 0
  const start = performance.now()
  for (let index = 0; index < requests.length; index += 1) {
    try {
      outputs[index] = generator.generate(requests[index].request).rgba
      generatedGlyphs += 1
    } catch (error) {
      if (!(error instanceof RangeError) && !(error instanceof MtsdfGenerationError)) throw error
      outputs[index] = undefined
      rejectedGlyphIds.push(requests[index].glyphId)
      rejectedGlyphs += 1
    }
  }
  const milliseconds = performance.now() - start
  let checksum = 2_166_136_261
  const composite = createHash('sha256')
  const glyphIdBytes = Buffer.allocUnsafe(4)
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index]
    glyphIdBytes.writeUInt32LE(requests[index].glyphId)
    composite.update(glyphIdBytes)
    if (output === undefined) {
      composite.update('rejected')
      continue
    }
    composite.update(output)
    checksum = Math.imul(checksum ^ fnv1a(output), 16_777_619) >>> 0
  }
  return {
    checksum,
    compositeSha256: composite.digest('hex'),
    generatedGlyphs,
    rejectedGlyphs,
    rejectedGlyphIds,
    milliseconds,
  }
}

function sameNumbers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function fnv1a(bytes) {
  let hash = 2_166_136_261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0
  return hash
}

async function buildVariant(definition) {
  const targetDirectory = join(temporaryRoot, definition.id)
  const environment = {
    ...rustEnvironment,
    CARGO_TARGET_DIR: targetDirectory,
    ...(definition.simd
      ? {
          CARGO_ENCODED_RUSTFLAGS: [
            rustEnvironment.CARGO_ENCODED_RUSTFLAGS,
            '-C',
            'target-feature=+simd128',
          ].join(encodedFlagSeparator),
        }
      : {}),
  }
  const cargoArguments = [
    'build',
    '--manifest-path',
    'rust/mtsdf-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
  ]
  if (definition.features.length > 0) {
    cargoArguments.push('--features', definition.features.join(','))
  }
  await run('cargo', cargoArguments, environment)

  const rawPath = join(
    targetDirectory,
    'wasm32-unknown-unknown/release/pmndrs_text_mtsdf_baker.wasm',
  )
  const optimizedPath = join(temporaryRoot, `${definition.id}.wasm`)
  const optimizerArguments = [
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    ...(definition.simd ? ['--enable-simd'] : []),
    '-Oz',
    rawPath,
    '-o',
    optimizedPath,
  ]
  await run(wasmOpt, optimizerArguments, rustEnvironment)
  const [raw, optimized] = await Promise.all([readFile(rawPath), readFile(optimizedPath)])
  return { ...definition, raw, optimized, optimizedPath }
}

async function prepareObservations(variants) {
  const observations = []
  for (const variant of variants) {
    const compileStart = performance.now()
    const module = await WebAssembly.compile(variant.optimized)
    const compileMilliseconds = performance.now() - compileStart
    const initializationStart = performance.now()
    const instance = await WebAssembly.instantiate(module, {})
    const generator = createMtsdfGeneratorFromInstance(instance)
    const initializationMilliseconds = performance.now() - initializationStart
    const memory = instance.exports.memory
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new TypeError(`${variant.id} did not export Wasm memory`)
    }
    observations.push({
      ...variant,
      compileMilliseconds,
      initializationMilliseconds,
      generator,
      memory,
      initialMemoryBytes: memory.buffer.byteLength,
      samples: [],
    })
  }
  return observations
}

function measureCorpus(generator) {
  const outputs = new Array(mtsdfOracleCases.length)
  const start = performance.now()
  for (let index = 0; index < mtsdfOracleCases.length; index += 1) {
    outputs[index] = generator.generate(mtsdfOracleCases[index].request).rgba
  }
  const milliseconds = performance.now() - start
  for (let index = 0; index < outputs.length; index += 1) {
    const hash = createHash('sha256').update(outputs[index]).digest('hex')
    if (hash !== mtsdfOracleCases[index].candidateSha256) {
      throw new Error(`${mtsdfOracleCases[index].id} changed in a SIMD comparison`)
    }
  }
  return milliseconds
}

function summarize(observation, allocationEvidence) {
  if (allocationEvidence === undefined) throw new TypeError('missing MTSDF allocation evidence')
  const warm = observation.samples.slice(3).sort((left, right) => left - right)
  return {
    id: observation.id,
    targetFeatures: observation.simd ? ['simd128'] : [],
    explicitSimd: observation.features.includes('simd128-experiment'),
    exactOracleHashes: true,
    wasm: {
      rawBytes: observation.raw.byteLength,
      optimizedBytes: observation.optimized.byteLength,
      gzipBytes: gzipSync(observation.optimized, { level: 9, mtime: 0 }).byteLength,
      brotliBytes: brotliCompressSync(observation.optimized, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
      optimizedSha256: createHash('sha256').update(observation.optimized).digest('hex'),
    },
    milliseconds: {
      compile: observation.compileMilliseconds,
      initialization: observation.initializationMilliseconds,
      coldCorpus: observation.samples[0],
      warmCorpusMedian: warm[Math.floor(warm.length / 2)],
      warmCorpusSamples: observation.samples.slice(3),
    },
    allocation: {
      requestAllocationsPerCall: 1,
      ownedOutputCopiesPerCall: 1,
      initialMemoryBytes: observation.initialMemoryBytes,
      memoryAfterColdBytes: observation.memoryAfterColdBytes,
      finalMemoryBytes: observation.memory.buffer.byteLength,
      steadyStateMemoryGrowthBytes:
        observation.memory.buffer.byteLength - observation.memoryAfterColdBytes,
      warmWasmAllocationCalls: allocationEvidence.allocationCalls,
      warmWasmReallocationCalls: allocationEvidence.reallocationCalls,
      warmWasmDeallocationCalls: allocationEvidence.deallocationCalls,
    },
  }
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: environment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

function capture(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}
