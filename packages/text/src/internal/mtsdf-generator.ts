import { mtsdfBakerAbi, type MtsdfBakerAbi } from '../generated/mtsdf-baker-abi.js';

export const mtsdfGeneratorAbi: MtsdfBakerAbi = mtsdfBakerAbi;

export type MtsdfGeneratorWasmSource = BufferSource | WebAssembly.Module;

export type MtsdfOutlineCommand =
  | Readonly<{ kind: 'move'; x: number; y: number }>
  | Readonly<{ kind: 'line'; x: number; y: number }>
  | Readonly<{ kind: 'quadratic'; controlX: number; controlY: number; x: number; y: number }>
  | Readonly<{
      kind: 'cubic';
      control0X: number;
      control0Y: number;
      control1X: number;
      control1Y: number;
      x: number;
      y: number;
    }>
  | Readonly<{ kind: 'close' }>;

export interface MtsdfGlyphRequest {
  readonly unitsPerEm: number;
  readonly bounds: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  readonly region: Readonly<{
    innerWidth: number;
    innerHeight: number;
    paddingX: number;
    paddingY: number;
  }>;
  readonly commands: readonly MtsdfOutlineCommand[];
}

export interface MtsdfGlyph {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface MtsdfGenerator {
  generate(request: MtsdfGlyphRequest): MtsdfGlyph;
}

export type MtsdfGeneratorAbiV1 = MtsdfBakerAbi;

export type MtsdfGenerationErrorCode = 'INVALID_REQUEST' | 'INVALID_OUTLINE' | 'GENERATION_FAILED';

export class MtsdfGenerationError extends Error {
  readonly code: MtsdfGenerationErrorCode;

  constructor(code: MtsdfGenerationErrorCode) {
    super(
      code === 'INVALID_REQUEST'
        ? 'MTSDF generator rejected its wire request'
        : code === 'INVALID_OUTLINE'
          ? 'MTSDF generator rejected the glyph outline'
          : 'MTSDF generation failed',
    );
    this.name = 'MtsdfGenerationError';
    this.code = code;
  }
}

interface MtsdfGeneratorExports {
  readonly memory: WebAssembly.Memory;
  readonly allocate: (length: number) => number;
  readonly deallocate: (pointer: number, length: number) => void;
  readonly generate: (pointer: number, length: number) => number;
  readonly resultPointer: () => number;
  readonly resultLength: () => number;
}

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

export async function createMtsdfGenerator(source: MtsdfGeneratorWasmSource): Promise<MtsdfGenerator> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  return createMtsdfGeneratorFromInstance(
    await WebAssembly.instantiate(module, {
      env: { pmndrs_text_bake_progress() {} },
    }),
  );
}

export function createMtsdfGeneratorFromInstance(instance: WebAssembly.Instance): MtsdfGenerator {
  const exports = readExports(instance.exports, mtsdfGeneratorAbi);
  return {
    generate(request) {
      const encoded = encodeRequest(request, mtsdfGeneratorAbi);
      const pointer = exports.allocate(encoded.byteLength);
      if (pointer === 0) throw new RangeError('MTSDF generator Wasm allocation failed');
      try {
        copyToMemory(exports.memory, pointer, encoded);
        const status = exports.generate(pointer, encoded.byteLength);
        if (status !== mtsdfGeneratorAbi.status.ok) {
          throw new MtsdfGenerationError(statusCode(status, mtsdfGeneratorAbi));
        }

        const width = checkedDimension(request.region.innerWidth, request.region.paddingX, 'width');
        const height = checkedDimension(request.region.innerHeight, request.region.paddingY, 'height');
        const expectedLength = checkedProduct(width, height, 4);
        const resultPointer = exports.resultPointer();
        const resultLength = exports.resultLength();
        if (resultLength !== expectedLength) {
          throw new TypeError('MTSDF generator returned an unexpected RGBA8 byte length');
        }
        return {
          width,
          height,
          rgba: copyFromMemory(exports.memory, resultPointer, resultLength),
        };
      } finally {
        exports.deallocate(pointer, encoded.byteLength);
      }
    },
  };
}

function encodeRequest(request: MtsdfGlyphRequest, abi: MtsdfGeneratorAbiV1): Uint8Array {
  validateRequest(request);
  const requestLayout = abi.layouts.request;
  const commandLayout = abi.layouts.command;
  const byteLength = checkedSum(requestLayout.size, checkedProduct(request.commands.length, commandLayout.size));
  if (byteLength > MAX_REQUEST_BYTES) throw new RangeError('MTSDF request exceeds 64 MiB');

  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  const setU32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const setF32 = (offset: number, value: number) => view.setFloat32(offset, value, true);
  setU32(requestLayout.byteLength, byteLength);
  setU32(requestLayout.commandsOffset, requestLayout.size);
  setU32(requestLayout.commandCount, request.commands.length);
  setF32(requestLayout.unitsPerEm, request.unitsPerEm);
  setF32(requestLayout.minX, request.bounds.minX);
  setF32(requestLayout.minY, request.bounds.minY);
  setF32(requestLayout.maxX, request.bounds.maxX);
  setF32(requestLayout.maxY, request.bounds.maxY);
  setU32(requestLayout.innerWidth, request.region.innerWidth);
  setU32(requestLayout.innerHeight, request.region.innerHeight);
  setU32(requestLayout.paddingX, request.region.paddingX);
  setU32(requestLayout.paddingY, request.region.paddingY);

  for (const [index, command] of request.commands.entries()) {
    const offset = requestLayout.size + index * commandLayout.size;
    switch (command.kind) {
      case 'move':
      case 'line':
        setU32(offset + commandLayout.opcode, abi.commands[command.kind]);
        setF32(offset + commandLayout.x0, command.x);
        setF32(offset + commandLayout.y0, command.y);
        break;
      case 'quadratic':
        setU32(offset + commandLayout.opcode, abi.commands.quadratic);
        setF32(offset + commandLayout.x0, command.controlX);
        setF32(offset + commandLayout.y0, command.controlY);
        setF32(offset + commandLayout.x1, command.x);
        setF32(offset + commandLayout.y1, command.y);
        break;
      case 'cubic':
        setU32(offset + commandLayout.opcode, abi.commands.cubic);
        setF32(offset + commandLayout.x0, command.control0X);
        setF32(offset + commandLayout.y0, command.control0Y);
        setF32(offset + commandLayout.x1, command.control1X);
        setF32(offset + commandLayout.y1, command.control1Y);
        setF32(offset + commandLayout.x2, command.x);
        setF32(offset + commandLayout.y2, command.y);
        break;
      case 'close':
        setU32(offset + commandLayout.opcode, abi.commands.close);
        break;
    }
  }
  return bytes;
}

function validateRequest(request: MtsdfGlyphRequest): void {
  if (!Number.isFinite(request.unitsPerEm) || request.unitsPerEm <= 0) {
    throw new RangeError('MTSDF unitsPerEm must be finite and positive');
  }
  const { minX, minY, maxX, maxY } = request.bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
    throw new RangeError('MTSDF bounds must be finite and non-empty');
  }
  checkedDimension(request.region.innerWidth, request.region.paddingX, 'width');
  checkedDimension(request.region.innerHeight, request.region.paddingY, 'height');
  if (request.commands.length === 0) throw new RangeError('MTSDF outline must not be empty');
  for (const command of request.commands) {
    const coordinates =
      command.kind === 'close'
        ? []
        : command.kind === 'move' || command.kind === 'line'
          ? [command.x, command.y]
          : command.kind === 'quadratic'
            ? [command.controlX, command.controlY, command.x, command.y]
            : [command.control0X, command.control0Y, command.control1X, command.control1Y, command.x, command.y];
    if (!coordinates.every(Number.isFinite)) {
      throw new RangeError('MTSDF outline coordinates must be finite');
    }
  }
}

function checkedDimension(inner: number, padding: number, label: string): number {
  if (!Number.isSafeInteger(inner) || inner <= 0) {
    throw new RangeError(`MTSDF inner ${label} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(padding) || padding < 0) {
    throw new RangeError(`MTSDF ${label} padding must be a nonnegative safe integer`);
  }
  return checkedSum(inner, checkedProduct(padding, 2));
}

function readExports(wasmExports: WebAssembly.Exports, abi: MtsdfGeneratorAbiV1): MtsdfGeneratorExports {
  const memory = wasmExports[abi.memory];
  const allocate = wasmExports[abi.functions.allocate];
  const deallocate = wasmExports[abi.functions.deallocate];
  const generate = wasmExports[abi.functions.generate];
  const resultPointer = wasmExports[abi.functions.resultPointer];
  const resultLength = wasmExports[abi.functions.resultLength];
  if (
    !(memory instanceof WebAssembly.Memory) ||
    typeof allocate !== 'function' ||
    typeof deallocate !== 'function' ||
    typeof generate !== 'function' ||
    typeof resultPointer !== 'function' ||
    typeof resultLength !== 'function'
  ) {
    throw new TypeError('invalid MTSDF generator Wasm exports');
  }
  return {
    memory,
    allocate: allocate as MtsdfGeneratorExports['allocate'],
    deallocate: deallocate as MtsdfGeneratorExports['deallocate'],
    generate: generate as MtsdfGeneratorExports['generate'],
    resultPointer: resultPointer as MtsdfGeneratorExports['resultPointer'],
    resultLength: resultLength as MtsdfGeneratorExports['resultLength'],
  };
}

function statusCode(status: number, abi: MtsdfGeneratorAbiV1): MtsdfGenerationErrorCode {
  if (status === abi.status.invalidRequest) return 'INVALID_REQUEST';
  if (status === abi.status.invalidOutline) return 'INVALID_OUTLINE';
  return 'GENERATION_FAILED';
}

function copyToMemory(memory: WebAssembly.Memory, pointer: number, bytes: Uint8Array): void {
  memoryRange(memory, pointer, bytes.byteLength).set(bytes);
}

function copyFromMemory(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  return memoryRange(memory, pointer, length).slice();
}

function memoryRange(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  if (
    !Number.isSafeInteger(pointer) ||
    !Number.isSafeInteger(length) ||
    pointer < 0 ||
    length < 0 ||
    pointer + length > memory.buffer.byteLength
  ) {
    throw new TypeError('MTSDF generator memory range is outside linear memory');
  }
  return new Uint8Array(memory.buffer, pointer, length);
}

function checkedProduct(...values: number[]): number {
  const product = values.reduce((result, value) => result * value, 1);
  if (!Number.isSafeInteger(product) || product < 0) {
    throw new RangeError('MTSDF byte length exceeds JavaScript safe integers');
  }
  return product;
}

function checkedSum(...values: number[]): number {
  const sum = values.reduce((result, value) => result + value, 0);
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new RangeError('MTSDF byte length exceeds JavaScript safe integers');
  }
  return sum;
}
