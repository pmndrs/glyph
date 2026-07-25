import assert from 'node:assert/strict'
import test from 'node:test'

import { cacheSuccessfulPromise } from '../../dist/internal/successful-promise-cache.js'

test('shares a pending load and reuses its successful value', async () => {
  const pending = Promise.withResolvers()
  let loads = 0
  const load = cacheSuccessfulPromise(() => {
    loads += 1
    return pending.promise
  })

  const first = load()
  const concurrent = load()
  assert.equal(first, concurrent)
  assert.equal(loads, 0, 'the loader starts in the promise microtask')
  await Promise.resolve()
  assert.equal(loads, 1)

  const value = { ready: true }
  pending.resolve(value)
  assert.equal(await first, value)
  assert.equal(await load(), value)
  assert.equal(loads, 1)
})

test('forgets a rejected load so the next request can recover', async () => {
  let loads = 0
  const expected = { ready: true }
  const load = cacheSuccessfulPromise(async () => {
    loads += 1
    if (loads === 1) throw new Error('first load failed')
    return expected
  })

  await assert.rejects(load(), /first load failed/)
  assert.equal(await load(), expected)
  assert.equal(await load(), expected)
  assert.equal(loads, 2)
})
