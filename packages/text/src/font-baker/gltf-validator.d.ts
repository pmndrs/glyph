declare module 'gltf-validator' {
  export interface GltfValidatorMessage {
    readonly code: string;
    readonly message: string;
    readonly severity: number;
    readonly pointer: string;
  }

  export interface GltfValidatorReport {
    readonly mimeType: string;
    readonly validatorVersion: string;
    readonly issues: {
      readonly numErrors: number;
      readonly numWarnings: number;
      readonly numInfos: number;
      readonly numHints: number;
      readonly messages: readonly GltfValidatorMessage[];
      readonly truncated: boolean;
    };
    readonly info: Readonly<Record<string, unknown>>;
  }

  export function validateBytes(
    data: Uint8Array,
    options?: { readonly maxIssues?: number },
  ): Promise<GltfValidatorReport>;
}
