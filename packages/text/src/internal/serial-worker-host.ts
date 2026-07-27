export interface PreparedWorkerMessage<Message> {
  readonly message: Message
  readonly transfer: Transferable[]
}

export interface SerialWorkerProtocol<Request, Message, Response, Result> {
  readonly name: string
  readonly workerUrl: URL
  prepare(request: Request, id: number): PreparedWorkerMessage<Message>
  isResponse(value: unknown): value is Response
  responseId(response: Response): number
  resolve(response: Response): Result
}

interface QueuedWorkerRequest<Message, Result> {
  readonly id: number
  readonly message: Message
  readonly transfer: Transferable[]
  readonly resolve: (value: Result) => void
  readonly reject: (reason: unknown) => void
  removeAbortListener(): void
}

export class SerialWorkerHost<Request, Message, Response, Result> {
  readonly #protocol: SerialWorkerProtocol<Request, Message, Response, Result>
  readonly #queue: QueuedWorkerRequest<Message, Result>[] = []
  #active: QueuedWorkerRequest<Message, Result> | undefined
  #nextId = 1
  #worker: Worker | undefined

  constructor(protocol: SerialWorkerProtocol<Request, Message, Response, Result>) {
    this.#protocol = protocol
  }

  run(request: Request, signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted === true) return Promise.reject(abortReason(signal))
    const id = this.#nextId++
    let prepared: PreparedWorkerMessage<Message>
    try {
      prepared = this.#protocol.prepare(request, id)
    } catch (error) {
      return Promise.reject(error)
    }
    return new Promise<Result>((resolve, reject) => {
      const queued: QueuedWorkerRequest<Message, Result> = {
        id,
        ...prepared,
        resolve,
        reject,
        removeAbortListener: () => {},
      }
      const abort = (): void => this.#cancel(queued, abortReason(signal))
      queued.removeAbortListener = () => signal?.removeEventListener('abort', abort)
      signal?.addEventListener('abort', abort, { once: true })
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
      worker.postMessage(next.message, next.transfer)
    } catch (error) {
      this.#failAll(this.#worker, error)
    }
  }

  #createWorker(): Worker {
    const worker = new Worker(this.#protocol.workerUrl, {
      name: this.#protocol.name,
      type: 'module',
    })
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#receive(worker, event.data)
    })
    worker.addEventListener('error', (event: ErrorEvent) => {
      this.#failAll(worker, event.error ?? new Error(event.message || 'Worker failed'))
    })
    worker.addEventListener('messageerror', () => {
      this.#failAll(worker, new TypeError(`${this.#protocol.name} returned an unreadable message`))
    })
    return worker
  }

  #receive(worker: Worker, value: unknown): void {
    if (worker !== this.#worker) return
    const active = this.#active
    if (
      active === undefined ||
      !this.#protocol.isResponse(value) ||
      this.#protocol.responseId(value) !== active.id
    ) {
      this.#failAll(
        worker,
        new TypeError(`${this.#protocol.name} returned an invalid protocol message`),
      )
      return
    }
    this.#active = undefined
    active.removeAbortListener()
    try {
      active.resolve(this.#protocol.resolve(value))
    } catch (error) {
      active.reject(error)
    }
    this.#startNext()
  }

  #cancel(job: QueuedWorkerRequest<Message, Result>, reason: unknown): void {
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
