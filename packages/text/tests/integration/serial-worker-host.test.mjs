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

test('worker progress is reported without completing the active request', async () => {
  const OriginalWorker = globalThis.Worker
  class ProgressWorker extends EventTarget {
    postMessage(message) {
      queueMicrotask(() => {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'progress', id: message.id, completed: 2, total: 4 },
          }),
        )
        this.dispatchEvent(
          new MessageEvent('message', { data: { type: 'result', id: message.id, value: 42 } }),
        )
      })
    }

    terminate() {}
  }
  globalThis.Worker = ProgressWorker
  try {
    const observed = []
    const host = new SerialWorkerHost({
      name: 'progress-test',
      workerUrl: new URL('data:text/javascript,', import.meta.url),
      prepare: (_request, id) => ({ message: { id }, transfer: [] }),
      isResponse: (value) => value?.type === 'result',
      responseId: (response) => response.id,
      resolve: (response) => response.value,
      progress: {
        isProgress: (value) => value?.type === 'progress',
        progressId: (progress) => progress.id,
        report: (request, progress) => request.onProgress(progress),
      },
    })

    const result = await host.run({ onProgress: (progress) => observed.push(progress) })
    assert.equal(result, 42)
    assert.deepEqual(observed, [{ type: 'progress', id: 1, completed: 2, total: 4 }])
  } finally {
    globalThis.Worker = OriginalWorker
  }
})
