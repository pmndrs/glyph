import type { RasterKey } from '../identity.js'
import type { JsonValue } from '../raster.js'

const textEncoder = new TextEncoder()

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`${path} contains an unpaired high surrogate`)
      }
      index += 1
      continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(`${path} contains an unpaired low surrogate`)
    }
  }
}

function canonicalize(value: unknown, path: string): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`)
    return JSON.stringify(value)
  }

  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path)
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalize(entry, `${path}/${index}`)).join(',')}]`
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    const members: string[] = []
    for (const key of Object.keys(object).sort()) {
      assertUnicodeScalarString(key, `${path}/<key>`)
      members.push(`${JSON.stringify(key)}:${canonicalize(object[key], `${path}/${key}`)}`)
    }
    return `{${members.join(',')}}`
  }

  throw new TypeError(`${path} is not a JSON value`)
}

/** RFC 8785 JSON Canonicalization Scheme serialization. */
export function canonicalJson(value: JsonValue): string {
  return canonicalize(value, '$')
}

function hexadecimal(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

/** Derive a caller-independent raster key from a module-owned descriptor. */
export async function deriveRasterKey(input: {
  readonly descriptor: JsonValue
  readonly extension: string
  readonly kind: string
  readonly version: number
}): Promise<RasterKey> {
  const canonical = canonicalJson({
    descriptor: input.descriptor,
    extension: input.extension,
    kind: input.kind,
    version: input.version,
  })
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(canonical))
  return hexadecimal(new Uint8Array(digest)) as RasterKey
}
