import type { Buffer } from 'node:buffer';

export interface NamedFunction {
  functionIndex: number;
  name: string;
}

export interface NamedShaperProof {
  executableSha256: string;
  functions: NamedFunction[];
  nameSection: Uint8Array;
}

export function sha256(bytes: Uint8Array): string;
export function wasmSections(bytes: Uint8Array): {
  id: number;
  name: string | undefined;
  payload: Uint8Array;
  bytes: Uint8Array;
}[];
export function authenticateNamedShaper(release: Uint8Array, candidate: Uint8Array): NamedShaperProof;
export function deriveNamedShaper(
  release: Uint8Array,
  candidate: Uint8Array,
): {
  bytes: Buffer;
  proof: NamedShaperProof;
};
export function attachOptimizerFunctionNames(raw: Uint8Array, optimized: Uint8Array, symbolMap: string): Buffer;
