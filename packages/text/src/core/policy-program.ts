import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { PolicyInput, PolicyInputScope, PolicyOperation } from './render-policy.js';
import type { PolicyBufferDeclaration, TechniqueSchema } from './technique-schema.js';

/**
 * Expression DSL over the policy-program register machine. Authors reference named
 * values instead of register numbers; `compile()` lowers the expression graph to the
 * same forward-only `PolicyOperation` records the hand-numbered form produced,
 * allocating registers automatically and failing loudly on exhaustion. The wire
 * format, validator, and interpreter are untouched — this is authoring only.
 */

const MAX_REGISTERS = 32;

type Node =
  | { readonly kind: 'loadF32'; readonly input: number; readonly label: string }
  | { readonly kind: 'loadU32'; readonly input: number; readonly label: string }
  | {
      readonly kind: 'binary';
      readonly op: 'addF32' | 'subtractF32' | 'multiplyF32';
      readonly left: Node;
      readonly right: Node;
    }
  | { readonly kind: 'constantF32'; readonly value: number }
  | { readonly kind: 'constantU32'; readonly value: number }
  | { readonly kind: 'convertU32ToF32'; readonly source: Node };

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
  if (node === undefined) throw new TypeError('policy value does not belong to this authoring session');
  return node;
}

export function addF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
  return f32Value({ kind: 'binary', op: 'addF32', left: nodeOf(left), right: nodeOf(right) });
}

export function subtractF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
  return f32Value({ kind: 'binary', op: 'subtractF32', left: nodeOf(left), right: nodeOf(right) });
}

export function multiplyF32(left: PolicyF32Value, right: PolicyF32Value): PolicyF32Value {
  return f32Value({ kind: 'binary', op: 'multiplyF32', left: nodeOf(left), right: nodeOf(right) });
}

export function u32ToF32(source: PolicyU32Value): PolicyF32Value {
  return f32Value({ kind: 'convertU32ToF32', source: nodeOf(source) });
}

export function constantF32(value: number): PolicyF32Value {
  if (!Number.isFinite(value)) throw new RangeError('policy f32 constants must be finite');
  return f32Value({ kind: 'constantF32', value });
}

export function constantU32(value: number): PolicyU32Value {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('policy u32 constants must be u32');
  }
  return u32Value({ kind: 'constantU32', value });
}

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

export interface CompiledPolicyProgramBody {
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
  storeF32(buffer: number, lanes: readonly PolicyF32Value[]): void;
  storeU32(buffer: number, lanes: readonly PolicyU32Value[]): void;
  compile(): CompiledPolicyProgramBody;
}

type BindingNames<Names> = Names extends readonly string[] ? Names : readonly [];

interface StoreRecord {
  readonly opcode: number;
  readonly buffer: number;
  readonly lane: number;
  readonly node: Node;
}

/** Build a program against one technique's authoritative schema. */
export function techniqueProgram<
  const Buffers extends import('./technique-schema.js').PolicyBufferDeclarations,
  const Binding extends import('./technique-schema.js').TechniqueBindingDeclaration,
>(
  schema: TechniqueSchema<Buffers, Binding>,
  options: { readonly inverseFontSize?: boolean } = {},
): PolicyProgramBuilder<BindingNames<Binding['f32']>, BindingNames<Binding['u32']>> {
  return policyProgram({
    scope: schema.scope,
    bindingF32: (schema.binding.f32 ?? []) as BindingNames<Binding['f32']>,
    bindingU32: (schema.binding.u32 ?? []) as BindingNames<Binding['u32']>,
    ...(options.inverseFontSize === undefined ? {} : { inverseFontSize: options.inverseFontSize }),
  });
}

export function policyProgram<
  const F32 extends readonly string[] = readonly [],
  const U32 extends readonly string[] = readonly [],
>(options: PolicyProgramOptions<F32, U32>): PolicyProgramBuilder<F32, U32> {
  const semanticF32 = textShaperAbi.engine.semanticF32Fields;
  const semanticU32 = textShaperAbi.engine.semanticU32Fields;
  const bindingF32Names = options.bindingF32 ?? [];
  const bindingU32Names = options.bindingU32 ?? [];
  const uniqueNames = new Set([...bindingF32Names, ...bindingU32Names]);
  if (uniqueNames.size !== bindingF32Names.length + bindingU32Names.length) {
    throw new TypeError('policy binding field names must be unique');
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
  const f32InputCount = 7 + (options.inverseFontSize === true ? 1 : 0) + bindingF32Names.length;
  const u32InputCount = 2 + bindingU32Names.length;

  let nextF32 = 0;
  const loadF32 = (label: string): PolicyF32Value => f32Value({ kind: 'loadF32', input: nextF32++, label });
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
    transformIndex: u32Value({ kind: 'loadU32', input: 0, label: 'transformIndex' }),
    stableGlyphId: u32Value({ kind: 'loadU32', input: 1, label: 'stableGlyphId' }),
  };
  const binding: Record<string, PolicyF32Value | PolicyU32Value> = {};
  for (const name of bindingF32Names) binding[name] = loadF32(name);
  for (const [index, name] of bindingU32Names.entries()) {
    binding[name] = u32Value({ kind: 'loadU32', input: 2 + index, label: name });
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
        stores.push({ opcode, buffer: buffer.id, lane, node: nodeOf(value) });
      }
    },
    storeF32(buffer, lanes) {
      for (const [lane, value] of lanes.entries()) {
        stores.push({ opcode: opcodes.storeF32, buffer, lane, node: nodeOf(value) });
      }
    },
    storeU32(buffer, lanes) {
      for (const [lane, value] of lanes.entries()) {
        stores.push({ opcode: opcodes.storeU32, buffer, lane, node: nodeOf(value) });
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
      return { inputs, operations, f32InputCount, u32InputCount };
    },
  };
}

function f32Bits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}
