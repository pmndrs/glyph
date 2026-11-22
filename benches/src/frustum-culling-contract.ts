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

/** A caller material that displaces its glyphs, declared three ways. */
export interface MaterialCullingReport {
  /** With no declared padding the displaced glyphs are culled with their source quads. */
  readonly undeclaredPops: boolean;
  /** Pixel-identical cases with the maximum displacement declared as `boundsPadding`. */
  readonly paddedCases: number;
  /** Channels culling changed with half the displacement declared (the negative control; nonzero). */
  readonly undersizedPaddingChannels: number;
  /** A `frustumCulled: false` material's draws are never culled. */
  readonly neverCulled: boolean;
}

/** Draw calls submitted with every label off screen once one object sets `frustumCulled = false`. */
export interface OptOutReport {
  readonly memberCalls: number;
  readonly standaloneCalls: number;
  readonly groupCalls: number;
  readonly glyphsCalls: number;
}

export interface FrustumCullingReport {
  readonly backend: 'webgpu' | 'webgl2';
  readonly transformMode: 'indexed' | 'direct';
  readonly threeRevision: string;
  readonly cases: readonly ParityCase[];
  readonly negativeControlDetected: boolean;
  readonly materialCulling: MaterialCullingReport;
  readonly optOut: OptOutReport;
  readonly timings: readonly TimingWorkload[];
}
