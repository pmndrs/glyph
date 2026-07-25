import { FontBakeError } from "@pmndrs/text-font-baker";

import type { RuntimeFontBake, RuntimeFontBakeRequest } from "./loader.js";
import {
  isRuntimeBakeResultV0,
  type RuntimeBakeRequestV0,
} from "./internal/runtime-bake-protocol.js";
import { fontBakeDescriptorV0 } from "./internal/core-bake-policy.js";
import { copyToOwnedArrayBuffer } from "./internal/owned-array-buffer.js";

interface PendingBake {
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (reason: unknown) => void;
  readonly removeAbortListener: () => void;
}

let sharedHost: RuntimeBakeWorkerHost | undefined;

export const bakeFontInWorker: RuntimeFontBake = (request) => {
  sharedHost ??= new RuntimeBakeWorkerHost();
  return sharedHost.bake(request);
};

class RuntimeBakeWorkerHost {
  readonly #pending = new Map<number, PendingBake>();
  #nextId = 1;
  #worker: Worker | undefined;

  bake(request: RuntimeFontBakeRequest): Promise<Uint8Array> {
    if (request.signal?.aborted === true) return Promise.reject(abortReason(request.signal));
    const worker = (this.#worker ??= this.#createWorker());
    const id = this.#nextId++;
    const source = copyToOwnedArrayBuffer(request.source);
    const message: RuntimeBakeRequestV0 = {
      type: "bake-font-v0",
      id,
      source,
      font: fontBakeDescriptorV0(0),
    };
    return new Promise<Uint8Array>((resolve, reject) => {
      const abort = (): void => {
        const pending = this.#settle(id);
        if (pending === undefined) return;
        pending.reject(abortReason(request.signal));
        if (this.#pending.size === 0) this.#terminateIdleWorker();
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        removeAbortListener: () => request.signal?.removeEventListener("abort", abort),
      });
      try {
        worker.postMessage(message, [source]);
      } catch (error) {
        this.#settle(id)?.reject(error);
      }
    });
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL("./runtime-bake-worker.js", import.meta.url), {
      name: "pmndrs-text-font-baker",
      type: "module",
    });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      this.#receive(worker, event.data);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      this.#failAll(worker, event.error ?? new Error(event.message || "font bake Worker failed"));
    });
    worker.addEventListener("messageerror", () => {
      this.#failAll(worker, new TypeError("font bake Worker returned an unreadable message"));
    });
    return worker;
  }

  #receive(worker: Worker, value: unknown): void {
    if (worker !== this.#worker) return;
    if (!isRuntimeBakeResultV0(value)) {
      this.#failAll(worker, new TypeError("font bake Worker returned an invalid protocol message"));
      return;
    }
    const pending = this.#settle(value.id);
    if (pending === undefined) return;
    if (!value.ok) {
      pending.reject(new FontBakeError(value.error));
    } else {
      pending.resolve(new Uint8Array(value.artifacts[0].bytes));
    }
    if (this.#pending.size === 0) this.#terminateIdleWorker();
  }

  #settle(id: number): PendingBake | undefined {
    const pending = this.#pending.get(id);
    if (pending !== undefined) {
      this.#pending.delete(id);
      pending.removeAbortListener();
    }
    return pending;
  }

  #failAll(worker: Worker, error: unknown): void {
    if (worker !== this.#worker) return;
    this.#worker = undefined;
    worker.terminate();
    for (const id of [...this.#pending.keys()]) this.#settle(id)?.reject(error);
  }

  #terminateIdleWorker(): void {
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
  }
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}
