import type { CodecIdFactory, CodecProgramId, CodecResourceId, CodecTechniqueId } from '../config/codec.js';
import type { AnyRasterFormat, RasterResourceId } from '../config/raster-format.js';

const encoder = new TextEncoder();
const renderIdFactories = new WeakSet<object>();

export function renderWireId(identity: string): number {
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new TypeError('render identity must be a nonempty string');
  }
  let hash = 0x811c_9dc5;
  for (const byte of encoder.encode(identity)) hash = Math.imul(hash ^ byte, 0x0100_0193) >>> 0;
  if (hash === 0) throw new RangeError('render program family ID hashes to the reserved zero wire identity');
  return hash;
}

export class CodecIdScope implements CodecIdFactory {
  readonly #strings = new Map<number, string>();

  constructor() {
    renderIdFactories.add(this);
  }

  idFor(identity: string): number {
    const wireId = renderWireId(identity);
    const collision = this.#strings.get(wireId);
    if (collision !== undefined && collision !== identity) {
      throw new TypeError(`render wire identity collision between "${collision}" and "${identity}"`);
    }
    this.#strings.set(wireId, identity);
    return wireId;
  }

  technique(raster: AnyRasterFormat | string): CodecTechniqueId {
    return this.idFor(rasterIdentity(raster)) as CodecTechniqueId;
  }

  program(raster: AnyRasterFormat | string, namespace: string, variant = 'default'): CodecProgramId {
    return this.idFor(programWireKey(raster, namespace, variant)) as CodecProgramId;
  }

  resource(resource: RasterResourceId): CodecResourceId {
    return this.idFor(resource) as CodecResourceId;
  }
}

export function registerCodecIdFactory(value: CodecIdFactory): void {
  renderIdFactories.add(value);
}

export function assertCodecIdFactory(value: unknown, label: string): CodecIdFactory {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !renderIdFactories.has(value)) {
    throw new TypeError(`${label} must be the id utility or a handle-supplied CodecIdFactory`);
  }
  return value as CodecIdFactory;
}

function programWireKey(raster: AnyRasterFormat | string, namespace: string, variant: string): string {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new TypeError('render program namespace must be a nonempty string');
  }
  if (typeof variant !== 'string' || variant.length === 0) {
    throw new TypeError('render program variant must be a nonempty string');
  }
  return JSON.stringify(['glyph-program-v1', rasterIdentity(raster), namespace, variant]);
}

function rasterIdentity(raster: AnyRasterFormat | string): string {
  const identity = typeof raster === 'string' ? raster : raster?.id;
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new TypeError('render raster identity must be a nonempty string');
  }
  return identity;
}
