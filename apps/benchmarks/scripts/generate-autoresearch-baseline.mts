import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  assertAutoresearchBaseline,
  assertAutoresearchDisabled,
  type AutoresearchBaselineV0,
} from '../src/benchmark/autoresearch.ts'

const appDirectory = new URL('../', import.meta.url)
const workspaceDirectory = new URL('../../../', import.meta.url)
const output = new URL('../src/generated/autoresearch-baseline-v0.json', import.meta.url)
const baseCommit = '0e9610aaca9777156fa81fcc3659d4e31603f555'
const evidenceFiles = [
  ['package-sizes', 'apps/benchmarks/src/generated/package-sizes.json'],
  ['harness-admission', 'apps/benchmarks/fixtures/admission/harness-v0.json'],
  ['bake-host-cold-warm', 'apps/benchmarks/fixtures/results/bake-host-baseline-v0.json'],
  ['shaping-conformance', 'apps/benchmarks/fixtures/results/shaping-conformance-chromium149.json'],
  ['paragraph-layout', 'apps/benchmarks/fixtures/results/paragraph-layout-chromium149.json'],
  ['paragraph-bidi', 'apps/benchmarks/fixtures/results/paragraph-bidi-policy-chromium149.json'],
  ['cjk-universality', 'apps/benchmarks/fixtures/results/cjk-universality-chromium149.json'],
  [
    'advanced-shaping-conformance',
    'apps/benchmarks/fixtures/results/advanced-shaping-conformance-chromium149.json',
  ],
  [
    'advanced-shaping-performance',
    'apps/benchmarks/fixtures/results/advanced-shaping-performance-chromium149.json',
  ],
  ['raster-performance', 'apps/benchmarks/fixtures/results/raster-performance-chromium149.json'],
  ['slug-quality-matrix', 'apps/benchmarks/fixtures/results/slug-quality-matrix-chromium149.json'],
  [
    'slug-performance-matrix',
    'apps/benchmarks/fixtures/results/slug-performance-matrix-chromium149.json',
  ],
  ['slug-role-scenes', 'apps/benchmarks/fixtures/results/slug-role-scenes-chromium149.json'],
  [
    'slug-outline-performance',
    'apps/benchmarks/fixtures/results/slug-outline-performance-chromium149.json',
  ],
  [
    'slug-outline-conformance',
    'apps/benchmarks/fixtures/results/slug-outline-conformance-chromium149.json',
  ],
  [
    'slug-external-render-parity',
    'apps/benchmarks/fixtures/results/slug-external-render-parity-chromium149.json',
  ],
  [
    'icon-grid-retained-evidence',
    'apps/benchmarks/fixtures/results/icon-grid-retained-evidence-chromium149.json',
  ],
] as const

const [workspaceManifest, nodeVersion, rustToolchain] = await Promise.all([
  readJson(new URL('package.json', workspaceDirectory)),
  readFile(new URL('.node-version', workspaceDirectory), 'utf8'),
  readFile(new URL('rust-toolchain.toml', workspaceDirectory), 'utf8'),
])
const packageManager = requiredString(workspaceManifest.packageManager, 'packageManager')
const rustVersion = /^channel\s*=\s*"([^"]+)"/m.exec(rustToolchain)?.[1]
if (rustVersion === undefined) throw new Error('rust-toolchain.toml does not declare a channel')

const evidence = await Promise.all(
  evidenceFiles.map(async ([id, path]) => {
    const bytes = await readFile(new URL(`../../../${path}`, import.meta.url))
    return {
      id,
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
    }
  }),
)
const baseline: AutoresearchBaselineV0 = {
  schemaVersion: 0,
  baseCommit,
  campaign: {
    state: 'disabled',
    reason:
      'Optimization campaigns remain disabled until the release raster baselines are accepted.',
  },
  environment: {
    node: nodeVersion.trim(),
    pnpm: packageManager.replace(/^pnpm@/, ''),
    rust: rustVersion,
  },
  evidence,
}
assertAutoresearchBaseline(baseline)
assertAutoresearchDisabled(baseline)
const serialized = `${JSON.stringify(baseline, null, 2)}\n`

if (process.argv.includes('--check')) {
  if ((await readFile(output, 'utf8')) !== serialized) {
    throw new Error(
      `autoresearch baseline is stale; run the generator from ${fileURLToPath(appDirectory)}`,
    )
  }
} else {
  await writeFile(output, serialized)
}

async function readJson(url: URL): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(url, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${fileURLToPath(url)} must contain a JSON object`)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`)
  return value
}
