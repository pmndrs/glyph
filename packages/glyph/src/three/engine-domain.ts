import type * as THREE from 'three/webgpu';

import type { Font } from '../font.js';
import {
  immutableFontSelectionFonts,
  immutableFontVariantIdentity,
  observeImmutableFontVariantRelease,
  type FontSelection,
} from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { createGlyphEngine, type GlyphEngine } from '../glyph-engine.js';
import { ThreeTextEngineCoordinator } from './engine-coordinator.js';

interface ReadyThreeEngineDomain {
  readonly glyphEngine: GlyphEngine;
  readonly coordinator: ThreeTextEngineCoordinator;
}

interface ThreeEngineDomain {
  ready: Promise<ReadyThreeEngineDomain>;
  value: ReadyThreeEngineDomain | undefined;
  loaderCount: number;
  fontCount: number;
  leaseCount: number;
  disposed: boolean;
}

export interface ThreeEngineDomainLease {
  readonly coordinator: ThreeTextEngineCoordinator;
  retain(): ThreeEngineDomainLease;
  dispose(): void;
}

let sharedDomain: WeakRef<ThreeEngineDomain> | undefined;
const fontDomains = new WeakMap<object, ThreeEngineDomain>();

/** @internal Deterministic lifecycle evidence for package tests. */
export function threeEngineDomainReport(): Readonly<{
  active: boolean;
  loaders: number;
  fonts: number;
  leases: number;
}> {
  const domain = sharedDomain?.deref();
  return domain === undefined || domain.disposed
    ? { active: false, loaders: 0, fonts: 0, leases: 0 }
    : { active: true, loaders: domain.loaderCount, fonts: domain.fontCount, leases: domain.leaseCount };
}

/** @internal Deterministic evidence for coordinator-shared atlas/page lifetime. */
export function threeSharedRenderResourceCount(): number {
  const domain = sharedDomain?.deref();
  return domain === undefined || domain.disposed || domain.value === undefined
    ? 0
    : domain.value.coordinator.sharedRenderResourceCount;
}

export function acquireThreeLoaderDomain(manager: THREE.LoadingManager): Readonly<{
  readonly ready: Promise<void>;
  associate(font: Font<AnyRasterTechnique>): void;
  dispose(): void;
}> {
  void manager;
  let domain = sharedDomain?.deref();
  if (domain === undefined || domain.disposed) {
    domain = createDomain();
    sharedDomain = new WeakRef(domain);
  }
  domain.loaderCount += 1;
  let disposed = false;
  const retained = domain;
  return Object.freeze({
    ready: retained.ready.then(() => undefined),
    associate(font) {
      if (disposed) throw new Error('Three font-loader domain lease has been disposed');
      associateFont(retained, font);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retained.loaderCount -= 1;
      maybeDisposeDomain(retained);
    },
  });
}

export function acquireThreeTextDomain(
  selection: FontSelection<AnyRasterTechnique> | readonly FontSelection<AnyRasterTechnique>[],
): ThreeEngineDomainLease {
  const selections = Array.isArray(selection) ? selection : [selection];
  const fonts = selections.flatMap((entry) => immutableFontSelectionFonts(entry));
  let domain: ThreeEngineDomain | undefined;
  for (const font of fonts) {
    const candidate = fontDomains.get(immutableFontVariantIdentity(font));
    if (candidate === undefined || candidate.disposed || candidate.value === undefined) {
      throw new TypeError('Three fonts must be initialized by FontLoader before constructing Text');
    }
    if (domain !== undefined && candidate !== domain) {
      throw new TypeError('one Three text selection cannot span different Three engine domains');
    }
    domain = candidate;
  }
  if (domain === undefined || domain.value === undefined) throw new Error('Three text selection has no engine domain');
  return retainDomain(domain);
}

function retainDomain(domain: ThreeEngineDomain): ThreeEngineDomainLease {
  if (domain.disposed || domain.value === undefined) throw new Error('Three engine domain is not ready');
  domain.leaseCount += 1;
  let disposed = false;
  return Object.freeze({
    coordinator: domain.value.coordinator,
    retain() {
      if (disposed) throw new Error('Three engine domain lease has been disposed');
      return retainDomain(domain);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      domain.leaseCount -= 1;
      maybeDisposeDomain(domain);
    },
  });
}

function createDomain(): ThreeEngineDomain {
  const domain: ThreeEngineDomain = {
    ready: undefined as never,
    value: undefined,
    loaderCount: 0,
    fontCount: 0,
    leaseCount: 0,
    disposed: false,
  };
  domain.ready = createGlyphEngine().then((glyphEngine) => {
    if (domain.disposed) {
      glyphEngine.dispose();
      throw new Error('Three engine domain was disposed during initialization');
    }
    let coordinator: ThreeTextEngineCoordinator;
    try {
      coordinator = new ThreeTextEngineCoordinator(glyphEngine);
    } catch (error) {
      glyphEngine.dispose();
      throw error;
    }
    const value = Object.freeze({ glyphEngine, coordinator });
    domain.value = value;
    return value;
  });
  void domain.ready.catch(() => {
    if (sharedDomain?.deref() === domain) sharedDomain = undefined;
  });
  return domain;
}

function associateFont(domain: ThreeEngineDomain, font: Font<AnyRasterTechnique>): void {
  if (domain.disposed || domain.value === undefined) throw new Error('Three engine domain is not ready');
  const identity = immutableFontVariantIdentity(font);
  const existing = fontDomains.get(identity);
  if (existing !== undefined) {
    if (existing !== domain) throw new TypeError('font variant is already initialized for another Three engine domain');
    return;
  }
  fontDomains.set(identity, domain);
  domain.fontCount += 1;
  observeImmutableFontVariantRelease(font, () => {
    if (fontDomains.get(identity) !== domain) return;
    fontDomains.delete(identity);
    domain.fontCount -= 1;
    maybeDisposeDomain(domain);
  });
}

function maybeDisposeDomain(domain: ThreeEngineDomain): void {
  if (domain.disposed || domain.loaderCount !== 0 || domain.fontCount !== 0 || domain.leaseCount !== 0) return;
  domain.disposed = true;
  if (sharedDomain?.deref() === domain) sharedDomain = undefined;
  const value = domain.value;
  domain.value = undefined;
  if (value !== undefined) {
    value.coordinator.dispose();
    value.glyphEngine.dispose();
  }
}
