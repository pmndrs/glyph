import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PolicyBufferId, PolicyInput, PolicyInputScope, PolicyOperation } from './render-policy.js';
import type { PolicyBufferDeclaration, AnyTechniqueSchema } from './technique-schema.js';
import { isTechniqueSchema } from './technique-schema.js';

/**
 * Expression DSL over the policy-program register machine. Authors reference named
 * values instead of register numbers; `compile()` lowers the expression graph to the
 * same forward-only `PolicyOperation` records the hand-numbered form produced,
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

/** A named or derived f32 value inside one policy program. */
export interface PolicyF32Value {
  readonly [f32Brand]: true;
}

/** A named or derived u32 value inside one policy program. */
export interface PolicyU32Value {
  readonly [u32Brand]: true;
}

const nodes = new WeakMap<PolicyF32Value | PolicyU32Value, Node>();

function f32Value(node: Node): PolicyF32Value {
  const value = {} as PolicyF32Value;
  nodes.set(value, node);
  return value;
}

function u32Value(node: Node): PolicyU32Value {
  const value = {} as PolicyU32Value;
  nodes.set(value, node);
  return value;
}

function nodeOf(value: PolicyF32Value | PolicyU32Value): Node {
  const node = nodes.get(value);
  if (node === undefined) throw new TypeError('policy value does not belong to this authoring scope');
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
    throw new TypeError('policy values from different authoring scopes cannot combine');
  }
  return left.authoringScope ?? right.authoringScope;
}

function assertAuthoringScope(node: Node, authoringScope: object): void {
  if (node.authoringScope !== undefined && node.authoringScope !== authoringScope) {
    throw new TypeError('policy value belongs to a different authoring scope');
  }
}

function assertNodeScalar(node: Node, scalar: 'f32' | 'u32', buffer: number, lane: number): void {
  const actual = node.kind === 'loadU32' || node.kind === 'constantU32' ? 'u32' : 'f32';
  if (actual !== scalar) throw new TypeError(`policy buffer ${buffer} lane ${lane} needs ${scalar}; got ${actual}`);
}

function addF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
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

function subtractF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
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

function multiplyF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
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

function u32ToF32(source: PolicyU32Value): PolicyF32Value {
  const sourceNode = nodeOf(source);
  return f32Value({ kind: 'convertU32ToF32', source: sourceNode, authoringScope: sourceNode.authoringScope });
}

function constantF32(value: number): PolicyF32Value {
  if (!Number.isFinite(value)) throw new RangeError('policy f32 constants must be finite');
  return f32Value({ kind: 'constantF32', value, authoringScope: undefined });
}

function constantU32(value: number): PolicyU32Value {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('policy u32 constants must be u32');
  }
  return u32Value({ kind: 'constantU32', value, authoringScope: undefined });
}

/** Typed f32 expression constructors for portable policy programs. */
export interface PolicyF32Expressions {
  readonly add: (left: PolicyF32Value, right: PolicyF32Value) => PolicyF32Value;
  readonly sub: (left: PolicyF32Value, right: PolicyF32Value) => PolicyF32Value;
  readonly mul: (left: PolicyF32Value, right: PolicyF32Value) => PolicyF32Value;
  readonly const: (value: number) => PolicyF32Value;
}

export const f32: PolicyF32Expressions = Object.freeze({
  add: addF32,
  sub: subtractF32,
  mul: multiplyF32,
  const: constantF32,
});

/** Typed u32 expression constructors and conversions for portable policy programs. */
export interface PolicyU32Expressions {
  readonly const: (value: number) => PolicyU32Value;
  readonly toF32: (source: PolicyU32Value) => PolicyF32Value;
}

export const u32: PolicyU32Expressions = Object.freeze({
  const: constantU32,
  toF32: u32ToF32,
});

/** The glyph color channels — the resolved paint; the engine has no background. */
export interface PolicyColorChannels {
  readonly red: PolicyF32Value;
  readonly green: PolicyF32Value;
  readonly blue: PolicyF32Value;
  readonly alpha: PolicyF32Value;
}

export interface PolicyProgramSemantics {
  readonly inlineOrigin: PolicyF32Value;
  readonly blockOrigin: PolicyF32Value;
  readonly fontSize: PolicyF32Value;
  readonly color: PolicyColorChannels;
  readonly inverseFontSize: PolicyF32Value | undefined;
  readonly transformIndex: PolicyU32Value;
  readonly stableGlyphId: PolicyU32Value;
}

export interface PolicyProgramOptions<
  F32 extends readonly string[] = readonly string[],
  U32 extends readonly string[] = readonly string[],
> {
  readonly scope: PolicyInputScope;
  readonly bindingF32?: F32;
  readonly bindingU32?: U32;
  readonly inverseFontSize?: boolean;
}

declare const compiledPolicySchemaBrand: unique symbol;
interface CompiledPolicyMetadata {
  readonly schema: AnyTechniqueSchema;
  readonly stableGlyphId: PolicyBufferId | undefined;
  readonly transformIndex: PolicyBufferId | undefined;
}

const compiledPolicyMetadata = new WeakMap<object, CompiledPolicyMetadata>();

export interface CompiledPolicyProgramBody<Schema extends AnyTechniqueSchema | undefined = undefined> {
  readonly [compiledPolicySchemaBrand]: Schema;
  readonly inputs: PolicyInput[];
  readonly operations: PolicyOperation[];
  readonly f32InputCount: number;
  readonly u32InputCount: number;
}

export interface PolicyProgramBuilder<F32 extends readonly string[], U32 extends readonly string[]> {
  readonly semantics: PolicyProgramSemantics;
  readonly binding: Readonly<Record<F32[number], PolicyF32Value> & Record<U32[number], PolicyU32Value>>;
  /** Store into a declared buffer; value kinds and lane count come from the declaration. */
  store<Buffer extends PolicyBufferDeclaration>(
    buffer: Buffer,
    lanes: Buffer['scalar'] extends 'f32' ? readonly PolicyF32Value[] : readonly PolicyU32Value[],
  ): void;
  storeF32(buffer: PolicyBufferId, lanes: readonly PolicyF32Value[]): void;
  storeU32(buffer: PolicyBufferId, lanes: readonly PolicyU32Value[]): void;
  compile(): CompiledPolicyProgramBody;
}

export interface PolicyProgramSystemBuffers {
  readonly stableGlyphId: PolicyBufferDeclaration<'u32', readonly ['stableGlyphId']>;
  readonly transformIndex?: PolicyBufferDeclaration<'u32', readonly ['transformIndex']>;
}

type PolicyBufferLaneValues<Buffer extends PolicyBufferDeclaration> = PolicyLaneTuple<
  Buffer['scalar'],
  Buffer['lanes']
>;

type PolicyLaneTuple<
  Scalar extends import('./technique-schema.js').PolicyScalarKind,
  Lanes extends readonly string[],
> = Lanes extends readonly [string, ...infer Rest extends readonly string[]]
  ? readonly [Scalar extends 'f32' ? PolicyF32Value : PolicyU32Value, ...PolicyLaneTuple<Scalar, Rest>]
  : readonly [];

export type TechniquePolicyStores<Buffers extends import('./technique-schema.js').PolicyBufferDeclarations> = {
  readonly [Name in keyof Buffers]: PolicyBufferLaneValues<Buffers[Name]>;
};

export interface TechniquePolicyProgramBuilder<
  Schema extends AnyTechniqueSchema,
  Buffers extends import('./technique-schema.js').PolicyBufferDeclarations,
  F32 extends readonly string[],
  U32 extends readonly string[],
> {
  readonly semantics: PolicyProgramSemantics;
  readonly binding: Readonly<Record<F32[number], PolicyF32Value> & Record<U32[number], PolicyU32Value>>;
  /** Compile exactly one value tuple for every buffer declared by the technique schema. */
  compile(stores: TechniquePolicyStores<Buffers>): CompiledPolicyProgramBody<Schema>;
}

type BindingNames<Names> = Names extends readonly string[] ? Names : readonly [];

interface StoreRecord {
  readonly opcode: number;
  readonly buffer: PolicyBufferId;
  readonly lane: number;
  readonly node: Node;
}

/** Build a program against one technique's authoritative schema. */
export function techniqueProgram<const Schema extends AnyTechniqueSchema>(
  schema: Schema,
  options: { readonly inverseFontSize?: boolean; readonly system?: PolicyProgramSystemBuffers } = {},
): TechniquePolicyProgramBuilder<
  Schema,
  Schema['buffers'],
  BindingNames<Schema['binding']['f32']>,
  BindingNames<Schema['binding']['u32']>
> {
  if (!isTechniqueSchema(schema)) throw new TypeError('technique policy programs need a defined technique schema');
  if (!isNonArrayObject(options)) throw new TypeError('technique policy options need an object');
  if (options.inverseFontSize !== undefined && typeof options.inverseFontSize !== 'boolean') {
    throw new TypeError('technique policy inverseFontSize needs a boolean');
  }
  const system =
    options.system === undefined ? undefined : normalizePolicyProgramSystemBuffers(schema.buffers, options.system);
  const program = policyProgram({
    scope: schema.scope,
    bindingF32: (schema.binding.f32 ?? []) as BindingNames<Schema['binding']['f32']>,
    bindingU32: (schema.binding.u32 ?? []) as BindingNames<Schema['binding']['u32']>,
    ...(options.inverseFontSize === undefined ? {} : { inverseFontSize: options.inverseFontSize }),
  });
  let compiled = false;
  return Object.freeze({
    semantics: program.semantics,
    binding: program.binding,
    compile(stores: TechniquePolicyStores<Schema['buffers']>) {
      if (compiled) throw new Error('technique policy program already compiled');
      compiled = true;
      if (typeof stores !== 'object' || stores === null || Array.isArray(stores)) {
        throw new TypeError('technique policy stores need an object keyed by schema buffer name');
      }
      const expected = Object.keys(schema.buffers);
      const actual = Object.keys(stores);
      for (const name of actual) {
        if (!Object.hasOwn(schema.buffers, name))
          throw new TypeError(`technique policy stores undeclared buffer "${name}"`);
      }
      for (const name of expected) {
        if (!Object.hasOwn(stores, name)) throw new TypeError(`technique policy omits declared buffer "${name}"`);
        const buffer = schema.buffers[name]!;
        const lanes = stores[name as keyof Schema['buffers']];
        if (!Array.isArray(lanes)) throw new TypeError(`technique policy buffer "${name}" needs a value tuple`);
        if (lanes.length !== buffer.lanes.length) {
          throw new RangeError(
            `technique policy buffer "${name}" declares ${buffer.lanes.length} lanes; got ${lanes.length} values`,
          );
        }
        if (buffer.scalar === 'f32') program.storeF32(buffer.id, lanes as readonly PolicyF32Value[]);
        else program.storeU32(buffer.id, lanes as readonly PolicyU32Value[]);
      }
      if (system !== undefined) {
        program.store(system.stableGlyphId, [program.semantics.stableGlyphId]);
        if (system.transformIndex !== undefined) {
          program.store(system.transformIndex, [program.semantics.transformIndex]);
        }
      }
      const body = program.compile();
      compiledPolicyMetadata.set(body, {
        schema,
        stableGlyphId: system?.stableGlyphId.id,
        transformIndex: system?.transformIndex?.id,
      });
      return body as unknown as CompiledPolicyProgramBody<Schema>;
    },
  });
}

/** @internal Snapshot and validate renderer-owned lanes before invoking a technique body. */
export function normalizePolicyProgramSystemBuffers(
  technique: import('./technique-schema.js').PolicyBufferDeclarations,
  value: unknown,
): PolicyProgramSystemBuffers {
  if (!isNonArrayObject(value)) throw new TypeError('policy system buffers need an object');
  const stableGlyphId = snapshotSystemBuffer(value.stableGlyphId, 'stableGlyphId');
  const transformIndex =
    value.transformIndex === undefined ? undefined : snapshotSystemBuffer(value.transformIndex, 'transformIndex');
  const ids = new Set(Object.values(technique).map((buffer) => buffer.id));
  if (ids.has(stableGlyphId.id)) throw new TypeError('stableGlyphId system buffer collides with a technique buffer');
  if (transformIndex !== undefined) {
    if (transformIndex.id === stableGlyphId.id) {
      throw new TypeError('transformIndex and stableGlyphId system buffers collide');
    }
    if (ids.has(transformIndex.id))
      throw new TypeError('transformIndex system buffer collides with a technique buffer');
  }
  return Object.freeze({ stableGlyphId, ...(transformIndex === undefined ? {} : { transformIndex }) });
}

function snapshotSystemBuffer<const Name extends 'stableGlyphId' | 'transformIndex'>(
  value: unknown,
  name: Name,
): PolicyBufferDeclaration<'u32', readonly [Name]> {
  if (!isNonArrayObject(value)) throw new TypeError(`${name} system buffer needs one u32 "${name}" lane`);
  const lanes = value.lanes;
  if (
    !Number.isSafeInteger(value.id) ||
    (value.id as number) <= 0 ||
    (value.id as number) > 0xffff ||
    value.scalar !== 'u32' ||
    !Array.isArray(lanes) ||
    lanes.length !== 1 ||
    lanes[0] !== name
  ) {
    throw new TypeError(`${name} system buffer needs one u32 "${name}" lane`);
  }
  return Object.freeze({ id: value.id, scalar: 'u32', lanes: Object.freeze([name]) }) as PolicyBufferDeclaration<
    'u32',
    readonly [Name]
  >;
}

export function policyProgram<
  const F32 extends readonly string[] = readonly [],
  const U32 extends readonly string[] = readonly [],
>(options: PolicyProgramOptions<F32, U32>): PolicyProgramBuilder<F32, U32> {
  if (!isNonArrayObject(options)) throw new TypeError('policy program options need an object');
  if (!(typeof options.scope === 'string' && Object.hasOwn(textShaperAbi.policy.inputScopes, options.scope))) {
    throw new TypeError('policy program scope is not a policy input scope');
  }
  if (options.bindingF32 !== undefined && !Array.isArray(options.bindingF32)) {
    throw new TypeError('policy bindingF32 needs an array');
  }
  if (options.bindingU32 !== undefined && !Array.isArray(options.bindingU32)) {
    throw new TypeError('policy bindingU32 needs an array');
  }
  if (options.inverseFontSize !== undefined && typeof options.inverseFontSize !== 'boolean') {
    throw new TypeError('policy inverseFontSize needs a boolean');
  }
  const semanticF32 = textShaperAbi.engine.semanticF32Fields;
  const semanticU32 = textShaperAbi.engine.semanticU32Fields;
  const bindingF32Names = [...(options.bindingF32 ?? [])];
  const bindingU32Names = [...(options.bindingU32 ?? [])];
  for (const name of [...bindingF32Names, ...bindingU32Names] as readonly unknown[]) {
    if (typeof name !== 'string' || name === '') {
      throw new TypeError('policy binding field names must be nonempty strings');
    }
  }
  const uniqueNames = new Set([...bindingF32Names, ...bindingU32Names]);
  if (uniqueNames.size !== bindingF32Names.length + bindingU32Names.length) {
    throw new TypeError('policy binding field names must be unique');
  }
  const f32InputCount = 7 + (options.inverseFontSize === true ? 1 : 0) + bindingF32Names.length;
  const u32InputCount = 2 + bindingU32Names.length;
  if (f32InputCount > MAX_REGISTERS || u32InputCount > MAX_REGISTERS) {
    throw new RangeError(`policy input fields exceed the ${MAX_REGISTERS}-slot register file`);
  }

  // The input table mirrors the canonical order the engine validated all along:
  // seven semantic f32 fields, optional inverseFontSize, then the binding's f32
  // fields; transformIndex and stableGlyphId, then the binding's u32 fields.
  const inputs: PolicyInput[] = [
    { scope: 'semantic', field: semanticF32.inlineOrigin },
    { scope: 'semantic', field: semanticF32.blockOrigin },
    { scope: 'semantic', field: semanticF32.fontSize },
    { scope: 'semantic', field: semanticF32.foregroundRed },
    { scope: 'semantic', field: semanticF32.foregroundGreen },
    { scope: 'semantic', field: semanticF32.foregroundBlue },
    { scope: 'semantic', field: semanticF32.foregroundAlpha },
    ...(options.inverseFontSize === true ? [{ scope: 'semantic' as const, field: semanticF32.inverseFontSize }] : []),
    ...bindingF32Names.map((_, field) => ({ scope: options.scope, field })),
    { scope: 'semantic', field: semanticU32.transformIndex },
    { scope: 'semantic', field: semanticU32.stableGlyphId },
    ...bindingU32Names.map((_, field) => ({ scope: options.scope, field })),
  ];
  const authoringScope = {};
  let nextF32 = 0;
  const loadF32 = (label: string): PolicyF32Value =>
    f32Value({ kind: 'loadF32', input: nextF32++, label, authoringScope });
  const semantics: PolicyProgramSemantics = {
    inlineOrigin: loadF32('inlineOrigin'),
    blockOrigin: loadF32('blockOrigin'),
    fontSize: loadF32('fontSize'),
    color: {
      red: loadF32('color.red'),
      green: loadF32('color.green'),
      blue: loadF32('color.blue'),
      alpha: loadF32('color.alpha'),
    },
    inverseFontSize: options.inverseFontSize === true ? loadF32('inverseFontSize') : undefined,
    transformIndex: u32Value({ kind: 'loadU32', input: 0, label: 'transformIndex', authoringScope }),
    stableGlyphId: u32Value({ kind: 'loadU32', input: 1, label: 'stableGlyphId', authoringScope }),
  };
  const binding: Record<string, PolicyF32Value | PolicyU32Value> = {};
  for (const name of bindingF32Names) binding[name] = loadF32(name);
  for (const [index, name] of bindingU32Names.entries()) {
    binding[name] = u32Value({ kind: 'loadU32', input: 2 + index, label: name, authoringScope });
  }

  const stores: StoreRecord[] = [];
  const opcodes = textShaperAbi.policy.opcodes;

  return {
    semantics,
    binding: binding as PolicyProgramBuilder<F32, U32>['binding'],
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
      const operations: PolicyOperation[] = [];
      const registers = new Map<Node, number>();
      const emit = (node: Node): number => {
        const assigned = registers.get(node);
        if (assigned !== undefined) return assigned;
        let operation: PolicyOperation;
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
        const register = registers.size;
        if (register >= MAX_REGISTERS) {
          throw new RangeError(
            `policy program needs more than ${MAX_REGISTERS} registers; name intermediate values and reuse them`,
          );
        }
        registers.set(node, register);
        operations.push({ ...operation, target: register });
        return register;
      };
      for (const store of stores) {
        const register = emit(store.node);
        operations.push({ opcode: store.opcode, operand0: register, operand1: store.lane, immediate0: store.buffer });
      }
      return { inputs, operations, f32InputCount, u32InputCount } as unknown as CompiledPolicyProgramBody;
    },
  };
}

/** @internal Reject a compiled body that was not produced from this exact schema witness. */
export function assertTechniquePolicyBody(
  body: unknown,
  schema: AnyTechniqueSchema,
  system?: PolicyProgramSystemBuffers,
): asserts body is CompiledPolicyProgramBody<AnyTechniqueSchema> {
  const metadata = typeof body === 'object' && body !== null ? compiledPolicyMetadata.get(body) : undefined;
  if (metadata?.schema !== schema) {
    throw new TypeError(`technique "${schema.technique}" policy body does not belong to its registered schema`);
  }
  if (
    system !== undefined &&
    (metadata.stableGlyphId !== system.stableGlyphId.id || metadata.transformIndex !== system.transformIndex?.id)
  ) {
    throw new TypeError(`technique "${schema.technique}" policy body does not use the requested system buffers`);
  }
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
