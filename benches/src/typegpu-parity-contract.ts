// What the TypeGPU parity page (`typegpu-parity-proof.ts`) reports to its driver script.
export interface Counters {
  draws: number;
  setBindGroup: number;
  setPipeline: number;
  setVertexBuffer: number;
  createBindGroup: number;
  createBuffer: number;
  createTexture: number;
  createShaderModule: number;
  createRenderPipeline: number;
  writeBuffer: number;
  writeBufferBytes: number;
  writeTexture: number;
  writeTextureBytes: number;
  bufferBytes: number;
  textureBytes: number;
}
export interface ParityCapture {
  readonly width: number;
  readonly height: number;
  /** Base64 RGBA rows, top first. */
  readonly typegpu: string;
  readonly three: string | undefined;
}
export interface ParityPerf {
  readonly labels: number;
  readonly glyphs: number;
  readonly mount: Counters & { readonly ms: number };
  readonly frame: Counters;
  readonly cpuFrameMs: number;
  readonly gpuFrameMs: number | undefined;
  readonly batchFrameMs: number;
  readonly edit: Counters & { readonly ms: number };
  readonly editCount: Counters & { readonly ms: number };
  readonly move10: Counters & { readonly ms: number };
  readonly growth: Counters & { readonly labelsAdded: number; readonly error: string | undefined };
}

export interface ParityProof {
  readonly scenes: readonly string[];
  capture(scene: string, three: boolean): Promise<ParityCapture>;
  perf(labels: number): Promise<ParityPerf>;
  /** RGBA rows to a PNG file and back, both base64; the pixels are opaque, so the round trip is exact. */
  toPng(rgba: string, width: number, height: number): Promise<string>;
  fromPng(png: string): Promise<string>;
}

declare global {
  interface Window {
    typegpuParity: Promise<ParityProof>;
  }
}
