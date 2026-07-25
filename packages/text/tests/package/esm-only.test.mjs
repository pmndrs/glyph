import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../../package.json', import.meta.url)

test('the published contract is ESM-only', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))

  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.module, undefined)

  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target === 'string') {
      assert.ok(
        ['./package.json', './bitmap-baker.wasm', './bitmap-abi.json'].includes(subpath),
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
