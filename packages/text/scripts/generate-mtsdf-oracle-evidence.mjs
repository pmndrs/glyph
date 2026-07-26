import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const workspaceDirectory = resolve(packageDirectory, '../..')
const manifestPath = resolve(
  packageDirectory,
  'rust/mtsdf-admission/evidence/native-oracle-v0.json',
)
const cargoManifest = resolve(packageDirectory, 'rust/mtsdf-admission/Cargo.toml')
const provisioner = resolve(packageDirectory, 'scripts/provision-msdfgen-oracle.mjs')
const checkOnly = process.argv.includes('--check')
const expectedQualityBlockers = new Set(['self-intersection'])

const candidateCases = emitCandidateCases()
const existing = await readManifest()
const nativeCases = checkOnly ? nativeCasesFromManifest(existing) : await generateNativeCases()
const evidence = buildEvidence(candidateCases, nativeCases)
const serialized = `${JSON.stringify(evidence, null, 2)}\n`

if (checkOnly) {
  const expected = await readFile(manifestPath, 'utf8')
  if (serialized !== expected) {
    throw new Error('MTSDF oracle evidence is stale; run pnpm generate:mtsdf-oracle')
  }
} else {
  await writeFile(manifestPath, serialized)
}

process.stdout.write(
  `${evidence.cases.map(({ id, alpha, median: medianError, coverageMismatches }) => `${id}: alpha ${alpha.meanAbsoluteError.toFixed(3)}, median ${medianError.meanAbsoluteError.toFixed(3)}, coverage ${coverageMismatches}`).join('\n')}\n`,
)

function emitCandidateCases() {
  const output = execFileSync(
    'cargo',
    [
      'run',
      '--manifest-path',
      cargoManifest,
      '--bin',
      'emit-oracle-corpus',
      '--features',
      'oracle',
      '--locked',
      '--quiet',
    ],
    { cwd: workspaceDirectory, encoding: 'utf8', maxBuffer: 2_000_000 },
  )
  return output
    .trim()
    .split('\n')
    .map((line) => {
      const [
        id,
        width,
        height,
        range,
        scaleX,
        scaleY,
        translateX,
        translateY,
        shapeDescription,
        hexadecimal,
      ] = line.split('\t')
      const bytes = Buffer.from(hexadecimal, 'hex')
      if (bytes.length !== Number(width) * Number(height) * 4) {
        throw new Error(`${id} candidate byte length does not match its dimensions`)
      }
      return {
        id,
        width: Number(width),
        height: Number(height),
        range: Number(range),
        scale: [Number(scaleX), Number(scaleY)],
        translate: [Number(translateX), Number(translateY)],
        shapeDescription,
        bytes,
      }
    })
}

async function generateNativeCases() {
  const executable = execFileSync(process.execPath, [provisioner], {
    cwd: workspaceDirectory,
    encoding: 'utf8',
  }).trim()
  const temporaryDirectory = await mkdtemp('/tmp/pmndrs-mtsdf-oracle-')
  try {
    return await Promise.all(
      candidateCases.map(async (testCase) => {
        const output = resolve(temporaryDirectory, `${testCase.id}.rgba`)
        execFileSync(
          executable,
          [
            'mtsdf',
            '-defineshape',
            testCase.shapeDescription,
            '-dimensions',
            String(testCase.width),
            String(testCase.height),
            '-ascale',
            String(testCase.scale[0]),
            String(testCase.scale[1]),
            '-translate',
            String(testCase.translate[0]),
            String(testCase.translate[1]),
            '-range',
            String(testCase.range),
            '-format',
            'bin',
            '-o',
            output,
            '-yflip',
          ],
          { cwd: workspaceDirectory },
        )
        return { id: testCase.id, bytes: await readFile(output) }
      }),
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function nativeCasesFromManifest(manifest) {
  return manifest.cases.map(({ id, nativeRgbaBase64 }) => ({
    id,
    bytes: Buffer.from(nativeRgbaBase64, 'base64'),
  }))
}

function buildEvidence(candidates, natives) {
  const nativeById = new Map(natives.map((entry) => [entry.id, entry.bytes]))
  const cases = candidates.map((candidate) => {
    const native = nativeById.get(candidate.id)
    if (!native) throw new Error(`missing native oracle bytes for ${candidate.id}`)
    if (native.length !== candidate.bytes.length) {
      throw new Error(`${candidate.id} native byte length does not match the candidate`)
    }
    const comparison = compare(candidate.bytes, native)
    const isExpectedBlocker = expectedQualityBlockers.has(candidate.id)
    if (isExpectedBlocker && comparison.coverageMismatches < 100) {
      throw new Error(`${candidate.id} unexpectedly stopped reproducing its quality blocker`)
    }
    if (
      !isExpectedBlocker &&
      (comparison.alpha.meanAbsoluteError > 2 || comparison.coverageMismatches > 8)
    ) {
      throw new Error(
        `${candidate.id} exceeds the initial true-distance quality gate: ${JSON.stringify(comparison)}`,
      )
    }
    return {
      id: candidate.id,
      width: candidate.width,
      height: candidate.height,
      range: candidate.range,
      scale: candidate.scale,
      translate: candidate.translate,
      shapeDescription: candidate.shapeDescription,
      candidateSha256: sha256(candidate.bytes),
      nativeSha256: sha256(native),
      nativeRgbaBase64: native.toString('base64'),
      admissionStatus: isExpectedBlocker ? 'blocked' : 'passes-current-thresholds',
      ...comparison,
    }
  })

  const changed = Buffer.from(nativeById.get(candidates[0].id))
  changed[3] ^= 1
  const negativeControl = compare(candidates[0].bytes, changed)
  if (
    negativeControl.alpha.meanAbsoluteError === cases[0].alpha.meanAbsoluteError &&
    negativeControl.alpha.maximumError === cases[0].alpha.maximumError
  ) {
    throw new Error('MTSDF oracle negative control did not observe a changed alpha byte')
  }

  return {
    schemaVersion: 0,
    kind: 'mtsdf-native-quality-oracle',
    admissionStatus: 'blocked-by-self-intersection',
    oracle: {
      name: 'Chlumsky msdfgen',
      version: '1.13.0',
      tag: 'v1.13',
      commit: '1874bcf7d9624ccc85b4bc9a85d78116f690f35b',
      archiveSha256: '93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167',
      build: 'core-only',
    },
    framing: {
      pixelCenterSampling: true,
      yOrientation: 'top-down-via-msdfgen-yflip',
      distanceRangeFontUnits: 1_000,
      innerSize: [32, 32],
      padding: [4, 4],
    },
    thresholds: { alphaMeanAbsoluteError: 2, coverageMismatches: 8 },
    negativeControl: { changedCase: candidates[0].id, changedChannel: 'alpha', observed: true },
    cases,
  }
}

function compare(candidate, native) {
  let alphaAbsoluteError = 0
  let alphaMaximumError = 0
  let medianAbsoluteError = 0
  let medianMaximumError = 0
  let coverageMismatches = 0
  let thresholdBoundaryDifferences = 0
  const pixels = candidate.length / 4
  for (let offset = 0; offset < candidate.length; offset += 4) {
    const alphaError = Math.abs(candidate[offset + 3] - native[offset + 3])
    const candidateMedian = median(candidate[offset], candidate[offset + 1], candidate[offset + 2])
    const nativeMedian = median(native[offset], native[offset + 1], native[offset + 2])
    const medianError = Math.abs(candidateMedian - nativeMedian)
    alphaAbsoluteError += alphaError
    alphaMaximumError = Math.max(alphaMaximumError, alphaError)
    medianAbsoluteError += medianError
    medianMaximumError = Math.max(medianMaximumError, medianError)
    if (candidateMedian >= 128 !== nativeMedian >= 128) {
      thresholdBoundaryDifferences += 1
      const separatedByQuantizationBand =
        (candidateMedian <= 126 && nativeMedian >= 129) ||
        (nativeMedian <= 126 && candidateMedian >= 129)
      if (separatedByQuantizationBand) coverageMismatches += 1
    }
  }
  return {
    alpha: {
      meanAbsoluteError: alphaAbsoluteError / pixels,
      maximumError: alphaMaximumError,
    },
    median: {
      meanAbsoluteError: medianAbsoluteError / pixels,
      maximumError: medianMaximumError,
    },
    coverageMismatches,
    thresholdBoundaryDifferences,
  }
}

function median(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (!checkOnly && error && typeof error === 'object' && error.code === 'ENOENT') {
      return { cases: [] }
    }
    throw error
  }
}
