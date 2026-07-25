export interface FontBakeDescriptorV0 {
  readonly formatVersion: 0;
  readonly fontFaceIndex: number;
}

export interface FontBakeRequestV0 {
  readonly source: Uint8Array;
  readonly descriptor: FontBakeDescriptorV0;
}

export interface BakeArtifactV0 {
  readonly role: "font";
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface BakeWarning {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface ShapingPayloadReportV0 {
  readonly format: "opentype-sfnt-harfrust-v0";
  readonly sfntDirectoryBytes: number;
  readonly tables: readonly {
    readonly tag: string;
    readonly rawBytes: number;
    readonly paddedBytes: number;
  }[];
  readonly extentsBytes: number;
  readonly extentsAvailabilityBytes: number;
  readonly totalRawBytes: number;
  readonly gzipBytes?: number;
  readonly brotliBytes?: number;
}

export interface FontPayloadReportV0 {
  readonly source: { readonly bytes: number };
  readonly shared: { readonly shaping: ShapingPayloadReportV0 };
  readonly rasters: readonly unknown[];
  readonly containers: readonly {
    readonly artifactId: string;
    readonly role: "font";
    readonly jsonBytes: number;
    readonly paddingBytes: number;
    readonly totalBytes: number;
  }[];
  readonly transport: readonly {
    readonly artifactId: string;
    readonly format: "raw" | "gzip" | "brotli";
    readonly bytes: number;
  }[];
}

export interface FontBakeResultV0 {
  readonly artifacts: readonly BakeArtifactV0[];
  readonly report: FontPayloadReportV0;
  readonly warnings: readonly BakeWarning[];
}

export interface SerializedBakeError {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export class FontBakeError extends Error {
  readonly code: string;
  readonly path: string | undefined;

  constructor(error: SerializedBakeError) {
    super(error.message);
    this.name = "FontBakeError";
    this.code = error.code;
    this.path = error.path;
  }
}

export interface FontBakeCore {
  bake(request: FontBakeRequestV0): FontBakeResultV0;
}

export type FontBakerWasmSource = BufferSource | WebAssembly.Module;

export interface FontBakerAbiV0 {
  readonly name: "pmndrs-text-font-baker";
  readonly version: 0;
  readonly endianness: "little";
  readonly pointerWidth: 32;
  readonly memory: string;
  readonly versions: {
    readonly baker: "0.0.0";
    readonly fontFormat: 0;
    readonly harfrust: "0.12.0";
    readonly harfrustCommit: "60b28ea22b5261710018d69c168a762bcb28794c";
    readonly harfbuzzReference: "13.0.0";
    readonly harfbuzzReferenceCommit: "a0fc099681a69ae40665fbea74982a2e9d7a5260";
    readonly unicode: "17.0.0";
    readonly gltfSpec: "2.0";
    readonly gltfSchemaRevision: "77b44be7bef26e01fb0b140e3d5bb1716421c5e9";
    readonly gltfValidator: "2.0.0-dev.3.10";
    readonly binaryen: "129.0.0";
  };
  readonly functions: {
    readonly allocate: AbiFunction;
    readonly deallocate: AbiFunction;
    readonly bake: AbiFunction;
    readonly responseByteLength: AbiFunction;
  };
  readonly response: {
    readonly headerByteLength: number;
    readonly magic: string;
    readonly statusOffset: number;
    readonly metadataByteLengthOffset: number;
    readonly artifactByteLengthOffset: number;
    readonly payloadOffset: number;
    readonly successStatus: number;
  };
}

interface AbiFunction {
  readonly export: string;
  readonly parameters: readonly string[];
  readonly result?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function createFontBaker(source: FontBakerWasmSource): Promise<FontBakeCore> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const instance = await WebAssembly.instantiate(module, {});
  return createFontBakerFromInstance(instance);
}

export function createFontBakerFromInstance(instance: WebAssembly.Instance): FontBakeCore {
  const abi = readFontBakerAbi(instance);
  const exports = readExports(instance.exports, abi);

  return {
    bake({ source, descriptor }) {
      const descriptorBytes = textEncoder.encode(JSON.stringify(descriptor));
      const sourcePointer = copyIntoWasm(exports, source);
      const descriptorPointer = copyIntoWasm(exports, descriptorBytes);
      let responsePointer = 0;
      let responseLength = 0;
      try {
        responsePointer = exports.pmndrs_font_baker_bake(
          sourcePointer,
          source.byteLength,
          descriptorPointer,
          descriptorBytes.byteLength,
        );
        responseLength = exports.pmndrs_font_baker_result_len();
        const response = new Uint8Array(
          exports.memory.buffer,
          responsePointer,
          responseLength,
        ).slice();
        return decodeResponse(response, abi);
      } finally {
        exports.pmndrs_font_baker_dealloc(sourcePointer, source.byteLength);
        exports.pmndrs_font_baker_dealloc(descriptorPointer, descriptorBytes.byteLength);
        if (responsePointer !== 0 && responseLength !== 0) {
          exports.pmndrs_font_baker_dealloc(responsePointer, responseLength);
        }
      }
    },
  };
}

export function readFontBakerAbi(instance: WebAssembly.Instance): FontBakerAbiV0 {
  const pointer = readBootstrapFunction(instance.exports, "pmndrs_font_baker_abi_ptr")();
  const length = readBootstrapFunction(instance.exports, "pmndrs_font_baker_abi_len")();
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new TypeError("font baker ABI bootstrap is missing linear memory");
  }
  const value = JSON.parse(
    textDecoder.decode(new Uint8Array(memory.buffer, pointer, length)),
  ) as Partial<FontBakerAbiV0>;
  if (
    value.name !== "pmndrs-text-font-baker" ||
    value.version !== 0 ||
    value.endianness !== "little" ||
    value.pointerWidth !== 32 ||
    typeof value.memory !== "string" ||
    value.versions?.baker !== "0.0.0" ||
    value.versions.fontFormat !== 0 ||
    value.versions.harfrust !== "0.12.0" ||
    value.versions.harfrustCommit !== "60b28ea22b5261710018d69c168a762bcb28794c" ||
    value.versions.harfbuzzReference !== "13.0.0" ||
    value.versions.harfbuzzReferenceCommit !== "a0fc099681a69ae40665fbea74982a2e9d7a5260" ||
    value.versions.unicode !== "17.0.0" ||
    value.versions.gltfSpec !== "2.0" ||
    value.versions.gltfSchemaRevision !== "77b44be7bef26e01fb0b140e3d5bb1716421c5e9" ||
    value.versions.gltfValidator !== "2.0.0-dev.3.10" ||
    value.versions.binaryen !== "129.0.0" ||
    value.functions === undefined ||
    value.response === undefined
  ) {
    throw new TypeError("unsupported font baker ABI");
  }
  return value as FontBakerAbiV0;
}

interface FontBakerExports {
  readonly memory: WebAssembly.Memory;
  readonly pmndrs_font_baker_alloc: (length: number) => number;
  readonly pmndrs_font_baker_dealloc: (pointer: number, length: number) => void;
  readonly pmndrs_font_baker_bake: (
    sourcePointer: number,
    sourceLength: number,
    descriptorPointer: number,
    descriptorLength: number,
  ) => number;
  readonly pmndrs_font_baker_result_len: () => number;
}

function readExports(exports: WebAssembly.Exports, abi: FontBakerAbiV0): FontBakerExports {
  const memory = exports[abi.memory];
  const alloc = exports[abi.functions.allocate.export];
  const dealloc = exports[abi.functions.deallocate.export];
  const bake = exports[abi.functions.bake.export];
  const resultLen = exports[abi.functions.responseByteLength.export];
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof alloc !== "function" ||
    typeof dealloc !== "function" ||
    typeof bake !== "function" ||
    typeof resultLen !== "function"
  ) {
    throw new TypeError("invalid @pmndrs/text-font-baker Wasm exports");
  }
  return {
    memory,
    pmndrs_font_baker_alloc: alloc as FontBakerExports["pmndrs_font_baker_alloc"],
    pmndrs_font_baker_dealloc: dealloc as FontBakerExports["pmndrs_font_baker_dealloc"],
    pmndrs_font_baker_bake: bake as FontBakerExports["pmndrs_font_baker_bake"],
    pmndrs_font_baker_result_len: resultLen as FontBakerExports["pmndrs_font_baker_result_len"],
  };
}

function readBootstrapFunction(exports: WebAssembly.Exports, name: string): () => number {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new TypeError(`font baker ABI bootstrap is missing ${name}`);
  }
  return value as () => number;
}

function copyIntoWasm(exports: FontBakerExports, bytes: Uint8Array): number {
  const pointer = exports.pmndrs_font_baker_alloc(bytes.byteLength);
  if (pointer === 0 && bytes.byteLength !== 0) {
    throw new RangeError("font baker Wasm allocation failed");
  }
  new Uint8Array(exports.memory.buffer, pointer, bytes.byteLength).set(bytes);
  return pointer;
}

function decodeResponse(bytes: Uint8Array, abi: FontBakerAbiV0): FontBakeResultV0 {
  const response = abi.response;
  if (
    bytes.byteLength < response.headerByteLength ||
    textDecoder.decode(bytes.subarray(0, response.magic.length)) !== response.magic
  ) {
    throw new TypeError("invalid font baker response envelope");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = view.getUint32(response.statusOffset, true);
  const metadataLength = view.getUint32(response.metadataByteLengthOffset, true);
  const artifactLength = view.getUint32(response.artifactByteLengthOffset, true);
  if (response.payloadOffset + metadataLength + artifactLength !== bytes.byteLength) {
    throw new TypeError("invalid font baker response lengths");
  }
  const metadata = JSON.parse(
    textDecoder.decode(
      bytes.subarray(response.payloadOffset, response.payloadOffset + metadataLength),
    ),
  ) as FontBakeResultV0 | SerializedBakeError;
  if (status !== response.successStatus) {
    throw new FontBakeError(metadata as SerializedBakeError);
  }
  const result = metadata as FontBakeResultV0;
  const artifact = result.artifacts[0];
  if (result.artifacts.length !== 1 || artifact === undefined) {
    throw new TypeError("V0 font baker must return exactly one core artifact");
  }
  const artifactBytes = bytes.slice(response.payloadOffset + metadataLength);
  return {
    ...result,
    artifacts: [{ ...artifact, bytes: artifactBytes }],
  };
}
