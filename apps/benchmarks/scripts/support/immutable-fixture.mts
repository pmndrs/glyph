import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface ImmutableFixtureFile {
  readonly localName: string
  readonly remotePath: string
  readonly sha256: string
}

export async function syncImmutableFixture(options: {
  readonly baseUrl: string
  readonly check: boolean
  readonly directory: string
  readonly files: readonly ImmutableFixtureFile[]
}): Promise<void> {
  if (!options.check) await mkdir(options.directory, { recursive: true })
  for (const file of options.files) {
    const bytes = options.check
      ? await readFile(resolve(options.directory, file.localName))
      : await download(`${options.baseUrl}/${file.remotePath}`)
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== file.sha256) {
      throw new Error(
        `${file.localName} SHA-256 mismatch: expected ${file.sha256}, received ${actual}`,
      )
    }
    if (!options.check) await writeFile(resolve(options.directory, file.localName), bytes)
  }
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fixture request failed with HTTP ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}
