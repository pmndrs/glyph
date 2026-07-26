import { FontBakeError } from '@pmndrs/text-font-baker'

import type { RuntimeFontBake, RuntimeFontBakeRequest } from './loader.js'
import { fontBakeDescriptorV0 } from './internal/core-bake-policy.js'
import { copyToOwnedArrayBuffer } from './internal/owned-array-buffer.js'
import {
  isRuntimeBakeResultV0,
  type RuntimeBakeRequestV0,
} from './internal/runtime-bake-protocol.js'

interface QueuedBake {
  readonly message: RuntimeBakeRequestV0
  readonly resolve: (bytes: Uint8Array) => void
  readonly reject: (reason: unknown) => void
  removeAbortListener: () => void
}

let sharedHost: RuntimeBakeWorkerHost | undefined

export const bakeFontInWorker: RuntimeFontBake = (request) => {
  sharedHost ??= new RuntimeBakeWorkerHost()
  return sharedHost.bake(request)
}

class RuntimeBakeWorkerHost {
  readonly #queue: QueuedBake[] = []
  #active: QueuedBake | undefined
  #nextId = 1
  #worker: Worker | undefined

  bake(request: RuntimeFontBakeRequest): Promise<Uint8Array> {
    if (request.signal?.aborted === true) return Promise.reject(abortReason(request.signal))
    const message: RuntimeBakeRequestV0 = {
      type: 'bake-font-v0',
      id: this.#nextId++,
      source: copyToOwnedArrayBuffer(request.source),
      font: fontBakeDescriptorV0(0),
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const queued: QueuedBake = {
        message,
        resolve,
        reject,
        removeAbortListener: () => {},
      }
      const abort = (): void => this.#cancel(queued, abortReason(request.signal))
      queued.removeAbortListener = () => request.signal?.removeEventListener('abort', abort)
      request.signal?.addEventListener('abort', abort, { once: true })
      this.#queue.push(queued)
      this.#startNext()
    })
  }

  #startNext(): void {
    if (this.#active !== undefined) return
    const next = this.#queue.shift()
    if (next === undefined) {
      this.#terminateWorker()
      return
    }
    this.#active = next
    try {
      const worker = (this.#worker ??= this.#createWorker())
      worker.postMessage(next.message, [next.message.source])
    } catch (error) {
      this.#failAll(this.#worker, error)
    }
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL('./runtime-bake-worker.js', import.meta.url), {
      name: 'pmndrs-text-font-baker',
      type: 'module',
    })
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#receive(worker, event.data)
    })
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.#failAll(worker, event.error ?? new Error(event.message || 'font bake Worker failed'))
    })
    worker.addEventListener('messageerror', () => {
      this.#failAll(worker, new TypeError('font bake Worker returned an unreadable message'))
    })
    return worker
  }

  #receive(worker: Worker, value: unknown): void {
    if (worker !== this.#worker) return
    const active = this.#active
    if (active === undefined || !isRuntimeBakeResultV0(value) || value.id !== active.message.id) {
      this.#failAll(worker, new TypeError('font bake Worker returned an invalid protocol message'))
      return
    }
    this.#active = undefined
    active.removeAbortListener()
    if (!value.ok) active.reject(new FontBakeError(value.error))
    else active.resolve(new Uint8Array(value.artifacts[0].bytes))
    this.#startNext()
  }

  #cancel(job: QueuedBake, reason: unknown): void {
    if (job === this.#active) {
      this.#active = undefined
      job.removeAbortListener()
      job.reject(reason)
      this.#terminateWorker()
      this.#startNext()
      return
    }
    const index = this.#queue.indexOf(job)
    if (index < 0) return
    this.#queue.splice(index, 1)
    job.removeAbortListener()
    job.reject(reason)
  }

  #failAll(worker: Worker | undefined, error: unknown): void {
    if (worker !== undefined && worker !== this.#worker) return
    this.#terminateWorker()
    const active = this.#active
    this.#active = undefined
    if (active !== undefined) {
      active.removeAbortListener()
      active.reject(error)
    }
    for (const queued of this.#queue.splice(0)) {
      queued.removeAbortListener()
      queued.reject(error)
    }
  }

  #terminateWorker(): void {
    const worker = this.#worker
    this.#worker = undefined
    worker?.terminate()
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError')
}
