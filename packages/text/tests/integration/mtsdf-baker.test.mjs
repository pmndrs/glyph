import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as THREE from 'three/webgpu'

import {
  createMtsdfBaker,
  createMtsdfBakerFromInstance,
  msdfBakerFromCore,
  readMtsdfBakerAbi,
} from '@pmndrs/text/bakers/msdf'
import {
  MtsdfArtifactValidationError,
  validateMtsdfArtifact,
} from '@pmndrs/text/bakers/msdf/validate'
import {
  MSDF_EXTENSION,
  MTSDF_EM_SIZE,
  MTSDF_PIXEL_RANGE,
  MTSDF_PLANE_UNITS_PER_EM,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
} from '@pmndrs/text/raster/msdf'

const wasmUrl = new URL('../../dist/mtsdf_baker.wasm', import.meta.url)
const abiUrl = new URL('../../dist/mtsdf-baker-abi-v1.json', import.meta.url)
const fontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
  import.meta.url,
)
const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09'
const publishedAbi = JSON.parse(await readFile(abiUrl, 'utf8'))
const progressImports = { env: { pmndrs_text_bake_progress() {} } }

async function setup() {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(fontUrl)])
  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, progressImports)
  return {
    source: new Uint8Array(source),
    module,
    instance,
    core: await createMtsdfBaker(module),
  }
}

test('ships one generated progress import and bundles its artifact contract in TypeScript', async () => {
  const { module, instance } = await setup()
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'env', name: 'pmndrs_text_bake_progress', kind: 'function' },
  ])
  const generated = readMtsdfBakerAbi(instance)
  assert.deepEqual(generated, publishedAbi)
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  )
  assert.deepEqual(generated.artifactBaker.versions, {
    generator: '0.0.0',
    ktx2: '0.5.0',
    msdfFormat: 0,
    readFonts: '0.42.1',
    skrifa: '0.45.1',
  })
})

test('bakes canonical Inter through the public direct-memory shim', async () => {
  const { source, core } = await setup()
  const descriptor = msdfDescriptor()
  const rasterKey = await msdfDescriptorRasterKey()
  assert.equal(rasterKey, 'e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93')
  const result = await msdfBakerFromCore(core).bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'external', pages: 'external' },
    descriptor,
  })

  assert.equal(result.kind, 'msdf')
  assert.equal(result.extension, MSDF_EXTENSION)
  assert.equal(result.version, 0)
  assert.equal(result.report.metadataBytes, 2937 * 20)
  assert.ok(result.report.gpuBytes > 0)
  assert.ok(result.report.pages.length > 0)
  assert.ok(result.report.pages.every((page) => page.format === 'rgba8unorm'))
  const raster = result.artifacts.find((artifact) => artifact.role === 'raster')
  assert.ok(raster)
  assert.match(raster.id, new RegExp(`^msdf-${shapingHash}-${rasterKey}\\.glb$`))
  const pages = result.artifacts.filter((artifact) => artifact.role === 'raster-page')
  assert.equal(pages.length, result.report.pages.length)
  for (const [index, page] of pages.entries()) {
    assert.match(page.id, new RegExp(`^msdf-${shapingHash}-${rasterKey}-p${index}\\.ktx2$`))
    assert.deepEqual(
      [...page.bytes.subarray(0, 12)],
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
    )
  }
  const extension = glbRoot(raster.bytes).extensions[MSDF_EXTENSION]
  assert.deepEqual(
    result.artifacts.map(({ bytes, sha256 }) => [bytes.byteLength, sha256]),
    [
      [63_720, 'caf3682e43eba0264ece5c37112e2fd031a1f052f9f9b2d8675dc723d2dce651'],
      [3_989_700, 'f208082adb4f6691f3b0910f5eee58bb58a0b546691a422e0610cfcb377bc841'],
      [4_190_404, '6af434e8459582b961cdb98e2b1b5963b6f7b6b6aff93494793e0629b8f88ae7'],
      [4_161_760, 'e12571a7ab0c74a8776e0f93d8752eecd2433d1034e3665fc5f3eae45e2ecb81'],
      [4_137_316, 'a58cfceb56111a8c70ac2c361f518263e4917e27b72517ab7facd91b8b5fd228'],
      [4_051_140, '77c020c96f930fac803aecc56aec9ac5e9af2077204c6a233d715525f89d28d6'],
      [3_969_644, '4c6243ec2b1b354148b41657dc0f5f82c21a5770897cb55aa3e644bc85298736'],
      [3_845_356, 'efc6bbe31c292afd40ba266d8eb4d819bb37731fd8dea7ab165122f9196444bd'],
      [4_178_128, '309903b82130a9b16c5c31d7405d1f4e375352476f6aabc82fae88dde4147a82'],
      [4_186_308, '716ef2c45e4b6dcddcbdce95e0511abfe07a7ff27205a2372ccc850c9e7960ac'],
      [2_403_940, 'ba146812b0a73fbb82e9bebbf360fd2b5393e64de0202e28b3b635ec1fdc8dc7'],
    ],
  )
  assert.equal(extension.encoding, 'mtsdf')
  assert.equal(extension.emSize, MTSDF_EM_SIZE)
  assert.equal(extension.pixelRange, MTSDF_PIXEL_RANGE)
  assert.equal(extension.planeUnitsPerEm, MTSDF_PLANE_UNITS_PER_EM)
  assert.equal(extension.recordStride, 20)
  assert.equal(extension.pages.length, pages.length)
  await exerciseArtifactValidation(result, raster, pages, rasterKey)
  await exerciseRuntime(result, raster, extension, rasterKey)
})

test('keeps the packaged MTSDF schema byte-identical to its canonical source', async () => {
  assert.deepEqual(
    await readFile(
      new URL(
        '../../../../docs/planning/extensions/PMNDRS_font_distance_field/schema/glTF.PMNDRS_font_distance_field.schema.json',
        import.meta.url,
      ),
    ),
    await readFile(
      new URL(
        '../../src/bakers/schemas/glTF.PMNDRS_font_distance_field.schema.json',
        import.meta.url,
      ),
    ),
  )
})

test('releases a source allocation when the request allocation fails', () => {
  const released = []
  let allocations = 0
  const core = createMtsdfBakerFromInstance(
    fakeMtsdfBakerInstance({
      allocate: () => (++allocations === 1 ? 4096 : 0),
      deallocate: (pointer, length) => released.push([pointer, length]),
    }),
  )
  assert.throws(
    () =>
      core.bake({
        source: new Uint8Array(8),
        request: {
          fontFaceIndex: 0,
          glyphCount: 1,
          shapingHash: '0'.repeat(64),
          rasterKey: '0'.repeat(64),
          packaging: { artifact: 'external', pages: 'embedded' },
          descriptor: msdfDescriptor(),
        },
      }),
    /allocation failed/,
  )
  assert.deepEqual(released, [[4096, 8]])
})

test('copies a segmented response in bounded chunks and releases its Wasm ownership', () => {
  const artifactBytes = Uint8Array.from({ length: 10 }, (_, index) => index + 1)
  const metadata = {
    rasterKey: '1'.repeat(64),
    kind: 'msdf',
    extension: MSDF_EXTENSION,
    version: 0,
    artifacts: [
      {
        role: 'raster',
        id: 'segmented.glb',
        sha256: '2'.repeat(64),
        byteOffset: 0,
        byteLength: artifactBytes.byteLength,
      },
    ],
    report: {
      metadataBytes: 20,
      serializedBytes: artifactBytes.byteLength,
      gpuBytes: 4,
      pages: [
        {
          width: 1,
          height: 1,
          format: 'rgba8unorm',
          gpuBytes: 4,
          source: 'embedded',
          encodedBytes: artifactBytes.byteLength,
        },
      ],
    },
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata))
  const metadataPointer = 8_192
  const artifactPointer = 16_384
  let allocationPointer = 32_768
  let releases = 0
  const chunkOffsets = []
  const instance = fakeMtsdfBakerInstance({
    allocate: (length) => {
      const pointer = allocationPointer
      allocationPointer += length
      return pointer
    },
    segmented: {
      status: () => 0,
      metadataPointer: () => metadataPointer,
      metadataByteLength: () => metadataBytes.byteLength,
      artifactCount: () => 1,
      artifactByteLength: () => artifactBytes.byteLength,
      chunkPointer: (_index, offset) => artifactPointer + offset,
      chunkByteLength: (_index, offset) => {
        chunkOffsets.push(offset)
        return Math.min(4, artifactBytes.byteLength - offset)
      },
      release: () => releases++,
    },
  })
  new Uint8Array(instance.exports.memory.buffer, metadataPointer, metadataBytes.byteLength).set(
    metadataBytes,
  )
  new Uint8Array(instance.exports.memory.buffer, artifactPointer, artifactBytes.byteLength).set(
    artifactBytes,
  )

  const result = createMtsdfBakerFromInstance(instance).bake({
    source: new Uint8Array([1]),
    request: {
      fontFaceIndex: 0,
      glyphCount: 1,
      shapingHash: '0'.repeat(64),
      rasterKey: '1'.repeat(64),
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: msdfDescriptor(),
    },
  })

  assert.deepEqual(result.artifacts[0].bytes, artifactBytes)
  assert.deepEqual(chunkOffsets, [0, 4, 8])
  assert.equal(releases, 1)
})

function glbRoot(bytes) {
  assert.deepEqual([...bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
}

async function exerciseArtifactValidation(result, rasterArtifact, pageArtifacts, rasterKey) {
  const context = {
    rasterKey,
    shapingHash,
    glyphCount: 2937,
    glyphIdWidth: 16,
    descriptor: msdfDescriptor(),
  }
  const externalPages = new Map(pageArtifacts.map(({ id, bytes }) => [id, bytes]))
  const external = await validateMtsdfArtifact(rasterArtifact.bytes, {
    ...context,
    externalPages,
  })
  assert.equal(external.khronos.validatorVersion, '2.0.0-dev.3.10')
  assert.equal(external.khronos.issues.numErrors, 0)
  assert.equal(external.khronos.issues.numWarnings, 0)
  assert.equal(external.records.byteLength, 2937 * 20)
  assert.equal(external.pages.length, result.report.pages.length)
  assert.ok(external.pages.every(({ source }) => source === 'external'))

  const embeddedBytes = embedRasterPages(rasterArtifact.bytes, pageArtifacts)
  const embedded = await validateMtsdfArtifact(embeddedBytes, context)
  assert.deepEqual(embedded.records, external.records)
  assert.ok(embedded.pages.every(({ source }) => source === 'embedded'))
  assert.deepEqual(
    embedded.pages.map(({ bytes }) => bytes),
    external.pages.map(({ bytes }) => bytes),
  )

  const required = [
    'version',
    'rasterKey',
    'shapingHash',
    'glyphCount',
    'glyphIdWidth',
    'encoding',
    'emSize',
    'pixelRange',
    'planeUnitsPerEm',
    'recordBufferView',
    'recordStride',
    'pages',
  ]
  for (const field of required) {
    const document = structuredClone(glbRoot(embeddedBytes))
    delete document.extensions[MSDF_EXTENSION][field]
    await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_')
  }
  for (const field of ['width', 'height', 'mipLevelCount', 'colorSpace', 'variants']) {
    const document = structuredClone(glbRoot(embeddedBytes))
    delete document.extensions[MSDF_EXTENSION].pages[0][field]
    await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_')
  }
  for (const field of ['source', 'container', 'gpuFormat', 'quality']) {
    const document = structuredClone(glbRoot(embeddedBytes))
    delete document.extensions[MSDF_EXTENSION].pages[0].variants[0][field]
    await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_')
  }
  for (const field of ['type', 'bufferView']) {
    const document = structuredClone(glbRoot(embeddedBytes))
    delete document.extensions[MSDF_EXTENSION].pages[0].variants[0].source[field]
    await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_')
  }

  const decoded = decodeGlb(embeddedBytes)
  const extension = decoded.document.extensions[MSDF_EXTENSION]
  const recordView = decoded.document.bufferViews[extension.recordBufferView]
  const recordsStart = decoded.binStart + recordView.byteOffset
  const present = firstPresentGlyph(embedded.records)

  const wrongIdentity = structuredClone(decoded.document)
  wrongIdentity.extensions[MSDF_EXTENSION].shapingHash = '0'.repeat(64)
  await rejectsMtsdf(
    rewriteGlbDocument(embeddedBytes, wrongIdentity),
    context,
    'RECIPROCAL_IDENTITY',
  )

  const wrongConstant = structuredClone(decoded.document)
  wrongConstant.extensions[MSDF_EXTENSION].pixelRange = MTSDF_PIXEL_RANGE + 1
  await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, wrongConstant), context, 'MTSDF_CONSTANTS')

  const flags = embeddedBytes.slice()
  new DataView(flags.buffer).setUint16(recordsStart + present * 20 + 18, 1, true)
  await rejectsMtsdf(flags, context, 'RECORD_FLAGS')

  const emptyPlane = embeddedBytes.slice()
  const emptyPlaneView = new DataView(emptyPlane.buffer)
  emptyPlaneView.setInt16(
    recordsStart + present * 20 + 4,
    emptyPlaneView.getInt16(recordsStart + present * 20, true),
    true,
  )
  await rejectsMtsdf(emptyPlane, context, 'RECORD_PLANE_BOUNDS')

  const atlasBounds = embeddedBytes.slice()
  new DataView(atlasBounds.buffer).setUint16(recordsStart + present * 20 + 12, 0xffff, true)
  await rejectsMtsdf(atlasBounds, context, 'RECORD_ATLAS_BOUNDS')

  const duplicateVariant = structuredClone(decoded.document)
  duplicateVariant.extensions[MSDF_EXTENSION].pages[0].variants.push(
    structuredClone(duplicateVariant.extensions[MSDF_EXTENSION].pages[0].variants[0]),
  )
  await rejectsMtsdf(rewriteGlbDocument(embeddedBytes, duplicateVariant), context, 'VARIANT_COUNT')

  const pageViewIndex = extension.pages[0].variants[0].source.bufferView
  const pageView = decoded.document.bufferViews[pageViewIndex]
  const badKtx = embeddedBytes.slice()
  badKtx[decoded.binStart + pageView.byteOffset] ^= 0xff
  await rejectsMtsdf(badKtx, context, 'KTX2_INVALID')

  const badDfd = embeddedBytes.slice()
  badDfd[decoded.binStart + pageView.byteOffset + 118] = 2
  await rejectsMtsdf(badDfd, context, 'KTX2_DFD')

  await rejectsMtsdf(embeddedBytes, { ...context, limits: { maxGpuBytes: 1 } }, 'GPU_BUDGET')
  // The individual Inter pages total 39,111,736 bytes, but the runtime allocates one
  // 1024×1024×10-layer RGBA8 texture array (41,943,040 bytes).
  await rejectsMtsdf(
    embeddedBytes,
    { ...context, limits: { maxGpuBytes: 40_000_000 } },
    'GPU_BUDGET',
  )
  await rejectsMtsdf(rasterArtifact.bytes, context, 'EXTERNAL_PAGE_MISSING')

  const tamperedExternalPages = new Map(pageArtifacts.map(({ id, bytes }) => [id, bytes.slice()]))
  const firstPage = tamperedExternalPages.values().next().value
  firstPage[firstPage.byteLength - 1] ^= 1
  await rejectsMtsdf(
    rasterArtifact.bytes,
    { ...context, externalPages: tamperedExternalPages },
    'EXTERNAL_PAGE_HASH',
  )
}

async function rejectsMtsdf(bytes, context, codePrefix) {
  await assert.rejects(
    validateMtsdfArtifact(bytes, context),
    (error) =>
      error instanceof MtsdfArtifactValidationError &&
      error.issues.some(({ code }) => code.startsWith(codePrefix)),
  )
}

function embedRasterPages(rasterBytes, pageArtifacts) {
  const { document, views } = glbViews(rasterBytes)
  const extension = document.extensions[MSDF_EXTENSION]
  const records = views[extension.recordBufferView]
  assert.ok(records)
  const embeddedDocument = structuredClone(document)
  embeddedDocument.extensions[MSDF_EXTENSION].recordBufferView = 0
  for (const [pageIndex, page] of embeddedDocument.extensions[MSDF_EXTENSION].pages.entries()) {
    page.variants[0].source = { type: 'bufferView', bufferView: pageIndex + 1 }
  }
  return buildGlb(embeddedDocument, [records, ...pageArtifacts.map(({ bytes }) => bytes)])
}

function buildGlb(document, chunks) {
  const bufferViews = []
  let binLength = 0
  for (const bytes of chunks) {
    binLength = align4(binLength)
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength })
    binLength += bytes.byteLength
  }
  const declaredBinLength = binLength
  const paddedBinLength = align4(binLength)
  const root = structuredClone(document)
  root.buffers = [{ byteLength: declaredBinLength }]
  root.bufferViews = bufferViews
  const json = new TextEncoder().encode(JSON.stringify(root))
  const paddedJsonLength = align4(json.byteLength)
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + paddedBinLength)
  output.fill(0x20, 20, 20 + paddedJsonLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, 0x4654_6c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, output.byteLength, true)
  view.setUint32(12, paddedJsonLength, true)
  view.setUint32(16, 0x4e4f_534a, true)
  output.set(json, 20)
  const binHeader = 20 + paddedJsonLength
  view.setUint32(binHeader, paddedBinLength, true)
  view.setUint32(binHeader + 4, 0x004e_4942, true)
  for (const [index, bytes] of chunks.entries()) {
    output.set(bytes, binHeader + 8 + bufferViews[index].byteOffset)
  }
  return output
}

function decodeGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  return {
    document: glbRoot(bytes),
    binStart: 20 + jsonLength + 8,
  }
}

function rewriteGlbDocument(source, document) {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  const oldJsonLength = view.getUint32(12, true)
  const oldBinHeader = 20 + oldJsonLength
  const binLength = view.getUint32(oldBinHeader, true)
  const bin = source.subarray(oldBinHeader + 8, oldBinHeader + 8 + binLength)
  const json = new TextEncoder().encode(JSON.stringify(document))
  const paddedJsonLength = align4(json.byteLength)
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + bin.byteLength)
  output.fill(0x20, 20, 20 + paddedJsonLength)
  const outputView = new DataView(output.buffer)
  outputView.setUint32(0, 0x4654_6c67, true)
  outputView.setUint32(4, 2, true)
  outputView.setUint32(8, output.byteLength, true)
  outputView.setUint32(12, paddedJsonLength, true)
  outputView.setUint32(16, 0x4e4f_534a, true)
  output.set(json, 20)
  const binHeader = 20 + paddedJsonLength
  outputView.setUint32(binHeader, bin.byteLength, true)
  outputView.setUint32(binHeader + 4, 0x004e_4942, true)
  output.set(bin, binHeader + 8)
  return output
}

function align4(value) {
  return (value + 3) & ~3
}

async function exerciseRuntime(result, rasterArtifact, extension, rasterKey) {
  const { document, views } = glbViews(rasterArtifact.bytes)
  const records = views[extension.recordBufferView]
  assert.ok(records)
  const pageArtifacts = result.artifacts.filter((artifact) => artifact.role === 'raster-page')
  const runtimeExtension = structuredClone(extension)
  for (const [pageIndex, page] of runtimeExtension.pages.entries()) {
    page.variants[0].source = { type: 'bufferView', bufferView: pageIndex + 1 }
  }
  const font = {
    handle: 7,
    shapingHash,
    glyphCount: 2937,
  }
  const runtimeRaster = {
    font: font.handle,
    handle: 11,
    kind: 'msdf',
    extension: MSDF_EXTENSION,
    version: 0,
    rasterKey,
    extensionData: runtimeExtension,
    view(index) {
      if (index === 0) return records
      const page = pageArtifacts[index - 1]
      if (page === undefined) throw new RangeError('missing synthetic MTSDF runtime view')
      return page.bytes
    },
    dispose() {},
  }
  assert.equal(document.extensions[MSDF_EXTENSION].recordBufferView, 0)
  const resource = await msdf.decode(font, runtimeRaster)
  assert.equal(resource.records.byteLength, 2937 * 20)
  assert.equal(resource.pages.length, 10)
  assert.equal(resource.atlas.width, 1024)
  assert.equal(resource.atlas.height, 1024)
  assert.equal(resource.atlas.layers, 10)
  assert.equal(resource.atlas.texture.generateMipmaps, false)
  assert.equal(resource.atlas.texture.minFilter, THREE.LinearFilter)
  assert.equal(resource.atlas.texture.magFilter, THREE.LinearFilter)
  assert.equal(resource.gpuBytes, 41_943_040)
  const glyphIds = firstPresentGlyphByPage(records, resource.pages.length)
  const layout = {
    glyphIds,
    glyphFontSlots: new Uint16Array(glyphIds.length),
    glyphFontSizes: new Float32Array(glyphIds.length).fill(64),
    x: Float32Array.from(glyphIds, (_glyphId, index) => 12 + index * 80),
    y: new Float32Array(glyphIds.length).fill(24),
  }
  const paint = {
    paintIndices: new Uint16Array(glyphIds.length),
    palette: [
      {
        color: [1, 0.75, 0.5, 1],
        outline: { color: [0, 0, 0, 1], width: 2 },
        shadow: { color: [0, 0, 0, 0.5], offset: [3, 4] },
      },
    ],
  }
  const batch = msdf.buildBatches(layout, resource, 0, paint)
  assert.equal(batch.glyphCount, resource.pages.length)
  assert.equal(batch.drawCount, 1)
  const mesh = batch.object.children[0]
  assert.ok(mesh)
  const geometry = mesh.geometry
  assert.equal(geometry.getAttribute('msdfOutlineWidth').getX(0), 0.25)
  assert.deepEqual(
    [
      geometry.getAttribute('msdfShadowOffset').getX(0),
      geometry.getAttribute('msdfShadowOffset').getY(0),
    ].map((value) => Number(value.toFixed(8))),
    [
      Number((3 / resource.atlas.width).toFixed(8)),
      Number((-4 / resource.atlas.height).toFixed(8)),
    ],
  )
  for (let pageIndex = 0; pageIndex < resource.pages.length; pageIndex += 1) {
    assert.equal(geometry.getAttribute('msdfPageIndex').getX(pageIndex), pageIndex)
  }
  batch.updatePaint({
    paintIndices: new Uint16Array(glyphIds.length),
    palette: [{ color: [0.25, 0.5, 1, 0.75] }],
  })
  assert.equal(geometry.getAttribute('msdfOutlineWidth').getX(0), 0)
  batch.dispose()
  assert.throws(() => batch.updatePaint(paint), /disposed/)
  let disposedTextures = 0
  resource.atlas.texture.addEventListener('dispose', () => disposedTextures++)
  msdf.dispose(resource)
  assert.equal(disposedTextures, 1)
}

function glbViews(bytes) {
  const document = glbRoot(bytes)
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = data.getUint32(12, true)
  const binaryStart = 20 + jsonLength + 8
  return {
    document,
    views: document.bufferViews.map(({ byteOffset = 0, byteLength }) =>
      bytes.subarray(binaryStart + byteOffset, binaryStart + byteOffset + byteLength),
    ),
  }
}

function firstPresentGlyphByPage(records, pageCount) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  const glyphs = new Uint16Array(pageCount)
  const found = new Uint8Array(pageCount)
  for (let glyphId = 0; glyphId < records.byteLength / 20; glyphId += 1) {
    const pageIndex = view.getUint16(glyphId * 20 + 16, true)
    if (pageIndex === 0xffff || found[pageIndex] === 1) continue
    glyphs[pageIndex] = glyphId
    found[pageIndex] = 1
    if (found.every((value) => value === 1)) return glyphs
  }
  throw new Error('canonical MTSDF fixture has no present glyph on every page')
}

function firstPresentGlyph(records) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength)
  for (let glyphId = 0; glyphId < records.byteLength / 20; glyphId += 1) {
    if (view.getUint16(glyphId * 20 + 16, true) !== 0xffff) return glyphId
  }
  throw new Error('canonical MTSDF fixture has no present glyph')
}

function fakeMtsdfBakerInstance({
  allocate = () => 0,
  deallocate = () => undefined,
  segmented = {},
} = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 })
  return {
    exports: {
      memory,
      pmndrs_text_mtsdf_alloc: allocate,
      pmndrs_text_mtsdf_dealloc: deallocate,
      pmndrs_text_mtsdf_bake: () => 0,
      pmndrs_text_mtsdf_bake_result_len: () => 0,
      pmndrs_text_mtsdf_segmented_status: segmented.status ?? (() => -1),
      pmndrs_text_mtsdf_segmented_metadata_ptr: segmented.metadataPointer ?? (() => 0),
      pmndrs_text_mtsdf_segmented_metadata_len: segmented.metadataByteLength ?? (() => 0),
      pmndrs_text_mtsdf_segmented_artifact_count: segmented.artifactCount ?? (() => 0),
      pmndrs_text_mtsdf_segmented_artifact_len: segmented.artifactByteLength ?? (() => 0),
      pmndrs_text_mtsdf_segmented_chunk_ptr: segmented.chunkPointer ?? (() => 0),
      pmndrs_text_mtsdf_segmented_chunk_len: segmented.chunkByteLength ?? (() => 0),
      pmndrs_text_mtsdf_segmented_release: segmented.release ?? (() => undefined),
    },
  }
}
