import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import * as THREE from 'three/webgpu'

import { slug } from '../../dist/raster/slug.js'

const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09'
const rasterKey = '4c443186198f07fa3e1c5722e21fc24947627315e6115d1ea0fa6ed041d11975'

test('Slug uploads exact integer resources and preserves consecutive page runs', async (context) => {
  const warnings = context.mock.method(console, 'warn', () => {})
  const errors = context.mock.method(console, 'error', () => {})
  const records = makeRecords([0, 1, 0, 0xffff])
  const curve = makeRgba16fKtx2(2, 1, new Uint8Array(16))
  const headers = bytesOf(Uint32Array.of(1 << 16))
  const references = bytesOf(Uint16Array.of(0))
  const views = [records, curve, headers, references, curve, headers, references]
  const font = {
    handle: 7,
    shapingHash,
    glyphCount: 4,
  }
  const raster = {
    font: 7,
    kind: 'slug',
    extension: 'PMNDRS_font_slug',
    version: 0,
    rasterKey,
    extensionData: {
      version: 0,
      rasterKey,
      shapingHash,
      glyphCount: 4,
      glyphIdWidth: 16,
      planeUnitsPerEm: 2048,
      recordBufferView: 0,
      recordStride: 40,
      pages: [page(1, 2, 3), page(4, 5, 6)],
    },
    view(index) {
      const value = views[index]
      if (value === undefined) throw new RangeError('missing test view')
      return value
    },
    async resource(source) {
      if (source.type !== 'bufferView') throw new TypeError('unexpected external resource')
      return this.view(source.bufferView)
    },
  }
  const resource = await slug.decode(font, raster)
  assert.equal(resource.gpuBytes, 48)
  assert.equal(resource.pages.length, 2)
  assert.ok(resource.pages[0].curveTexture.image.data instanceof Uint16Array)
  assert.ok(resource.pages[0].headerTexture.image.data instanceof Uint32Array)
  assert.ok(resource.pages[0].referenceTexture.image.data instanceof Uint32Array)
  assert.deepEqual(Array.from(resource.pages[0].referenceTexture.image.data), [0])
  assert.equal(resource.pages[0].curveTexture.type, THREE.HalfFloatType)
  assert.equal(resource.pages[0].headerTexture.format, THREE.RedIntegerFormat)
  assert.equal(resource.pages[0].headerTexture.type, THREE.UnsignedIntType)
  assert.equal(resource.pages[0].referenceTexture.type, THREE.UnsignedIntType)

  const layout = {
    glyphIds: Uint16Array.of(0, 1, 2, 3),
    glyphFontSlots: Uint16Array.of(0, 0, 0, 0),
    glyphFontSizes: Float32Array.of(16, 16, 16, 16),
    x: Float32Array.of(1, 2, 3, 4),
    y: Float32Array.of(5, 6, 7, 8),
  }
  const paint = {
    paintIndices: Uint16Array.of(0, 0, 0, 0),
    palette: [{ color: [0.25, 0.5, 0.75, 1] }],
  }
  const batch = slug.buildBatches(layout, resource, 0, paint, 1)
  assert.equal(batch.glyphCount, 3)
  assert.equal(batch.drawCount, 3)
  assert.deepEqual(
    batch.object.children.map((child) => child.renderOrder),
    [0, 1, 2],
  )
  for (const child of batch.object.children) {
    const curveBase = child.geometry.getAttribute('slugCurveBase')
    const horizontalBandCount = child.geometry.getAttribute('slugHorizontalBandCount')
    assert.ok(curveBase.data.array instanceof Uint32Array)
    assert.equal(horizontalBandCount.data, curveBase.data)
    assert.equal(child.frustumCulled, false)
  }
  assert.equal(
    batch.object.children[0].geometry.getAttribute('slugOutlineColor'),
    undefined,
    'fill-only batches allocate no outline instance buffer',
  )

  batch.object.position.set(12, -4, 0)
  batch.object.updateMatrixWorld(true)
  const firstMesh = batch.object.children[0]
  const viewport = new THREE.Vector2()
  let queriedDrawingBuffer = false
  firstMesh.onBeforeRender(
    {
      getDrawingBufferSize(target) {
        queriedDrawingBuffer = true
        return target.set(1600, 900)
      },
    },
    {},
    new THREE.OrthographicCamera(-1, 1, 1, -1),
  )
  assert.equal(queriedDrawingBuffer, true)
  assert.deepEqual(viewport.toArray(), [0, 0], 'render hook does not retain caller-owned state')

  batch.updatePaint({
    paintIndices: Uint16Array.of(0, 0, 0, 0),
    palette: [{ color: [1, 0, 0, 0.5] }],
  })
  const firstColor = firstMesh.geometry.getAttribute('slugColor')
  assert.deepEqual(
    [firstColor.getX(0), firstColor.getY(0), firstColor.getZ(0), firstColor.getW(0)],
    [1, 0, 0, 0.5],
  )

  const outlinedPaint = {
    paintIndices: Uint16Array.of(0, 0, 0, 0),
    palette: [{ color: [1, 1, 1, 1], outline: { color: [0.1, 0.2, 0.3, 0.75], width: 0.8 } }],
  }
  const fillMaterial = firstMesh.material
  batch.updatePaint(outlinedPaint)
  assert.equal(batch.drawCount, 3)
  assert.equal(batch.object.children.length, 3)
  assert.deepEqual(
    batch.object.children.map(({ renderOrder }) => renderOrder),
    [0, 1, 2],
  )
  assert.notEqual(firstMesh.material, fillMaterial, 'outline selects one specialized material')
  const outlinedMaterial = firstMesh.material
  const outlineColor = firstMesh.geometry.getAttribute('slugOutlineColor')
  const outlineHalfWidth = firstMesh.geometry.getAttribute('slugOutlineHalfWidth')
  assert.notEqual(outlineColor.data, firstColor.data, 'outline values use a lazy separate buffer')
  assert.deepEqual(
    [outlineColor.getX(0), outlineColor.getY(0), outlineColor.getZ(0), outlineColor.getW(0)],
    [...Float32Array.of(0.1, 0.2, 0.3, 0.75)],
  )
  assert.equal(outlineHalfWidth.getX(0), Float32Array.of(0.05)[0])
  queriedDrawingBuffer = false
  firstMesh.onBeforeRender(
    {
      getDrawingBufferSize(target) {
        queriedDrawingBuffer = true
        return target.set(1600, 900)
      },
    },
    {},
    new THREE.OrthographicCamera(-1, 1, 1, -1),
  )
  assert.equal(queriedDrawingBuffer, true, 'outlined material owns a physical viewport hook')

  batch.updatePaint({
    paintIndices: Uint16Array.of(0, 0, 0, 0),
    palette: [{ color: [1, 1, 1, 1], outline: { color: [1, 0, 0, 1], width: 0 } }],
  })
  assert.equal(batch.drawCount, 3, 'zero-width outline remains one draw per page run')
  assert.equal(batch.object.children.length, 3, 'zero-width repaint retains batch identity')
  assert.equal(firstMesh.material, fillMaterial, 'zero width restores the fill-only pipeline')

  batch.updatePaint(outlinedPaint)
  assert.equal(batch.drawCount, 3)
  assert.equal(batch.object.children.length, 3, 're-enabling outline does not rebuild meshes')
  assert.equal(firstMesh.material, outlinedMaterial, 'outlined pipeline is reused')

  const mixedBatch = slug.buildBatches(
    {
      glyphIds: Uint16Array.of(0, 0),
      glyphFontSlots: Uint16Array.of(0, 0),
      glyphFontSizes: Float32Array.of(16, 16),
      x: Float32Array.of(0, 16),
      y: Float32Array.of(16, 16),
    },
    resource,
    0,
    {
      paintIndices: Uint16Array.of(0, 1),
      palette: [
        { color: [1, 1, 1, 1], outline: { color: [1, 0, 0, 1], width: 0.8 } },
        { color: [1, 1, 1, 1] },
      ],
    },
    1,
  )
  assert.equal(mixedBatch.drawCount, 1, 'mixed per-instance outline remains one batch')
  assert.equal(mixedBatch.object.children.length, 1)
  const mixedWidths = mixedBatch.object.children[0].geometry.getAttribute('slugOutlineHalfWidth')
  assert.equal(mixedWidths.getX(0), Float32Array.of(0.05)[0])
  assert.equal(mixedWidths.getX(1), 0, 'zero-width contribution remains in the shared batch')
  const mixedMesh = mixedBatch.object.children[0]
  const mixedMaterial = mixedMesh.material
  const mixedColors = mixedMesh.geometry.getAttribute('slugColor')
  const initialMixedColor = [
    mixedColors.getX(0),
    mixedColors.getY(0),
    mixedColors.getZ(0),
    mixedColors.getW(0),
  ]
  assert.throws(
    () =>
      mixedBatch.updatePaint({
        paintIndices: Uint16Array.of(0, 1),
        palette: [
          { color: [0, 1, 0, 1] },
          { color: [1, 1, 1, 1], outline: { color: [0, 0, 0, 1], width: 1 } },
        ],
      }),
    /exceeds 0\.05 em/,
  )
  assert.deepEqual(
    [mixedColors.getX(0), mixedColors.getY(0), mixedColors.getZ(0), mixedColors.getW(0)],
    initialMixedColor,
    'failed paint validation leaves earlier instance colors unchanged',
  )
  assert.equal(mixedWidths.getX(0), Float32Array.of(0.05)[0])
  assert.equal(
    mixedMesh.material,
    mixedMaterial,
    'failed paint validation preserves material state',
  )
  mixedBatch.dispose()
  assert.throws(
    () =>
      batch.updatePaint({
        paintIndices: Uint16Array.of(0, 0, 0, 0),
        palette: [{ color: [1, 1, 1, 1], shadow: { color: [0, 0, 0, 1], offset: [1, 1] } }],
      }),
    /does not support shadow paint/,
  )
  assert.throws(
    () =>
      batch.updatePaint({
        paintIndices: Uint16Array.of(0, 0, 0, 0),
        palette: [{ color: [1, 1, 1, 1], outline: { color: [0, 0, 0, 1], width: 1 } }],
      }),
    /exceeds 0\.05 em/,
  )

  batch.dispose()
  batch.dispose()
  assert.equal(batch.object.children.length, 0)
  assert.throws(() => batch.updatePaint(paint), /disposed/)

  let disposedTextures = 0
  for (const pageResource of resource.pages) {
    for (const texture of [
      pageResource.curveTexture,
      pageResource.headerTexture,
      pageResource.referenceTexture,
    ]) {
      texture.addEventListener('dispose', () => {
        disposedTextures += 1
      })
    }
  }
  slug.dispose(resource)
  assert.equal(disposedTextures, 6)
  assert.equal(warnings.mock.callCount(), 0, 'Three emitted no TSL warnings')
  assert.equal(errors.mock.callCount(), 0, 'Three emitted no TSL errors')
})

test('Slug resolves authenticated external page payloads through raster residency', async () => {
  const records = makeRecords([0])
  const curve = makeRgba16fKtx2(2, 1, new Uint8Array(16))
  const headers = bytesOf(Uint32Array.of(1 << 16))
  const references = bytesOf(Uint16Array.of(0))
  const views = [records, headers, references]
  const resolved = []
  const font = { handle: 3, shapingHash, glyphCount: 1 }
  const raster = {
    font: 3,
    kind: 'slug',
    extension: 'PMNDRS_font_slug',
    version: 0,
    rasterKey,
    extensionData: {
      version: 0,
      rasterKey,
      shapingHash,
      glyphCount: 1,
      glyphIdWidth: 16,
      planeUnitsPerEm: 2048,
      recordBufferView: 0,
      recordStride: 40,
      pages: [
        {
          ...page(0, 1, 2),
          curve: {
            width: 2,
            height: 1,
            mipLevelCount: 1,
            colorSpace: 'linear',
            variants: [
              {
                container: 'ktx2',
                gpuFormat: 'rgba16float',
                quality: 'lossless',
                source: {
                  type: 'external',
                  uri: 'curves.ktx2',
                  byteLength: curve.byteLength,
                  artifactHash: hash(curve),
                },
              },
            ],
          },
        },
      ],
    },
    view(index) {
      const value = views[index]
      if (value === undefined) throw new RangeError('unexpected view')
      return value
    },
    async resource(source) {
      resolved.push(source)
      return source.type === 'external' ? curve.slice() : this.view(source.bufferView)
    },
  }
  const resource = await slug.decode(font, raster)
  assert.deepEqual(
    resolved.map(({ type }) => type),
    ['external', 'bufferView', 'bufferView'],
  )
  assert.equal(resource.gpuBytes, 24)
  slug.dispose(resource)
})

function page(curveView, headerView, referenceView) {
  return {
    curve: {
      width: 2,
      height: 1,
      mipLevelCount: 1,
      colorSpace: 'linear',
      variants: [
        {
          container: 'ktx2',
          gpuFormat: 'rgba16float',
          quality: 'lossless',
          source: { type: 'bufferView', bufferView: curveView },
        },
      ],
    },
    headerCount: 1,
    headerWidth: 1,
    headerHeight: 1,
    headerResource: { source: { type: 'bufferView', bufferView: headerView } },
    referenceCount: 1,
    referenceWidth: 1,
    referenceHeight: 1,
    referenceResource: { source: { type: 'bufferView', bufferView: referenceView } },
  }
}

function makeRecords(pages) {
  const records = new Uint8Array(pages.length * 40)
  const view = new DataView(records.buffer)
  pages.forEach((pageIndex, glyphId) => {
    const offset = glyphId * 40
    view.setUint16(offset + 8, pageIndex, true)
    if (pageIndex === 0xffff) return
    view.setInt16(offset, 0, true)
    view.setInt16(offset + 2, 0, true)
    view.setInt16(offset + 4, 2048, true)
    view.setInt16(offset + 6, 2048, true)
    view.setUint16(offset + 10, 1, true)
    view.setUint16(offset + 12, 1, true)
    view.setUint32(offset + 20, 2, true)
    view.setUint32(offset + 36, 1, true)
  })
  return records
}

function bytesOf(values) {
  return new Uint8Array(values.buffer.slice(0))
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeRgba16fKtx2(width, height, texels) {
  const dfd = Uint8Array.from([
    0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x58, 0x00, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xc0, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f, 0x10, 0x00, 0x0f, 0xc1, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f, 0x20, 0x00, 0x0f, 0xc2, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f, 0x30, 0x00, 0x0f, 0xcf, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f,
  ])
  const dfdOffset = 104
  const dfdLength = dfd.byteLength + 4
  const levelOffset = (dfdOffset + dfdLength + 3) & ~3
  const output = new Uint8Array(levelOffset + texels.byteLength)
  output.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(output.buffer)
  view.setUint32(12, 97, true)
  view.setUint32(16, 2, true)
  view.setUint32(20, width, true)
  view.setUint32(24, height, true)
  view.setUint32(36, 1, true)
  view.setUint32(40, 1, true)
  view.setUint32(48, dfdOffset, true)
  view.setUint32(52, dfdLength, true)
  view.setBigUint64(80, BigInt(levelOffset), true)
  view.setBigUint64(88, BigInt(texels.byteLength), true)
  view.setBigUint64(96, BigInt(texels.byteLength), true)
  view.setUint32(dfdOffset, dfdLength, true)
  output.set(dfd, dfdOffset + 4)
  output.set(texels, levelOffset)
  return output
}
