import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

interface MeasuredEntry {
  readonly id: string
  readonly label: string
  readonly status: 'measured'
  readonly format: 'javascript' | 'wasm'
  readonly rawBytes: number
  readonly minifiedBytes: number
  readonly gzipBytes: number
  readonly brotliBytes: number
}

interface UnavailableEntry {
  readonly id: string
  readonly label: string
  readonly status: 'unavailable'
  readonly reason: string
}

type SizeEntry = MeasuredEntry | UnavailableEntry

const root = fileURLToPath(new URL('..', import.meta.url))

async function bundle(entry: string, minify: false | 'oxc'): Promise<Uint8Array> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    build: {
      lib: {
        entry,
        formats: ['es'],
        fileName: 'entry',
      },
      minify,
      target: 'es2022',
      write: false,
      rollupOptions: { preserveEntrySignatures: 'strict' },
    },
  })
  const builds = Array.isArray(result) ? result : [result]
  const code = builds.flatMap((output) => {
    if (!('output' in output)) throw new Error('Package-size build unexpectedly entered watch mode')
    return output.output.flatMap((artifact) => (artifact.type === 'chunk' ? [artifact.code] : []))
  })
  if (code.length === 0) throw new Error(`Package-size entry emitted no JavaScript: ${entry}`)
  return new TextEncoder().encode(code.join('\n'))
}

function compression(bytes: Uint8Array): Pick<MeasuredEntry, 'gzipBytes' | 'brotliBytes'> {
  return {
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  }
}

async function measureJavaScript(id: string, label: string, entry: URL): Promise<MeasuredEntry> {
  const [raw, minified] = await Promise.all([
    bundle(fileURLToPath(entry), false),
    bundle(fileURLToPath(entry), 'oxc'),
  ])
  return {
    id,
    label,
    status: 'measured',
    format: 'javascript',
    rawBytes: raw.byteLength,
    minifiedBytes: minified.byteLength,
    ...compression(minified),
  }
}

async function measureWasm(): Promise<MeasuredEntry> {
  const bytes = await readFile(
    new URL('../../../packages/font-baker/dist/font_baker.wasm', import.meta.url),
  )
  return {
    id: 'portable-baker-wasm',
    label: 'Portable baker Wasm',
    status: 'measured',
    format: 'wasm',
    rawBytes: bytes.byteLength,
    minifiedBytes: bytes.byteLength,
    ...compression(bytes),
  }
}

const entries: SizeEntry[] = [
  await measureJavaScript(
    'browser-core',
    'Browser core',
    new URL('../size-entries/text-core.ts', import.meta.url),
  ),
  await measureJavaScript(
    'portable-baker-js',
    'Portable baker JS',
    new URL('../size-entries/font-baker.ts', import.meta.url),
  ),
  await measureWasm(),
  {
    id: 'unicode-properties',
    label: 'Unicode property tables',
    status: 'unavailable',
    reason: 'Version-pinned JavaScript tables land with the paragraph engine in milestone 5.',
  },
]

const report = {
  schemaVersion: 0,
  entries,
}
const output = new URL('../src/generated/package-sizes.json', import.meta.url)
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true })
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
