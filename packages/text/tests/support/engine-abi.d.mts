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
export function copyIntoAllocation(
  memory: WebAssembly.Memory,
  allocate: (byteLength: number) => number,
  bytes: Uint8Array,
): number;
