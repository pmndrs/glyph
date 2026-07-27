import assert from 'node:assert/strict'
import test from 'node:test'

import { SerialWorkerHost } from '../../dist/internal/serial-worker-host.js'

test('worker request preparation failures preserve the asynchronous API contract', async () => {
  const failure = new RangeError('request preparation failed')
  const host = new SerialWorkerHost({
    name: 'preparation-failure-test',
    workerUrl: new URL('data:text/javascript,', import.meta.url),
    prepare() {
      throw failure
    },
    isResponse: () => false,
    responseId: () => 0,
    resolve: () => undefined,
  })

  let promise
  assert.doesNotThrow(() => {
    promise = host.run({})
  })
  await assert.rejects(promise, (error) => error === failure)
})
