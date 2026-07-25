import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FontLoader } from "@pmndrs/text";
import { bakeFontInWorker } from "@pmndrs/text/runtime-bake";
import { createFontBaker } from "@pmndrs/text-font-baker";

const fixtureDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/",
  import.meta.url,
);
const fixturePromise = Promise.all([
  readFile(new URL("Inter-Regular.ttf", fixtureDirectory)),
  readFile(new URL("../../dist/font_baker.wasm", import.meta.url)),
]).then(async ([source, wasm]) => {
  const baker = await createFontBaker(wasm);
  const result = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  return { source, artifact: result.artifacts[0].bytes };
});

test("the runtime host transfers source and accepts one authoritative font artifact", async (t) => {
  const { source, artifact } = await fixturePromise;
  const originalWorker = globalThis.Worker;
  const workers = [];
  let terminations = 0;

  class FixtureWorker {
    listeners = new Map();

    constructor(url, options) {
      workers.push({ url: String(url), options });
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(value, transfer) {
      assert.deepEqual(transfer, [value.source]);
      const received = structuredClone(value, { transfer });
      assert.equal(value.source.byteLength, 0);
      assert.deepEqual(Buffer.from(received.source), Buffer.from(source));
      queueMicrotask(() => {
        this.listeners.get("message")?.({
          data: {
            type: "bake-font-result-v0",
            id: received.id,
            ok: true,
            artifacts: [
              {
                role: "font",
                id: "fixture-font",
                bytes: artifact.buffer.slice(
                  artifact.byteOffset,
                  artifact.byteOffset + artifact.byteLength,
                ),
                sha256: "0".repeat(64),
              },
            ],
            report: {},
            warnings: [],
          },
        });
      });
    }

    terminate() {
      terminations += 1;
    }
  }

  globalThis.Worker = FixtureWorker;
  t.after(() => {
    globalThis.Worker = originalWorker;
  });

  const sourceCopy = Uint8Array.from(source);
  const result = await bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: "https://assets.test/Inter-Regular.ttf",
  });

  assert.deepEqual(result, Uint8Array.from(artifact));
  assert.deepEqual(sourceCopy, Uint8Array.from(source));
  const requests = [];
  const font = await new FontLoader({
    baseUrl: "https://assets.test/",
    development: false,
    fetch: async (input) => {
      requests.push(String(input));
      if (String(input).endsWith(".font.glb")) return new Response(null, { status: 404 });
      return new Response(source);
    },
  }).load("Inter-Regular.ttf");
  assert.equal(font.glyphCount, 2937);
  assert.deepEqual(requests, [
    "https://assets.test/Inter-Regular.font.glb",
    "https://assets.test/Inter-Regular.ttf",
  ]);
  const controller = new AbortController();
  const cancelled = bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: "https://assets.test/cancelled.ttf",
    signal: controller.signal,
  });
  controller.abort(new Error("cancel idle Worker"));
  await assert.rejects(cancelled, /cancel idle Worker/);
  assert.equal(terminations, 1);

  await bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: "https://assets.test/recovered.ttf",
  });
  assert.equal(workers.length, 2);
  for (const worker of workers) {
    assert.deepEqual(worker, {
      url: new URL("../../dist/runtime-bake-worker.js", import.meta.url).href,
      options: { name: "pmndrs-text-font-baker", type: "module" },
    });
  }
});

test("the Worker entry runs the portable baker and transfers the exact canonical artifact", async (t) => {
  const { source, artifact: expected } = await fixturePromise;
  const originals = {
    addEventListener: globalThis.addEventListener,
    fetch: globalThis.fetch,
    postMessage: globalThis.postMessage,
  };
  let receive;
  const result = Promise.withResolvers();
  globalThis.addEventListener = (type, listener) => {
    if (type === "message") receive = listener;
  };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), new URL("../../dist/font_baker.wasm", import.meta.url).href);
    return new Response(await readFile(new URL("../../dist/font_baker.wasm", import.meta.url)));
  };
  globalThis.postMessage = (value, transfer) => {
    result.resolve({ value, transfer });
  };
  t.after(() => {
    restoreGlobal("addEventListener", originals.addEventListener);
    restoreGlobal("fetch", originals.fetch);
    restoreGlobal("postMessage", originals.postMessage);
  });

  await import(`../../dist/runtime-bake-worker.js?test=${Date.now()}`);
  assert.equal(typeof receive, "function");
  receive({
    data: {
      type: "bake-font-v0",
      id: 7,
      source: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      font: { formatVersion: 0, fontFaceIndex: 0 },
    },
  });
  const { value, transfer } = await result.promise;

  assert.equal(value.type, "bake-font-result-v0");
  assert.equal(value.id, 7);
  assert.equal(value.ok, true);
  assert.equal(value.artifacts.length, 1);
  assert.deepEqual(Buffer.from(value.artifacts[0].bytes), Buffer.from(expected));
  assert.deepEqual(transfer, [value.artifacts[0].bytes]);
});

function restoreGlobal(key, value) {
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
}
