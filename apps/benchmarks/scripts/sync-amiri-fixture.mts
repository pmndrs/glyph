import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const commit = '39d11bc313031c9f68e21a297ce5e4a15cc5365e'
const directory = resolve('fixtures/fonts/amiri-1.002')
const check = process.argv.includes('--check')
const files = [
  {
    name: 'Amiri-Regular.ttf',
    sha256: 'ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7',
  },
  {
    name: 'OFL.txt',
    sha256: '72de68e5954f4fdd24702292ef5a32f003ca960ec9330dc86e5eefb5dffb9b22',
  },
  {
    name: 'METADATA.pb',
    sha256: '3df4f62489d9b01bb900d36e73120c06dfed0c49b585ff4398fd8a11410fd114',
  },
] as const

if (!check) await mkdir(directory, { recursive: true })
for (const file of files) {
  const url = `https://raw.githubusercontent.com/google/fonts/${commit}/ofl/amiri/${file.name}`
  const bytes = check
    ? await readFile(resolve(directory, file.name))
    : Buffer.from(await (await fetch(url)).arrayBuffer())
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== file.sha256) {
    throw new Error(`${file.name} SHA-256 mismatch: expected ${file.sha256}, received ${actual}`)
  }
  if (!check) await writeFile(resolve(directory, file.name), bytes)
}
