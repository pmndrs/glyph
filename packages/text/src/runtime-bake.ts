import { FontBakeError } from "@pmndrs/text-font-baker";

import type { RuntimeFontBake, RuntimeFontBakeRequest } from "./loader.js";
import {
  isRuntimeBakeResultV0,
  type RuntimeBakeRequestV0,
  type RuntimeBakeResultV0,
} from "./internal/runtime-bake-protocol.js";

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
    const source = copyToArrayBuffer(request.source);
    const message: RuntimeBakeRequestV0 = {
      type: "bake-font-v0",
      id,
      source,
      font: { formatVersion: 0, fontFaceIndex: 0 },
    };
    return new Promise<Uint8Array>((resolve, reject) => {
      const abort = (): void => {
        if (this.#pending.delete(id)) reject(abortReason(request.signal));
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
      this.#receive(event.data);
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      this.#failAll(event.error ?? new Error(event.message || "font bake Worker failed"));
    });
    worker.addEventListener("messageerror", () => {
      this.#failAll(new TypeError("font bake Worker returned an unreadable message"));
    });
    return worker;
  }

  #receive(value: unknown): void {
    if (!isRuntimeBakeResultV0(value)) {
      this.#failAll(new TypeError("font bake Worker returned an invalid protocol message"));
      return;
    }
    const pending = this.#settle(value.id);
    if (pending === undefined) return;
    if (!value.ok) {
      pending.reject(new FontBakeError(value.error));
      return;
    }
    const artifact = soleFontArtifact(value);
    if (artifact instanceof Error) pending.reject(artifact);
    else pending.resolve(new Uint8Array(artifact));
  }

  #settle(id: number): PendingBake | undefined {
    const pending = this.#pending.get(id);
    if (pending !== undefined) {
      this.#pending.delete(id);
      pending.removeAbortListener();
    }
    return pending;
  }

  #failAll(error: unknown): void {
    const worker = this.#worker;
    this.#worker = undefined;
    worker?.terminate();
    for (const id of [...this.#pending.keys()]) this.#settle(id)?.reject(error);
  }
}

function soleFontArtifact(
  result: RuntimeBakeResultV0 & { readonly ok: true },
): ArrayBuffer | Error {
  if (result.artifacts.length !== 1 || result.artifacts[0]?.role !== "font") {
    return new TypeError("font bake Worker returned an invalid artifact set");
  }
  return result.artifacts[0].bytes;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}
