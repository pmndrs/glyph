import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SOURCE_URL =
  'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/metadata/icons.json'
const SOURCE_SHA256 = 'a3a705d0e03c4fbdf1a61aece3d8fd462024b33794187ef7ee2a0764439170eb'
const OUTPUT = resolve('fixtures/fonts/font-awesome-free-6.7.2/icons.json')
const sourceArgument = process.argv
  .find((argument) => argument.startsWith('--source='))
  ?.slice('--source='.length)
const check = process.argv.includes('--check')

const sourceBytes =
  sourceArgument === undefined
    ? new Uint8Array(await (await fetch(SOURCE_URL)).arrayBuffer())
    : new Uint8Array(await readFile(resolve(sourceArgument)))
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
if (sourceSha256 !== SOURCE_SHA256) {
  throw new Error(`Font Awesome metadata SHA-256 mismatch: ${sourceSha256}`)
}

const metadata = JSON.parse(new TextDecoder().decode(sourceBytes)) as Record<
  string,
  { readonly free?: readonly string[]; readonly unicode?: string }
>
const icons = Object.entries(metadata)
  .filter(([, icon]) => icon.free?.includes('solid') === true)
  .map(([name, icon]) => {
    if (icon.unicode === undefined || !/^[0-9a-f]+$/u.test(icon.unicode)) {
      throw new TypeError(`Font Awesome solid icon ${name} has no valid Unicode scalar`)
    }
    const codePoint = Number.parseInt(icon.unicode, 16)
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      throw new RangeError(`Font Awesome solid icon ${name} has an invalid Unicode scalar`)
    }
    return { name, codePoint }
  })

if (icons.length !== 1_402) {
  throw new Error(`Expected 1,402 Font Awesome solid icons, received ${icons.length}`)
}
if (new Set(icons.map(({ name }) => name)).size !== icons.length) {
  throw new Error('Font Awesome solid icon names must be unique')
}
if (new Set(icons.map(({ codePoint }) => codePoint)).size !== icons.length) {
  throw new Error('Font Awesome solid icon code points must be unique')
}

const generated = `${JSON.stringify(
  {
    schemaVersion: 0,
    source: {
      version: '6.7.2',
      url: SOURCE_URL,
      sha256: SOURCE_SHA256,
    },
    icons,
  },
  undefined,
  2,
)}\n`

if (check) {
  const current = await readFile(OUTPUT, 'utf8')
  if (current !== generated) throw new Error('Font Awesome icon metadata is stale')
} else {
  await writeFile(OUTPUT, generated)
}
