import { FontLoader, FontRegistry } from "@pmndrs/text";
import { createFontBaker, type FontBakeCore } from "@pmndrs/text-font-baker";
import wasmUrl from "@pmndrs/text-font-baker/font-baker.wasm?url";
import canonicalFontUrl from "../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url";
import canonicalFontManifest from "../../fixtures/fonts/inter-v4.1/manifest.json";
import type { BenchmarkTarget } from "./contracts";

function stableSyntheticHash(sample: number): string {
  let value = 2166136261;
  for (let index = 0; index < 4096; index += 1) {
    value = Math.imul(value ^ ((index + sample) & 0xff), 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

const syntheticTarget: BenchmarkTarget = {
  id: "synthetic",
  label: "Runner contract",
  detail: "deterministic · CPU",
  color: "violet",
  capabilities: new Set(["deterministic"]),
  status: () => "ready",
  load: async () => undefined,
  run: async (_input, sample) => ({ bytes: 4096, hash: stableSyntheticHash(sample) }),
  dispose: async () => undefined,
};

let baker: FontBakeCore | undefined;
let canonicalFontBytes: Uint8Array | undefined;
const bakerTarget: BenchmarkTarget = {
  id: "font-baker",
  label: "Rust font baker",
  detail: "Wasm · direct memory ABI",
  color: "green",
  capabilities: new Set(["deterministic", "font-bytes", "wasm"]),
  status: () => "ready",
  load: async () => {
    if (baker !== undefined && canonicalFontBytes !== undefined) return;
    const [wasmResponse, fontResponse] = await Promise.all([
      fetch(wasmUrl),
      fetch(canonicalFontUrl),
    ]);
    if (!wasmResponse.ok)
      throw new Error(`Unable to load font baker Wasm (${wasmResponse.status})`);
    if (!fontResponse.ok)
      throw new Error(`Unable to load canonical font fixture (${fontResponse.status})`);
    const [wasm, font] = await Promise.all([
      wasmResponse.arrayBuffer(),
      fontResponse.arrayBuffer(),
    ]);
    baker = await createFontBaker(wasm);
    canonicalFontBytes = new Uint8Array(font);
  },
  run: async (input) => {
    if (baker === undefined || canonicalFontBytes === undefined)
      throw new Error("Font baker target was not loaded");
    const result = baker.bake({
      source: input.fontBytes ?? canonicalFontBytes,
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    });
    const artifact = result.artifacts[0];
    if (artifact === undefined) throw new Error("Font baker returned no artifact");
    return { bytes: artifact.bytes.byteLength, hash: artifact.sha256 };
  },
  dispose: async () => undefined,
};

let workerParityReady = false;
const loaderWorkerTarget: BenchmarkTarget = {
  id: "font-loader-worker",
  label: "Font loader Worker fallback",
  detail: "baked miss · module Worker · validated GLB",
  color: "cyan",
  capabilities: new Set(["deterministic", "font-bytes", "wasm", "loader"]),
  status: () => "ready",
  load: async () => {
    if (workerParityReady) return;
    const { bakeFontInWorker } = await import("@pmndrs/text/runtime-bake");
    const response = await fetch(canonicalFontUrl);
    if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`);
    const source = new Uint8Array(await response.arrayBuffer());
    const artifact = await bakeFontInWorker({ source, sourceUrl: canonicalFontUrl });
    const artifactHash = await sha256(artifact);
    if (artifactHash !== canonicalFontManifest.bake.expectedCore.artifactSha256) {
      throw new Error("Browser Worker bytes differ from the canonical Node artifact");
    }
    const font = await new FontRegistry().registerAsset(artifact);
    try {
      if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
        throw new Error("Browser Worker artifact retained an unexpected shaping identity");
      }
    } finally {
      font.dispose();
    }
    workerParityReady = true;
  },
  run: async () => {
    let font;
    try {
      font = await new FontLoader({ development: false }).load(canonicalFontUrl);
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
      throw new Error(
        `Worker fallback failed for ${canonicalFontUrl}: ${error instanceof Error ? error.message : String(error)}${cause === "" ? "" : ` (${cause})`}`,
      );
    }
    try {
      if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
        throw new Error("Worker fallback registered an unexpected shaping identity");
      }
      return {
        bytes: canonicalFontManifest.bake.expectedCore.artifactBytes,
        hash: font.shapingHash,
      };
    } finally {
      font.dispose();
    }
  },
  dispose: async () => undefined,
};

async function sha256(bytes: ArrayBufferView): Promise<string> {
  const owned = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function unavailableTarget(
  id: string,
  label: string,
  detail: string,
  color: BenchmarkTarget["color"],
): BenchmarkTarget {
  return {
    id,
    label,
    detail,
    color,
    capabilities: new Set(["raster"]),
    status: () => "unavailable",
    load: async () => {
      throw new Error(`${label} is not implemented yet`);
    },
    run: async () => {
      throw new Error(`${label} is not implemented yet`);
    },
    dispose: async () => undefined,
  };
}

export const targets: readonly BenchmarkTarget[] = [
  syntheticTarget,
  bakerTarget,
  loaderWorkerTarget,
  unavailableTarget("bitmap", "Bitmap atlas", "capability not landed", "amber"),
  unavailableTarget("msdf", "MSDF atlas", "capability not landed", "cyan"),
  unavailableTarget("slug", "Three Flatland Slug", "adapter not landed", "green"),
];

export function targetById(id: string): BenchmarkTarget {
  return targets.find((target) => target.id === id) ?? syntheticTarget;
}
