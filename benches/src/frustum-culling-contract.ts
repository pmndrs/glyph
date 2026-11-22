// What the frustum culling page (`frustum-culling-proof.ts`) reports to its driver script.
/** One on-screen state rendered with Glyph's automatic culling and with every frustum test answering "inside". */
export interface ParityCase {
  readonly name: string;
  readonly litChannels: number;
  readonly unculledCalls: number;
  readonly culledCalls: number;
  readonly culledDraws: number;
}

export interface TimingSample {
  readonly culling: boolean;
  readonly publishMs: number;
  readonly renderMs: number;
  readonly gpuMs: number | null;
  readonly calls: number;
}

export interface TimingWorkload {
  readonly name: string;
  readonly labels: number;
  readonly onScreenLabels: number;
  readonly samples: readonly TimingSample[];
}

export interface FrustumCullingReport {
  readonly backend: 'webgpu' | 'webgl2';
  readonly transformMode: 'indexed' | 'direct';
  readonly threeRevision: string;
  readonly cases: readonly ParityCase[];
  readonly negativeControlDetected: boolean;
  readonly unculledCustomMaterial: boolean;
  readonly timings: readonly TimingWorkload[];
}
