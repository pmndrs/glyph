import type { LoadedFont } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import type { TextRuntime } from '../text-runtime.js';
import { firstPartyFontBindingBytes } from '../internal/font-binding-wire.js';
import { firstPartyThreeRenderPolicyBytes } from '../internal/render-policy-wire.js';
import { TextEngineHost, type TextEngineSession, type TextEngineSessionOptions } from '../internal/text-engine-host.js';

const POLICY_HANDLE = 1;
const MAX_U32 = 0xffff_ffff;
const coordinators = new WeakMap<TextRuntime, ThreeTextEngineCoordinator>();

export interface ThreeTextEngineStackLease {
  readonly handle: number;
  release(): void;
}

interface RetainedStack {
  readonly handle: number;
  references: number;
}

/** Three-owned cold registrations shared by every text batch using one renderer-neutral runtime. */
export class ThreeTextEngineCoordinator {
  readonly host: TextEngineHost;
  readonly #bindingHandles = new WeakMap<LoadedFont<AnyRasterTechnique>, number>();
  readonly #stacks = new Map<string, RetainedStack>();
  #nextBindingHandle = 1;
  #nextStackHandle = 1;
  #nextSessionHandle = 1;
  #disposed = false;

  constructor(runtime: Pick<TextRuntime, 'shaper'>) {
    this.host = new TextEngineHost(runtime.shaper);
    this.host.registerPolicy(POLICY_HANDLE, firstPartyThreeRenderPolicyBytes(this.host.wireIdentities));
  }

  get policyHandle(): number {
    return POLICY_HANDLE;
  }

  acquireFontStack(
    fonts: readonly [LoadedFont<AnyRasterTechnique>, ...LoadedFont<AnyRasterTechnique>[]],
  ): ThreeTextEngineStackLease {
    this.#assertActive();
    const bindingHandles = fonts.map((font) => this.#bindingHandle(font));
    const key = bindingHandles.join(',');
    let retained = this.#stacks.get(key);
    if (retained === undefined) {
      retained = { handle: this.#allocateStackHandle(), references: 0 };
      this.host.registerFontStack(retained.handle, bindingHandles);
      this.#stacks.set(key, retained);
    }
    retained.references += 1;
    let released = false;
    return {
      handle: retained.handle,
      release: () => {
        if (released) return;
        released = true;
        retained.references -= 1;
        if (retained.references !== 0) return;
        this.#stacks.delete(key);
        this.host.disposeFontStack(retained.handle);
      },
    };
  }

  createSession(options: Omit<TextEngineSessionOptions, 'handle'>): TextEngineSession {
    this.#assertActive();
    return this.host.createSession({ ...options, handle: this.#allocateSessionHandle() });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.host.dispose();
    this.#stacks.clear();
    this.#disposed = true;
  }

  #bindingHandle(font: LoadedFont<AnyRasterTechnique>): number {
    if (font.disposed) throw new TypeError('cannot register a disposed loaded font with the Three text engine');
    const existing = this.#bindingHandles.get(font);
    if (existing !== undefined) return existing;
    const handle = this.#allocateBindingHandle();
    this.host.registerFontBinding(handle, font.font.handle, firstPartyFontBindingBytes(font, this.host.wireIdentities));
    this.#bindingHandles.set(font, handle);
    return handle;
  }

  #allocateBindingHandle(): number {
    return allocateHandle(this.#nextBindingHandle, (next) => (this.#nextBindingHandle = next), 'font binding');
  }

  #allocateStackHandle(): number {
    return allocateHandle(this.#nextStackHandle, (next) => (this.#nextStackHandle = next), 'font stack');
  }

  #allocateSessionHandle(): number {
    return allocateHandle(this.#nextSessionHandle, (next) => (this.#nextSessionHandle = next), 'text session');
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three text engine coordinator is disposed');
  }
}

/** Resolve the lazy Three-owned coordinator without pulling renderer policies into the core runtime graph. */
export function threeTextEngineCoordinator(runtime: TextRuntime): ThreeTextEngineCoordinator {
  let coordinator = coordinators.get(runtime);
  if (coordinator === undefined) {
    coordinator = new ThreeTextEngineCoordinator(runtime);
    coordinators.set(runtime, coordinator);
  }
  return coordinator;
}

function allocateHandle(current: number, setNext: (next: number) => void, label: string): number {
  if (!Number.isSafeInteger(current) || current <= 0 || current > MAX_U32) {
    throw new RangeError(`${label} handles are exhausted`);
  }
  setNext(current === MAX_U32 ? MAX_U32 + 1 : current + 1);
  return current;
}
