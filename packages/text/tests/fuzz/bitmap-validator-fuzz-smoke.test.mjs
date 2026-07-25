import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { bitmapBakerFromCore, createBitmapBaker } from '../../dist/bakers/bitmap.js'
import {
  BitmapArtifactValidationError,
  validateBitmapArtifact,
} from '../../dist/bakers/bitmap-validator.js'
import { bitmapDescriptor, bitmapRasterKey } from '../../dist/raster/bitmap.js'
import {
  BITMAP_ARTIFACT_FUZZ_SEED,
  mutateBitmapArtifact,
} from '../support/bitmap-artifact-mutations.mjs'

const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09'

test('fixed-seed bitmap artifact mutations fail safely and deterministically', async () => {
  const [source, wasm] = await Promise.all([
    readFile(
      new URL(
        '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
        import.meta.url,
      ),
    ),
    readFile(new URL('../../dist/bitmap_baker.wasm', import.meta.url)),
  ])
  const descriptor = bitmapDescriptor({ strikes: [16] })
  const rasterKey = await bitmapRasterKey({ strikes: [16] })
  const baker = bitmapBakerFromCore(await createBitmapBaker(wasm))
  const artifact = (
    await baker.bake({
      font: { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash },
      rasterKey,
      packaging: { artifact: 'external', pages: 'embedded' },
      descriptor,
    })
  ).artifacts[0].bytes
  const context = { rasterKey, shapingHash, glyphCount: 2937, glyphIdWidth: 16, descriptor }

  let rejected = 0
  for (const mutation of mutateBitmapArtifact(artifact, 128)) {
    const first = await outcome(mutation.bytes, context)
    const second = await outcome(mutation.bytes, context)
    assert.deepEqual(second, first, `mutation ${mutation.id} from seed ${mutation.seed}`)
    if (!first.ok) rejected += 1
  }
  assert(rejected > 100, `seed ${BITMAP_ARTIFACT_FUZZ_SEED} must exercise hostile paths`)
})

async function outcome(bytes, context) {
  try {
    const result = await validateBitmapArtifact(bytes, context)
    return {
      ok: true,
      recordHashes: result.strikes.map(({ records }) => hash(records)),
      pageHashes: result.strikes.flatMap(({ pages }) => pages.map(({ bytes }) => hash(bytes))),
    }
  } catch (error) {
    assert(error instanceof BitmapArtifactValidationError)
    assert(error.issues.length > 0)
    return { ok: false, issues: error.issues }
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
