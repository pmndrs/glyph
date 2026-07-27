import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { FontLoader, FontRegistry } from '@pmndrs/text'

const manifestUrl = new URL('../../package.json', import.meta.url)

test('the published contract is ESM-only', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))

  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.module, undefined)
  assert.deepEqual(manifest.bin, { 'pmndrs-text-bake': './dist/node/cli.js' })
  assert.deepEqual(manifest.pmndrs, {
    text: { bitmap: './bakers/bitmap', msdf: './bakers/msdf' },
  })

  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target === 'string') {
      assert.ok(
        [
          './package.json',
          './bitmap-baker.wasm',
          './bitmap-abi.json',
          './mtsdf-baker.wasm',
          './mtsdf-abi.json',
          './text-shaper.wasm',
          './shaper-abi.json',
        ].includes(subpath),
        `unexpected non-JavaScript resource export ${subpath}`,
      )
      assert.match(target, /^\.\/dist\/.*\.(?:json|wasm)$|^\.\/package\.json$/)
      continue
    }

    assert.deepEqual(Object.keys(target).sort(), ['import', 'types'])
    assert.match(target.import, /^\.\/dist\/.*\.js$/)
    assert.match(target.types, /^\.\/dist\/.*\.d\.ts$/)
    assert.equal('require' in target, false)
  }
})

test('the public loader graph exposes registration without eager baker or Node host edges', async () => {
  assert.equal(typeof FontLoader, 'function')
  assert.equal(typeof FontRegistry, 'function')
  const [entry, loader, runtimeHost, runtimeWorker, serialWorkerHost] = await Promise.all([
    readFile(new URL('../../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/loader.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/runtime-bake.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/runtime-bake-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../../dist/internal/serial-worker-host.js', import.meta.url), 'utf8'),
  ])
  const initialGraph = `${entry}\n${loader}`
  assert.match(loader, /import\(["']\.\/runtime-bake\.js["']\)/)
  assert.doesNotMatch(
    initialGraph,
    /(?:from\s+["']\.\/runtime-bake|new Worker|font_baker\.wasm|node:)/,
  )
  assert.doesNotMatch(initialGraph, /(?:\.\/node\/|\.\/bakers\/)/)
  assert.match(runtimeHost, /workerUrl:\s*new URL\(["']\.\/runtime-bake-worker\.js["']/)
  assert.match(serialWorkerHost, /new Worker\(this\.#protocol\.workerUrl/)
  assert.match(serialWorkerHost, /type:\s*["']module["']/)
  assert.match(runtimeWorker, /from ["']@pmndrs\/text-font-baker\/wasm-url["']/)
  assert.doesNotMatch(
    `${runtimeHost}\n${runtimeWorker}`,
    /(?:node:|font-baker\/validate|compose-bake|compiler-adapter|discovery|gltf-validator|ktx-parse|ajv)/,
  )
  for (const helper of [
    'core-bake-policy.js',
    'owned-array-buffer.js',
    'successful-promise-cache.js',
  ]) {
    const source = await readFile(new URL(`../../dist/internal/${helper}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|export\s+\{.*\}\s+from)\s/m)
  }
  await assert.rejects(
    readFile(new URL('../../dist/font_baker.wasm', import.meta.url)),
    (error) => error?.code === 'ENOENT',
  )
})
