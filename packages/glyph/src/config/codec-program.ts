import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { RasterTextEffect } from './raster-format.js';
import type { CodecBufferId, CodecInput, CodecInputScope, CodecOperation } from './codec.js';
import type { CodecBufferDeclaration, AnyTechniqueSchema } from './schema.js';
import { isTechniqueSchema } from './schema.js';
import { normalizeCodecProgramSystemBuffers, recordTechniqueCodecBody } from '../internal/codec-program-contract.js';

/**
 * Expression DSL over the codec-program register machine. Authors reference named
 * values instead of register numbers; `compile()` lowers the expression graph to the
 * same forward-only `CodecOperation` records the hand-numbered form produced,
 * allocating registers automatically and failing loudly on exhaustion. The wire
 * format, validator, and interpreter are untouched — this is authoring only.
 */

const MAX_REGISTERS = 32;

type Node =
  | { readonly kind: 'loadF32'; readonly input: number; readonly label: string; readonly authoringScope: object }
  | { readonly kind: 'loadU32'; readonly input: number; readonly label: string; readonly authoringScope: object }
  | {
      readonly kind: 'binary';
      readonly op: 'addF32' | 'subtractF32' | 'multiplyF32';
      readonly left: Node;
      readonly right: Node;
      readonly authoringScope: object | undefined;
    }
  | { readonly kind: 'constantF32'; readonly value: number; readonly authoringScope: undefined }
  | { readonly kind: 'constantU32'; readonly value: number; readonly authoringScope: undefined }
  | { readonly kind: 'convertU32ToF32'; readonly source: Node; readonly authoringScope: object | undefined };

declare const f32Brand: unique symbol;
declare const u32Brand: unique symbol;

/** A named or derived f32 value inside one codec program. */
export interface CodecF32Value {
  readonly [f32Brand]: true;
}

/** A named or derived u32 value inside one codec program. */
export interface CodecU32Value {
  readonly [u32Brand]: true;
}

const nodes = new WeakMap<CodecF32Value | CodecU32Value, Node>();

function f32Value(node: Node): CodecF32Value {
  const value = {} as CodecF32Value;
  nodes.set(value, node);
  return value;
}

function u32Value(node: Node): CodecU32Value {
  const value = {} as CodecU32Value;
  nodes.set(value, node);
  return value;
}

function nodeOf(value: CodecF32Value | CodecU32Value): Node {
  const node = nodes.get(value);
  if (node === undefined) throw new TypeError('codec value does not belong to this authoring scope');
  return node;
}

/**
 * A loaded value's input index only means something inside the program that
 * created it; storing it elsewhere would silently read a different field.
 * Provenance is stamped at construction and combined in O(1) per node, so
 * shared expression DAGs never require a graph walk: constants stay
 * scope-free, and mixing two authoring scopes fails at the combinator itself.
 */
function combinedAuthoringScope(left: Node, right: Node): object | undefined {
  if (
    left.authoringScope !== undefined &&
    right.authoringScope !== undefined &&
    left.authoringScope !== right.authoringScope
  ) {
    throw new TypeError('codec values from different authoring scopes cannot combine');
  }
  return left.authoringScope ?? right.authoringScope;
}

function assertAuthoringScope(node: Node, authoringScope: object): void {
  if (node.authoringScope !== undefined && node.authoringScope !== authoringScope) {
    throw new TypeError('codec value belongs to a different authoring scope');
  }
}

function assertNodeScalar(node: Node, scalar: 'f32' | 'u32', buffer: number, lane: number): void {
  const actual = node.kind === 'loadU32' || node.kind === 'constantU32' ? 'u32' : 'f32';
  if (actual !== scalar) throw new TypeError(`codec buffer ${buffer} lane ${lane} needs ${scalar}; got ${actual}`);
}

function addF32(left: CodecF32Value, right: CodecF32Value): CodecF32Value {
  const leftNode = nodeOf(left);
  const rightNode = nodeOf(right);
  return f32Value({
    kind: 'binary',
    op: 'addF32',
    left: leftNode,
    right: rightNode,
    authoringScope: combinedAuthoringScope(leftNode, rightNode),
  });
}

function subtractF32(left: CodecF32Value, right: CodecF32Value): CodecF32Value {
  const leftNode = nodeOf(left);
  const rightNode = nodeOf(right);
  return f32Value({
    kind: 'binary',
    op: 'subtractF32',
    left: leftNode,
    right: rightNode,
    authoringScope: combinedAuthoringScope(leftNode, rightNode),
  });
}

function multiplyF32(left: CodecF32Value, right: CodecF32Value): CodecF32Value {
  const leftNode = nodeOf(left);
  const rightNode = nodeOf(right);
  return f32Value({
    kind: 'binary',
    op: 'multiplyF32',
    left: leftNode,
    right: rightNode,
    authoringScope: combinedAuthoringScope(leftNode, rightNode),
  });
}

function u32ToF32(source: CodecU32Value): CodecF32Value {
  const sourceNode = nodeOf(source);
  return f32Value({ kind: 'convertU32ToF32', source: sourceNode, authoringScope: sourceNode.authoringScope });
}

function constantF32(value: number): CodecF32Value {
  if (!Number.isFinite(value)) throw new RangeError('codec f32 constants must be finite');
  return f32Value({ kind: 'constantF32', value, authoringScope: undefined });
}

function constantU32(value: number): CodecU32Value {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('codec u32 constants must be u32');
  }
  return u32Value({ kind: 'constantU32', value, authoringScope: undefined });
}

/** Typed f32 expression constructors for portable codec programs. */
export interface CodecF32Expressions {
  readonly add: (left: CodecF32Value, right: CodecF32Value) => CodecF32Value;
  readonly sub: (left: CodecF32Value, right: CodecF32Value) => CodecF32Value;
  readonly mul: (left: CodecF32Value, right: CodecF32Value) => CodecF32Value;
  readonly const: (value: number) => CodecF32Value;
}

export const f32: CodecF32Expressions = Object.freeze({
  add: addF32,
  sub: subtractF32,
  mul: multiplyF32,
  const: constantF32,
});

/** Typed u32 expression constructors and conversions for portable codec programs. */
export interface CodecU32Expressions {
  readonly const: (value: number) => CodecU32Value;
  readonly toF32: (source: CodecU32Value) => CodecF32Value;
}

export const u32: CodecU32Expressions = Object.freeze({
  const: constantU32,
  toF32: u32ToF32,
});

/** The glyph color channels — the resolved paint; the engine has no background. */
export interface CodecColorChannels {
  readonly red: CodecF32Value;
  readonly green: CodecF32Value;
  readonly blue: CodecF32Value;
  readonly alpha: CodecF32Value;
}

export interface CodecProgramSemantics {
  readonly inlineOrigin: CodecF32Value;
  readonly blockOrigin: CodecF32Value;
  readonly fontSize: CodecF32Value;
  readonly color: CodecColorChannels;
  readonly outline: Readonly<{ readonly color: CodecU32Value; readonly widthEm: CodecF32Value }> | undefined;
  readonly shadow:
    | Readonly<{
        readonly color: CodecU32Value;
        readonly offsetXEm: CodecF32Value;
        readonly offsetYEm: CodecF32Value;
      }>
    | undefined;
  readonly inverseFontSize: CodecF32Value | undefined;
  readonly transformIndex: CodecU32Value;
  readonly stableGlyphId: CodecU32Value;
}

export interface CodecProgramOptions<
  F32 extends readonly string[] = readonly string[],
  U32 extends readonly string[] = readonly string[],
> {
  readonly scope: CodecInputScope;
  readonly bindingF32?: F32;
  readonly bindingU32?: U32;
  readonly inverseFontSize?: boolean;
  readonly textEffects?: readonly RasterTextEffect[];
}

declare const compiledCodecSchemaBrand: unique symbol;

export interface CompiledCodecProgramBody<Schema extends AnyTechniqueSchema | undefined = undefined> {
  readonly [compiledCodecSchemaBrand]: Schema;
  readonly inputs: CodecInput[];
  readonly operations: CodecOperation[];
  readonly f32InputCount: number;
  readonly u32InputCount: number;
}

export interface CodecProgramBuilder<F32 extends readonly string[], U32 extends readonly string[]> {
  readonly semantics: CodecProgramSemantics;
  readonly binding: Readonly<Record<F32[number], CodecF32Value> & Record<U32[number], CodecU32Value>>;
  /** Store into a declared buffer; value kinds and lane count come from the declaration. */
  store<Buffer extends CodecBufferDeclaration>(
    buffer: Buffer,
    lanes: Buffer['scalar'] extends 'f32' ? readonly CodecF32Value[] : readonly CodecU32Value[],
  ): void;
  storeF32(buffer: CodecBufferId, lanes: readonly CodecF32Value[]): void;
  storeU32(buffer: CodecBufferId, lanes: readonly CodecU32Value[]): void;
  compile(): CompiledCodecProgramBody;
}

export interface CodecProgramSystemBuffers {
  readonly stableGlyphId: CodecBufferDeclaration<'u32', readonly ['stableGlyphId']>;
  readonly transformIndex?: CodecBufferDeclaration<'u32', readonly ['transformIndex']>;
}

type CodecBufferLaneValues<Buffer extends CodecBufferDeclaration> = CodecLaneTuple<Buffer['scalar'], Buffer['lanes']>;

type CodecLaneTuple<
  Scalar extends import('./schema.js').CodecScalarKind,
  Lanes extends readonly string[],
> = Lanes extends readonly [string, ...infer Rest extends readonly string[]]
  ? readonly [Scalar extends 'f32' ? CodecF32Value : CodecU32Value, ...CodecLaneTuple<Scalar, Rest>]
  : readonly [];

export type TechniqueCodecStores<Buffers extends import('./schema.js').CodecBufferDeclarations> = {
  readonly [Name in keyof Buffers]: CodecBufferLaneValues<Buffers[Name]>;
};

export interface TechniqueCodecProgramBuilder<
  Schema extends AnyTechniqueSchema,
  Buffers extends import('./schema.js').CodecBufferDeclarations,
  F32 extends readonly string[],
  U32 extends readonly string[],
> {
  readonly semantics: CodecProgramSemantics;
  readonly binding: Readonly<Record<F32[number], CodecF32Value> & Record<U32[number], CodecU32Value>>;
  /** Compile exactly one value tuple for every buffer declared by the technique schema. */
  compile(stores: TechniqueCodecStores<Buffers>): CompiledCodecProgramBody<Schema>;
}

type BindingNames<Names> = Names extends readonly string[] ? Names : readonly [];

interface StoreRecord {
  readonly opcode: number;
  readonly buffer: CodecBufferId;
  readonly lane: number;
  readonly node: Node;
}

/** Build a program against one technique's authoritative schema. */
export function techniqueProgram<const Schema extends AnyTechniqueSchema>(
  schema: Schema,
  options: {
    readonly inverseFontSize?: boolean;
    readonly textEffects?: readonly RasterTextEffect[];
    readonly system?: CodecProgramSystemBuffers;
  } = {},
): TechniqueCodecProgramBuilder<
  Schema,
  Schema['buffers'],
  BindingNames<Schema['binding']['f32']>,
  BindingNames<Schema['binding']['u32']>
> {
  if (!isTechniqueSchema(schema)) throw new TypeError('technique codec programs need a defined technique schema');
  if (!isNonArrayObject(options)) throw new TypeError('technique codec options need an object');
  if (options.inverseFontSize !== undefined && typeof options.inverseFontSize !== 'boolean') {
    throw new TypeError('technique codec inverseFontSize needs a boolean');
  }
  const system =
    options.system === undefined ? undefined : normalizeCodecProgramSystemBuffers(schema.buffers, options.system);
  const program = codecProgram({
    scope: schema.scope,
    bindingF32: (schema.binding.f32 ?? []) as BindingNames<Schema['binding']['f32']>,
    bindingU32: (schema.binding.u32 ?? []) as BindingNames<Schema['binding']['u32']>,
    ...(options.inverseFontSize === undefined ? {} : { inverseFontSize: options.inverseFontSize }),
    ...(options.textEffects === undefined ? {} : { textEffects: options.textEffects }),
  });
  let compiled = false;
  return Object.freeze({
    semantics: program.semantics,
    binding: program.binding,
    compile(stores: TechniqueCodecStores<Schema['buffers']>) {
      if (compiled) throw new Error('technique codec program already compiled');
      compiled = true;
      if (typeof stores !== 'object' || stores === null || Array.isArray(stores)) {
        throw new TypeError('technique codec stores need an object keyed by schema buffer name');
      }
      const expected = Object.keys(schema.buffers);
      const actual = Object.keys(stores);
      for (const name of actual) {
        if (!Object.hasOwn(schema.buffers, name))
          throw new TypeError(`technique codec stores undeclared buffer "${name}"`);
      }
      for (const name of expected) {
        if (!Object.hasOwn(stores, name)) throw new TypeError(`technique codec omits declared buffer "${name}"`);
        const buffer = schema.buffers[name]!;
        const lanes = stores[name as keyof Schema['buffers']];
        if (!Array.isArray(lanes)) throw new TypeError(`technique codec buffer "${name}" needs a value tuple`);
        if (lanes.length !== buffer.lanes.length) {
          throw new RangeError(
            `technique codec buffer "${name}" declares ${buffer.lanes.length} lanes; got ${lanes.length} values`,
          );
        }
        if (buffer.scalar === 'f32') program.storeF32(buffer.id, lanes as readonly CodecF32Value[]);
        else program.storeU32(buffer.id, lanes as readonly CodecU32Value[]);
      }
      if (system !== undefined) {
        program.store(system.stableGlyphId, [program.semantics.stableGlyphId]);
        if (system.transformIndex !== undefined) {
          program.store(system.transformIndex, [program.semantics.transformIndex]);
        }
      }
      const body = program.compile();
      recordTechniqueCodecBody(body, {
        schema,
        stableGlyphId: system?.stableGlyphId.id,
        transformIndex: system?.transformIndex?.id,
      });
      return body as unknown as CompiledCodecProgramBody<Schema>;
    },
  });
}

export function codecProgram<
  const F32 extends readonly string[] = readonly [],
  const U32 extends readonly string[] = readonly [],
>(options: CodecProgramOptions<F32, U32>): CodecProgramBuilder<F32, U32> {
  if (!isNonArrayObject(options)) throw new TypeError('codec program options need an object');
  if (!(typeof options.scope === 'string' && Object.hasOwn(textShaperAbi.codec.inputScopes, options.scope))) {
    throw new TypeError('codec program scope is not a codec input scope');
  }
  if (options.bindingF32 !== undefined && !Array.isArray(options.bindingF32)) {
    throw new TypeError('codec bindingF32 needs an array');
  }
  if (options.bindingU32 !== undefined && !Array.isArray(options.bindingU32)) {
    throw new TypeError('codec bindingU32 needs an array');
  }
  if (options.inverseFontSize !== undefined && typeof options.inverseFontSize !== 'boolean') {
    throw new TypeError('codec inverseFontSize needs a boolean');
  }
  const textEffects = normalizeTextEffects(options.textEffects);
  const semanticF32 = textShaperAbi.engine.semanticF32Fields;
  const semanticU32 = textShaperAbi.engine.semanticU32Fields;
  const bindingF32Names = [...(options.bindingF32 ?? [])];
  const bindingU32Names = [...(options.bindingU32 ?? [])];
  for (const name of [...bindingF32Names, ...bindingU32Names] as readonly unknown[]) {
    if (typeof name !== 'string' || name === '') {
      throw new TypeError('codec binding field names must be nonempty strings');
    }
  }
  const uniqueNames = new Set([...bindingF32Names, ...bindingU32Names]);
  if (uniqueNames.size !== bindingF32Names.length + bindingU32Names.length) {
    throw new TypeError('codec binding field names must be unique');
  }
  const hasOutline = textEffects.includes('outline');
  const hasShadow = textEffects.includes('shadow');
  const f32InputCount =
    7 +
    (hasOutline ? 1 : 0) +
    (hasShadow ? 2 : 0) +
    (options.inverseFontSize === true ? 1 : 0) +
    bindingF32Names.length;
  const u32InputCount = 2 + (hasOutline ? 1 : 0) + (hasShadow ? 1 : 0) + bindingU32Names.length;
  if (f32InputCount > MAX_REGISTERS || u32InputCount > MAX_REGISTERS) {
    throw new RangeError(`codec input fields exceed the ${MAX_REGISTERS}-slot register file`);
  }

  // The input table mirrors the canonical order the engine validated all along:
  // Semantic geometry and paint precede binding fields; system identities precede
  // packed effect colors and binding u32 fields.
  const inputs: CodecInput[] = [
    { scope: 'semantic', field: semanticF32.inlineOrigin },
    { scope: 'semantic', field: semanticF32.blockOrigin },
    { scope: 'semantic', field: semanticF32.fontSize },
    { scope: 'semantic', field: semanticF32.foregroundRed },
    { scope: 'semantic', field: semanticF32.foregroundGreen },
    { scope: 'semantic', field: semanticF32.foregroundBlue },
    { scope: 'semantic', field: semanticF32.foregroundAlpha },
    ...(hasOutline ? [{ scope: 'semantic' as const, field: semanticF32.outlineWidthEm }] : []),
    ...(hasShadow
      ? [
          { scope: 'semantic' as const, field: semanticF32.shadowOffsetXEm },
          { scope: 'semantic' as const, field: semanticF32.shadowOffsetYEm },
        ]
      : []),
    ...(options.inverseFontSize === true ? [{ scope: 'semantic' as const, field: semanticF32.inverseFontSize }] : []),
    ...bindingF32Names.map((_, field) => ({ scope: options.scope, field })),
    { scope: 'semantic', field: semanticU32.transformIndex },
    { scope: 'semantic', field: semanticU32.stableGlyphId },
    ...(hasOutline ? [{ scope: 'semantic' as const, field: semanticU32.outlineRgba }] : []),
    ...(hasShadow ? [{ scope: 'semantic' as const, field: semanticU32.shadowRgba }] : []),
    ...bindingU32Names.map((_, field) => ({ scope: options.scope, field })),
  ];
  const authoringScope = {};
  let nextF32 = 0;
  const loadF32 = (label: string): CodecF32Value =>
    f32Value({ kind: 'loadF32', input: nextF32++, label, authoringScope });
  const semantics: CodecProgramSemantics = {
    inlineOrigin: loadF32('inlineOrigin'),
    blockOrigin: loadF32('blockOrigin'),
    fontSize: loadF32('fontSize'),
    color: {
      red: loadF32('color.red'),
      green: loadF32('color.green'),
      blue: loadF32('color.blue'),
      alpha: loadF32('color.alpha'),
    },
    outline: hasOutline
      ? {
          color: u32Value({ kind: 'loadU32', input: 2, label: 'outline.color', authoringScope }),
          widthEm: loadF32('outline.widthEm'),
        }
      : undefined,
    shadow: hasShadow
      ? {
          color: u32Value({ kind: 'loadU32', input: hasOutline ? 3 : 2, label: 'shadow.color', authoringScope }),
          offsetXEm: loadF32('shadow.offsetXEm'),
          offsetYEm: loadF32('shadow.offsetYEm'),
        }
      : undefined,
    inverseFontSize: options.inverseFontSize === true ? loadF32('inverseFontSize') : undefined,
    transformIndex: u32Value({ kind: 'loadU32', input: 0, label: 'transformIndex', authoringScope }),
    stableGlyphId: u32Value({ kind: 'loadU32', input: 1, label: 'stableGlyphId', authoringScope }),
  };
  const binding: Record<string, CodecF32Value | CodecU32Value> = {};
  for (const name of bindingF32Names) binding[name] = loadF32(name);
  const bindingU32Offset = 2 + (hasOutline ? 1 : 0) + (hasShadow ? 1 : 0);
  for (const [index, name] of bindingU32Names.entries()) {
    binding[name] = u32Value({ kind: 'loadU32', input: bindingU32Offset + index, label: name, authoringScope });
  }

  const stores: StoreRecord[] = [];
  const opcodes = textShaperAbi.codec.opcodes;

  return {
    semantics,
    binding: binding as CodecProgramBuilder<F32, U32>['binding'],
    store(buffer, lanes) {
      if (lanes.length !== buffer.lanes.length) {
        throw new RangeError(
          `buffer ${buffer.id} declares ${buffer.lanes.length} lanes (${buffer.lanes.join(', ')}); got ${lanes.length} values`,
        );
      }
      const opcode = buffer.scalar === 'f32' ? opcodes.storeF32 : opcodes.storeU32;
      for (const [lane, value] of lanes.entries()) {
        const node = nodeOf(value);
        assertAuthoringScope(node, authoringScope);
        assertNodeScalar(node, buffer.scalar, buffer.id, lane);
        stores.push({ opcode, buffer: buffer.id, lane, node });
      }
    },
    storeF32(buffer, lanes) {
      for (const [lane, value] of lanes.entries()) {
        const node = nodeOf(value);
        assertAuthoringScope(node, authoringScope);
        assertNodeScalar(node, 'f32', buffer, lane);
        stores.push({ opcode: opcodes.storeF32, buffer, lane, node });
      }
    },
    storeU32(buffer, lanes) {
      for (const [lane, value] of lanes.entries()) {
        const node = nodeOf(value);
        assertAuthoringScope(node, authoringScope);
        assertNodeScalar(node, 'u32', buffer, lane);
        stores.push({ opcode: opcodes.storeU32, buffer, lane, node });
      }
    },
    compile() {
      const operations: CodecOperation[] = [];
      const registers = new Map<Node, number>();
      const remainingUses = new Map<Node, number>();
      const visited = new Set<Node>();
      const addUse = (node: Node): void => {
        remainingUses.set(node, (remainingUses.get(node) ?? 0) + 1);
      };
      const visit = (node: Node): void => {
        if (visited.has(node)) return;
        visited.add(node);
        if (node.kind === 'binary') {
          addUse(node.left);
          addUse(node.right);
          visit(node.left);
          visit(node.right);
        } else if (node.kind === 'convertU32ToF32') {
          addUse(node.source);
          visit(node.source);
        }
      };
      for (const store of stores) {
        addUse(store.node);
        visit(store.node);
      }
      const freeRegisters: number[] = [];
      let registerCount = 0;
      const allocateRegister = (): number => {
        const reused = freeRegisters.pop();
        if (reused !== undefined) return reused;
        if (registerCount >= MAX_REGISTERS) {
          throw new RangeError(`codec program needs more than ${MAX_REGISTERS} simultaneously live registers`);
        }
        return registerCount++;
      };
      const release = (node: Node): void => {
        const remaining = (remainingUses.get(node) ?? 0) - 1;
        remainingUses.set(node, remaining);
        if (remaining !== 0) return;
        const register = registers.get(node);
        if (register === undefined) throw new Error('codec register liveness is inconsistent');
        registers.delete(node);
        freeRegisters.push(register);
      };
      const emit = (node: Node): number => {
        const assigned = registers.get(node);
        if (assigned !== undefined) return assigned;
        let operation: CodecOperation;
        switch (node.kind) {
          case 'loadF32':
            operation = { opcode: opcodes.loadF32, target: 0, operand0: node.input };
            break;
          case 'loadU32':
            operation = { opcode: opcodes.loadU32, target: 0, operand0: node.input };
            break;
          case 'binary': {
            const left = emit(node.left);
            const right = emit(node.right);
            operation = { opcode: opcodes[node.op], target: 0, operand0: left, operand1: right };
            break;
          }
          case 'constantF32':
            operation = { opcode: opcodes.constantF32, target: 0, immediate0: f32Bits(node.value) };
            break;
          case 'constantU32':
            operation = { opcode: opcodes.constantU32, target: 0, immediate0: node.value };
            break;
          case 'convertU32ToF32': {
            const source = emit(node.source);
            operation = { opcode: opcodes.convertU32ToF32, target: 0, operand0: source };
            break;
          }
        }
        const register = allocateRegister();
        registers.set(node, register);
        operations.push({ ...operation, target: register });
        if (node.kind === 'binary') {
          release(node.left);
          release(node.right);
        } else if (node.kind === 'convertU32ToF32') {
          release(node.source);
        }
        return register;
      };
      for (const store of stores) {
        const register = emit(store.node);
        operations.push({ opcode: store.opcode, operand0: register, operand1: store.lane, immediate0: store.buffer });
        release(store.node);
      }
      return { inputs, operations, f32InputCount, u32InputCount } as unknown as CompiledCodecProgramBody;
    },
  };
}

function normalizeTextEffects(value: readonly RasterTextEffect[] | undefined): readonly RasterTextEffect[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('codec textEffects must be an array');
  for (const effect of value) {
    if (effect !== 'outline' && effect !== 'shadow') {
      throw new TypeError(`codec text effect "${String(effect)}" is not supported`);
    }
  }
  if (new Set(value).size !== value.length) throw new TypeError('codec textEffects must not contain duplicates');
  return value;
}

function f32Bits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
