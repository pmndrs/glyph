export interface EngineUpdateFields {
  readonly sessionId: number;
  readonly policyHandle: number;
  readonly expectedEngineRevision: number;
  readonly consumedPlanRevision: number;
  readonly acknowledgedPublicationGeneration?: number;
  readonly textMutations?: readonly {
    readonly start: number;
    readonly deleteCount: number;
    readonly insert: readonly number[];
  }[];
}

export function renderPolicyBytes(abi: object): Uint8Array;
export function kernelPolicyBytes(abi: object): Uint8Array;
export function engineUpdateBytes(abi: object, fields: EngineUpdateFields): Uint8Array;
export interface EngineFrameUpdateFields {
  readonly sessionId: number;
  readonly policyHandle: number;
  readonly fontStackHandle: number;
  readonly expectedEngineRevision?: number;
  readonly consumedPlanRevision?: number;
  readonly acknowledgedPublicationGeneration?: number;
  readonly textMutation?: {
    readonly start: number;
    readonly deleteCount: number;
    readonly insert: readonly number[];
  };
  readonly style?: {
    readonly textEnd: number;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly rasterPixelRatio: number;
  };
  readonly geometry?: {
    readonly width: number;
    readonly height: number;
    readonly maxLines: number;
    readonly revision: number;
  };
  readonly limits: {
    readonly maxClusters: number;
    readonly maxLines: number;
    readonly maxOutputBytes: number;
  };
}
export function engineFrameUpdateBytes(abi: object, fields: EngineFrameUpdateFields): Uint8Array;
export function copyIntoAllocation(
  memory: WebAssembly.Memory,
  allocate: (byteLength: number) => number,
  bytes: Uint8Array,
): number;
