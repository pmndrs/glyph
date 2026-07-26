import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import React, { createRef, StrictMode } from 'react'
import ReactThreeTestRenderer from '@react-three/test-renderer'

import { Text as CoreText, defineFont } from '../../dist/index.js'
import { Text, lazyRaster, useFont } from '../../dist/react.js'
import { bitmap } from '../../dist/raster/bitmap.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fixtureUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb',
  import.meta.url,
)
const shaperUrl = new URL('../../dist/text_shaper.wasm', import.meta.url)

test('React Text flattens spans, reconciles, forwards its ref, and disposes', async () => {
  const restoreFetch = installFileFetch()
  const font = defineFont(fixtureUrl.href, bitmap({ strikes: [16] }))
  const loaded = await useFont.preload(font)
  const reference = createRef()
  const layouts = []
  const render = (suffix, color, position = [0, 0, 0]) =>
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        Text,
        {
          font,
          fontSize: 16,
          position,
          ref: reference,
          onLayout: (layout) => layouts.push(layout),
        },
        'Fast ',
        React.createElement(Text, { color }, suffix),
      ),
    )

  let renderer
  try {
    await ReactThreeTestRenderer.act(async () => {
      renderer = await ReactThreeTestRenderer.create(render('office', '#ff8a00'))
    })
    assert.ok(
      reference.current instanceof CoreText,
      `forwarded ref resolved to ${reference.current?.constructor?.name ?? String(reference.current)}`,
    )
    await reference.current.ready
    assert.equal(reference.current.children.length, 1)
    assert.equal(reference.current.layout?.glyphIds.length, 11)
    assert.equal(layouts.length, 1)

    const object = reference.current
    const initialLayout = object.layout
    await renderer.update(render('office', '#00aaff', [2, 1, 0]))
    await object.ready
    assert.equal(reference.current, object, 'React updates retain the core object identity')
    assert.equal(object.layout, initialLayout, 'paint and transform changes do not reflow')
    assert.deepEqual(object.position.toArray(), [2, 1, 0])

    await renderer.update(render('accurate', '#00aaff', [2, 1, 0]))
    await object.ready
    assert.notEqual(object.layout, initialLayout, 'text changes replace the layout generation')
    assert.equal(object.layout?.glyphIds.length, 13)
    assert.equal(layouts.length, 2)

    await assert.rejects(
      ReactThreeTestRenderer.create(
        React.createElement(
          Text,
          { font },
          React.createElement(Text, { position: [1, 0, 0] }, 'invalid inline transform'),
        ),
      ),
      /nested Text does not accept position/,
    )

    await renderer.unmount()
    renderer = undefined
    await Promise.resolve()
    assert.throws(() => object.setProperties({ opacity: 1 }), /disposed/)
  } finally {
    if (renderer !== undefined) await renderer.unmount()
    await Promise.resolve()
    loaded.font.dispose()
    useFont.clear(font)
    restoreFetch()
  }
})

test('lazyRaster participates in the real React Text dependency and draw path', async () => {
  const restoreFetch = installFileFetch()
  const raster = lazyRaster(async () => bitmap({ strikes: [16] }).module)
  let importPromise
  try {
    void raster.kind
  } catch (error) {
    importPromise = error
  }
  assert.ok(importPromise instanceof Promise)
  await importPromise

  const font = defineFont(fixtureUrl.href, {
    module: raster,
    options: { strikes: [16] },
  })
  const loaded = await useFont.preload(font)
  const reference = createRef()
  let renderer
  try {
    await ReactThreeTestRenderer.act(async () => {
      renderer = await ReactThreeTestRenderer.create(
        React.createElement(Text, { font, fontSize: 16, ref: reference }, 'lazy raster'),
      )
    })
    await reference.current.ready
    assert.equal(reference.current.children.length, 1)
  } finally {
    if (renderer !== undefined) await renderer.unmount()
    await Promise.resolve()
    loaded.font.dispose()
    useFont.clear(font)
    restoreFetch()
  }
})

function installFileFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === shaperUrl.href) {
      init?.signal?.throwIfAborted()
      return new Response(await readFile(shaperUrl), { status: 200 })
    }
    if (url === fixtureUrl.href) {
      init?.signal?.throwIfAborted()
      return new Response(await readFile(fixtureUrl), { status: 200 })
    }
    return original(input, init)
  }
  return () => {
    globalThis.fetch = original
  }
}
