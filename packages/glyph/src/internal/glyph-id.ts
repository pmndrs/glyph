import { renderWireId } from './render-id.js';

const MAX_U32 = 0xffff_ffff;

interface NamedGlyphId {
  readonly canonical: string;
  permanent: boolean;
  scopeCount: number;
}

const namedIds = new Map<string, NamedGlyphId>();

const glyphIdKinds = new Set([
  'generic',
  'buffer',
  'codec',
  'font-binding',
  'font-stack',
  'planner',
  'material',
  'paragraph',
  'style',
  'flow-thread',
  'region',
  'exclusion',
  'inline-object',
  'resource',
] as const);

export type GlyphIdKind =
  | 'generic'
  | 'buffer'
  | 'codec'
  | 'font-binding'
  | 'font-stack'
  | 'planner'
  | 'material'
  | 'paragraph'
  | 'style'
  | 'flow-thread'
  | 'region'
  | 'exclusion'
  | 'inline-object'
  | 'resource';

declare const glyphIdBrand: unique symbol;

export type GlyphId<Kind extends GlyphIdKind = GlyphIdKind> = number & { readonly [glyphIdBrand]: Kind };
export type Id = GlyphId<'generic'>;
export type CodecBufferId = GlyphId<'buffer'>;
export type CodecHandle = GlyphId<'codec'>;
export type FontBindingHandle = GlyphId<'font-binding'>;
export type FontStackHandle = GlyphId<'font-stack'>;
export type PlannerHandle = GlyphId<'planner'>;
export type MaterialHandle = GlyphId<'material'>;
export type ParagraphId = GlyphId<'paragraph'>;
export type StyleId = GlyphId<'style'>;
export type FlowThreadId = GlyphId<'flow-thread'>;
export type RegionId = GlyphId<'region'>;
export type ExclusionId = GlyphId<'exclusion'>;
export type InlineObjectId = GlyphId<'inline-object'>;
export type ResourceHandle = GlyphId<'resource'>;

export interface HandleIdFactory {
  <const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind>;
  buffer(name: string): CodecBufferId;
  codec(name: string): CodecHandle;
  fontBinding(name: string): FontBindingHandle;
  fontStack(name: string): FontStackHandle;
  planner(name: string): PlannerHandle;
  material(name: string): MaterialHandle;
  paragraph(name: string): ParagraphId;
  style(name: string): StyleId;
  flowThread(name: string): FlowThreadId;
  region(name: string): RegionId;
  exclusion(name: string): ExclusionId;
  inlineObject(name: string): InlineObjectId;
  resourceHandle(name: string): ResourceHandle;
}

export class GlyphIdScope {
  readonly #keys = new Set<string>();
  #disposed = false;

  id<const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind> {
    if (this.#disposed) throw new Error('glyph ID scope has been disposed');
    const derived = deriveGlyphId(kind, name);
    const registered = registerGlyphId(derived, false);
    if (!this.#keys.has(derived.key)) {
      this.#keys.add(derived.key);
      registered.scopeCount += 1;
    }
    return derived.value;
  }

  retain<const Kind extends GlyphIdKind>(value: unknown, kind: Kind, label: string): boolean {
    if (this.#disposed) throw new Error('glyph ID scope has been disposed');
    const handle = assertGlyphId(value, kind, label);
    const key = `${kind}:${handle}`;
    if (this.#keys.has(key)) return false;
    const registered = namedIds.get(key);
    if (registered === undefined) throw new Error('glyph ID provenance disappeared during retention');
    this.#keys.add(key);
    registered.scopeCount += 1;
    return true;
  }

  release<const Kind extends GlyphIdKind>(value: GlyphId<Kind>, kind: Kind): void {
    const key = `${kind}:${value}`;
    if (!this.#keys.delete(key)) return;
    const registered = namedIds.get(key);
    if (registered === undefined || registered.scopeCount === 0) {
      throw new Error('glyph ID scope lost an owned registration');
    }
    registered.scopeCount -= 1;
    if (!registered.permanent && registered.scopeCount === 0) namedIds.delete(key);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let failure: unknown;
    for (const key of this.#keys) {
      const registered = namedIds.get(key);
      if (registered === undefined || registered.scopeCount === 0) {
        failure ??= new Error('glyph ID scope lost an owned registration');
        continue;
      }
      registered.scopeCount -= 1;
      if (!registered.permanent && registered.scopeCount === 0) namedIds.delete(key);
    }
    this.#keys.clear();
    if (failure !== undefined) throw failure;
  }
}

export function createHandleIdFactory(scope: GlyphIdScope, assertActive: () => void): HandleIdFactory {
  const mint = <const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind> => {
    assertActive();
    return scope.id(kind, name);
  };
  return Object.freeze(
    Object.assign(mint, {
      buffer: (name: string) => mint('buffer', name),
      codec: (name: string) => mint('codec', name),
      fontBinding: (name: string) => mint('font-binding', name),
      fontStack: (name: string) => mint('font-stack', name),
      planner: (name: string) => mint('planner', name),
      material: (name: string) => mint('material', name),
      paragraph: (name: string) => mint('paragraph', name),
      style: (name: string) => mint('style', name),
      flowThread: (name: string) => mint('flow-thread', name),
      region: (name: string) => mint('region', name),
      exclusion: (name: string) => mint('exclusion', name),
      inlineObject: (name: string) => mint('inline-object', name),
      resourceHandle: (name: string) => mint('resource', name),
    }),
  );
}

export function assertGlyphId<const Kind extends GlyphIdKind>(
  value: unknown,
  kind: Kind,
  label: string,
): GlyphId<Kind> {
  const source = kind === 'buffer' ? 'id.buffer(name)' : 'package-owned Glyph identity state';
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_U32) {
    throw new TypeError(`${label} must come from ${source}`);
  }
  if (!namedIds.has(`${kind}:${value as number}`)) {
    throw new TypeError(`${label} must come from ${source}`);
  }
  return value as GlyphId<Kind>;
}

interface DerivedGlyphId<Kind extends GlyphIdKind> {
  readonly canonical: string;
  readonly key: string;
  readonly value: GlyphId<Kind>;
}

function deriveGlyphId<const Kind extends GlyphIdKind>(kind: Kind, name: string): DerivedGlyphId<Kind> {
  if (typeof kind !== 'string' || !glyphIdKinds.has(kind)) throw new TypeError('glyph ID kind is not supported');
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('glyph ID name must be a nonempty string');
  const canonical = JSON.stringify(['glyph-id-v1', kind, name]);
  const hash = renderWireId(canonical);
  const value = (kind === 'buffer' ? (hash % 0xfffe) + 1 : hash) as GlyphId<Kind>;
  return { canonical, key: `${kind}:${value}`, value };
}

function registerGlyphId(derived: DerivedGlyphId<GlyphIdKind>, permanent: boolean): NamedGlyphId {
  const registered = namedIds.get(derived.key);
  if (registered !== undefined) {
    if (registered.canonical !== derived.canonical) {
      throw new TypeError(`glyph ID collision between ${registered.canonical} and ${derived.canonical}`);
    }
    if (permanent) registered.permanent = true;
    return registered;
  }
  const created = { canonical: derived.canonical, permanent, scopeCount: 0 };
  namedIds.set(derived.key, created);
  return created;
}

export function permanentGlyphId<const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind> {
  const derived = deriveGlyphId(kind, name);
  registerGlyphId(derived, true);
  return derived.value;
}
