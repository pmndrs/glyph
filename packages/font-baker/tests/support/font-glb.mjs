import assert from 'node:assert/strict'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

export function assertFontGlb(bytes) {
  assert(bytes.byteLength >= 28, 'GLB has a header and JSON chunk')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint32(0, true), GLB_MAGIC, 'GLB magic')
  assert.equal(view.getUint32(4, true), 2, 'GLB version')
  assert.equal(view.getUint32(8, true), bytes.byteLength, 'GLB declared length')

  const chunks = []
  let cursor = 12
  while (cursor < bytes.byteLength) {
    assert(cursor + 8 <= bytes.byteLength, 'GLB chunk header is in range')
    const byteLength = view.getUint32(cursor, true)
    const type = view.getUint32(cursor + 4, true)
    const start = cursor + 8
    const end = start + byteLength
    assert.equal(byteLength % 4, 0, 'GLB chunk length is four-byte aligned')
    assert(end <= bytes.byteLength, 'GLB chunk payload is in range')
    chunks.push({ type, start, end, byteLength })
    cursor = end
  }
  assert.equal(cursor, bytes.byteLength, 'GLB chunks consume the declared length')
  assert.equal(chunks.length, 2, 'font GLB has JSON and BIN chunks')
  assert.equal(chunks[0].type, JSON_CHUNK, 'JSON is the first GLB chunk')
  assert.equal(chunks[1].type, BIN_CHUNK, 'BIN is the second GLB chunk')

  const jsonBytes = bytes.subarray(chunks[0].start, chunks[0].end)
  const document = JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd())
  assert.equal(document.asset?.version, '2.0')
  assert(document.extensionsUsed?.includes('PMNDRS_font'))
  assert(document.extensionsRequired?.includes('PMNDRS_font'))

  assert.equal(document.buffers?.length, 1)
  const declaredBinLength = document.buffers[0].byteLength
  assert(Number.isSafeInteger(declaredBinLength) && declaredBinLength >= 0)
  assert(declaredBinLength <= chunks[1].byteLength)
  assert(chunks[1].byteLength - declaredBinLength <= 3, 'BIN has alignment padding only')

  const bufferViews = document.bufferViews
  assert(Array.isArray(bufferViews) && bufferViews.length >= 3)
  for (const bufferView of bufferViews) {
    const offset = bufferView.byteOffset ?? 0
    assert.equal(bufferView.buffer, 0)
    assert(Number.isSafeInteger(offset) && offset >= 0)
    assert(Number.isSafeInteger(bufferView.byteLength) && bufferView.byteLength >= 0)
    assert.equal(offset % 4, 0, 'font buffer view is four-byte aligned')
    assert(offset + bufferView.byteLength <= declaredBinLength)
  }

  const extension = document.extensions?.PMNDRS_font
  assert.equal(extension?.version, 0)
  assert.equal(extension?.shaping?.format, 'opentype-sfnt-harfrust-v0')
  const shapingView = readBufferView(bufferViews, extension.shaping.bufferView)
  const extentsView = readBufferView(
    bufferViews,
    extension.shaping.fontFunctions.glyphExtentsBufferView,
  )
  const availabilityView = readBufferView(
    bufferViews,
    extension.shaping.fontFunctions.glyphExtentsAvailabilityBufferView,
  )
  assert.equal(extension.shaping.fontFunctions.glyphExtentsStride, 8)
  assert.equal(extentsView.byteLength, extension.metrics.glyphCount * 8)
  assert.equal(availabilityView.byteLength, Math.ceil(extension.metrics.glyphCount / 8))

  const bin = bytes.subarray(chunks[1].start, chunks[1].end)
  const sfnt = new DataView(
    bin.buffer,
    bin.byteOffset + (shapingView.byteOffset ?? 0),
    shapingView.byteLength,
  )
  const scalerType = sfnt.getUint32(0, false)
  assert(
    scalerType === 0x00010000 || scalerType === 0x4f54544f,
    'shaping payload is a TrueType or CFF OpenType SFNT',
  )

  return document
}

function readBufferView(bufferViews, index) {
  assert(Number.isSafeInteger(index) && index >= 0 && index < bufferViews.length)
  return bufferViews[index]
}
