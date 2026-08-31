import { createRoot } from '@react-three/fiber/webgpu';
import { createElement, Suspense, type ReactNode } from 'react';
import { WebGPURenderer } from 'three/webgpu';

import {
  GlyphInputStream,
  GlyphOutboundDispatcher,
  isGlyphSceneInput,
  type GlyphChannelMessage,
  type GlyphChannelTarget,
  type GlyphOutboundMessage,
  type GlyphSceneInput,
} from './glyph-channel';
import { advancePooledRoots } from './glyph-frame-scheduler';
import { GlyphRenderPool, type GlyphPoolSlot } from './glyph-render-pool';
import { beginGlyphRender, completeGlyphRender } from './glyph-render-readiness';

const RESIZE_SETTLE_MS = 120;
const STATS_INTERVAL_MS = 250;

export type GlyphRenderStats = Readonly<{
  active: number;
  idle: number;
  poolSize: number;
  poolLimit: number;
  frameMs: number;
  fps: number;
}>;

export type { GlyphSceneInput } from './glyph-channel';

export type GlyphSceneProps = {
  inputs: GlyphInputStream;
  onReady: () => void;
  scene: string;
};

type GlyphProxyHandle = HTMLElement & {
  bind(root: GlyphOffscreenRootElement): void;
  copy(surface: OffscreenCanvas | HTMLCanvasElement): void;
  rootId: string | undefined;
  scene: string;
  setActive(active: boolean): void;
};

type GlyphR3fRoot = ReturnType<typeof createRoot>;
type GlyphR3fStore = ReturnType<GlyphR3fRoot['render']>;

type GlyphRenderSlot = {
  pool: GlyphPoolSlot<GlyphProxyHandle>;
  surface: OffscreenCanvas | HTMLCanvasElement;
  r3f: GlyphR3fRoot;
  renderer: WebGPURenderer;
  store: GlyphR3fStore | undefined;
  proxy: GlyphProxyHandle | undefined;
  scene: string | undefined;
  inputs: GlyphInputStream;
  ready: boolean;
  resizing: boolean;
  resizeToken: number;
  renderToken: number;
};

const roots = new Map<string, GlyphOffscreenRootElement>();
let rootInstanceId = 0;

/**
 * Shared controller for a page's virtual explainer canvases.
 *
 * The custom element is the only DOM root. Internally it owns a bounded pool of R3F roots and
 * offscreen surfaces. Each slot has its own renderer and size-dependent attachments while all
 * WebGPU renderers share the first slot's GPUDevice. A single page RAF advances ready, visible slots.
 */
export abstract class GlyphOffscreenRootElement extends HTMLElement {
  static observedAttributes = ['id', 'max-slots', 'idle-ttl'];

  #pool = new GlyphRenderPool<GlyphProxyHandle>(2);
  #slots = new Map<number, GlyphRenderSlot>();
  #proxies = new Set<GlyphProxyHandle>();
  #visible = new Map<GlyphProxyHandle, number>();
  #sceneOverrides = new Map<GlyphProxyHandle, string>();
  #observer: IntersectionObserver | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;
  #retireTimer: ReturnType<typeof setTimeout> | undefined;
  #statsPanel: HTMLDivElement | undefined;
  #statsEnabled = false;
  #lastStatsAt = -Infinity;
  #previousTickAt = -Infinity;
  #frameMs = 0;
  #eventQueue: GlyphChannelMessage[] = [];
  #outbound = new GlyphOutboundDispatcher((messages) => this.#deliverOutbound(messages));
  #sequence = 0;
  #raf = 0;
  #started = false;
  #running = false;
  #lastFrame = -Infinity;
  #registeredId: string | undefined;
  #instanceId = `glyph-root-${++rootInstanceId}`;
  #gpuDevice: GPUDevice | undefined;
  #reconcilePending = false;
  #reconciling = false;
  #readyEventSent = false;

  protected abstract createScene(props: GlyphSceneProps): ReactNode;

  connectedCallback() {
    this.setAttribute('data-glyph-root', '');
    this.#pool = new GlyphRenderPool(this.#maxSlots());
    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const proxy = entry.target as GlyphProxyHandle;
        if (entry.isIntersecting) this.#visible.set(proxy, entry.intersectionRatio);
        else this.#visible.delete(proxy);
      }
      this.setAttribute('data-glyph-visible-count', String(this.#visible.size));
      this.#scheduleReconcile();
    });
    this.#register();
    this.#statsEnabled =
      this.hasAttribute('stats') || new URLSearchParams(window.location.search).get('stats') === 'true';
    this.#mountStatsPanel();
    window.addEventListener('keydown', this.#toggleStats);

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this);
    window.addEventListener('resize', this.#onWindowResize);
    this.#discover();
    this.#started = true;
    this.#scheduleReconcile();
  }

  disconnectedCallback() {
    this.#started = false;
    this.#running = false;
    cancelAnimationFrame(this.#raf);
    this.#observer?.disconnect();
    this.#resizeObserver?.disconnect();
    if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
    if (this.#retireTimer !== undefined) clearTimeout(this.#retireTimer);
    this.#resizeTimer = undefined;
    this.#retireTimer = undefined;
    this.removeAttribute('data-glyph-resizing');
    window.removeEventListener('resize', this.#onWindowResize);
    this.#statsPanel?.remove();
    this.#statsPanel = undefined;
    window.removeEventListener('keydown', this.#toggleStats);
    this.#outbound.dispose();
    const slots = [...this.#slots.values()];
    for (const slot of slots) slot.r3f.unmount();
    // R3F unregisters scheduler jobs after its deferred unmount cleanup. Dispose the
    // externally-device-backed renderers first, then let the primary renderer destroy
    // the device it created after every slot has released its own GPU resources.
    window.setTimeout(() => {
      for (const slot of slots.filter(({ pool }) => pool.index !== 0)) slot.renderer.dispose();
      slots.find(({ pool }) => pool.index === 0)?.renderer.dispose();
    }, 600);
    this.#slots.clear();
    this.#gpuDevice = undefined;
    this.#proxies.clear();
    this.#visible.clear();
    this.#sceneOverrides.clear();
    this.#readyEventSent = false;
    if (this.#registeredId) roots.delete(this.#registeredId);
    this.#registeredId = undefined;
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === 'id') this.#register();
    if (name === 'max-slots') this.#pool.setMax(this.#maxSlots());
    this.#scheduleReconcile();
  }

  /** Queue a scene change for a proxy, or the most visible proxy when no target is supplied. */
  setScene(scene: string, target: GlyphChannelTarget = 'root') {
    this.#outbound.publish({ type: 'scene', payload: { scene }, target });
  }

  /** Send input through the ordered page-local stream; adjacent pointer moves may be coalesced. */
  sendInput(input: GlyphSceneInput, target: GlyphChannelTarget = 'root') {
    this.#outbound.publish({ type: 'input', payload: input, target });
  }

  /** Publish a custom message to this root or one of its proxies on the same page. */
  postMessage<Payload>(type: string, payload: Payload, target: GlyphChannelTarget = 'all') {
    this.#outbound.publish({ type, payload, target });
  }

  register(proxy: GlyphProxyHandle) {
    if (!this.#proxies.has(proxy)) {
      this.#proxies.add(proxy);
      proxy.bind(this);
    }
    this.#observer?.observe(proxy);
    this.setAttribute('data-glyph-proxy-count', String(this.#proxies.size));
    this.#scheduleReconcile();
  }

  unregister(proxy: GlyphProxyHandle) {
    this.#proxies.delete(proxy);
    this.#visible.delete(proxy);
    this.#observer?.unobserve(proxy);
    this.#sceneOverrides.delete(proxy);
    this.setAttribute('data-glyph-proxy-count', String(this.#proxies.size));
    this.#scheduleReconcile();
  }

  /** Re-read a proxy's declarative scene after its data-scene attribute changes. */
  updateProxyScene(proxy: GlyphProxyHandle) {
    this.#sceneOverrides.delete(proxy);
    this.#scheduleReconcile();
  }

  #register() {
    if (this.#registeredId) roots.delete(this.#registeredId);
    if (!this.id) return;
    this.#registeredId = this.id;
    roots.set(this.id, this);
    window.dispatchEvent(new CustomEvent('glyph-root-ready', { detail: { id: this.id } }));
  }

  #discover() {
    for (const node of document.querySelectorAll('glyph-proxy')) {
      const proxy = node as GlyphProxyHandle;
      if (proxy.rootId === this.id) this.register(proxy);
    }
  }

  #maxSlots() {
    const raw = this.getAttribute('max-slots') ?? this.getAttribute('pool');
    if (!raw || raw === 'auto') return 2;
    return Math.max(1, Number.parseInt(raw, 10) || 1);
  }

  #idleTtl() {
    const raw = this.getAttribute('idle-ttl');
    return Math.max(0, Number.parseInt(raw ?? '30000', 10) || 0);
  }

  #rankVisible() {
    return [...this.#visible.entries()].sort((a, b) => b[1] - a[1]);
  }

  #sceneFor(proxy: GlyphProxyHandle) {
    return this.#sceneOverrides.get(proxy) ?? proxy.scene;
  }

  #scheduleReconcile() {
    if (!this.#started) return;
    this.#reconcilePending = true;
    if (this.#reconciling) return;
    void this.#reconcile();
  }

  async #reconcile() {
    this.#reconciling = true;
    while (this.#reconcilePending && this.isConnected) {
      this.#reconcilePending = false;
      await this.#reconcileVisible();
    }
    this.#reconciling = false;
  }

  async #reconcileVisible() {
    const now = performance.now();
    const assignments = this.#pool.reconcile(
      this.#rankVisible().map(([key, priority]) => ({ key, priority })),
      now,
    );
    const desired = new Map<GlyphProxyHandle, GlyphRenderSlot>();
    for (const assignment of assignments) {
      if (!assignment?.key) continue;
      let slot = this.#slots.get(assignment.index);
      if (!slot) {
        slot = await this.#createSlot(assignment);
        if (!slot) continue;
      }
      desired.set(assignment.key, slot);
    }

    for (const slot of this.#slots.values()) {
      if (slot.proxy && desired.get(slot.proxy) !== slot) this.#release(slot, now);
    }

    for (const [proxy, slot] of desired) {
      const isNewProxy = slot.proxy !== proxy;
      if (isNewProxy) {
        slot.proxy?.setActive(false);
        slot.proxy = proxy;
        slot.inputs.clear();
        proxy.setActive(false);
      }
      const scene = this.#sceneFor(proxy);
      if (isNewProxy || slot.scene !== scene) {
        this.#resizeSlot(slot);
        this.#render(slot, scene);
      } else if (slot.ready) {
        proxy.setActive(true);
      }
    }

    for (const proxy of this.#proxies) {
      if (!desired.has(proxy)) proxy.setActive(false);
    }
    this.#retireIdle(now);
    this.#updateDebugAttributes();
    this.#updateLoop();
  }

  async #createSlot(pool: GlyphPoolSlot<GlyphProxyHandle>) {
    const surface =
      typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const renderer = new WebGPURenderer({
      antialias: true,
      canvas: surface,
      ...(this.#gpuDevice ? { device: this.#gpuDevice } : {}),
    });
    const r3f = createRoot(surface);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    await r3f.configure({
      camera: { fov: 35, far: 100, near: 0.01, position: [0, 0, 7] },
      dpr,
      frameloop: 'never',
      orthographic: false,
      renderer,
      size: { height: 1, left: 0, top: 0, width: 1 },
      scene: { background: null },
    });

    const backend = renderer.backend as typeof renderer.backend & {
      device?: GPUDevice;
      isWebGPUBackend?: boolean;
    };
    if (!this.#gpuDevice && backend.isWebGPUBackend && backend.device) {
      this.#gpuDevice = backend.device;
    }

    if (!this.isConnected) {
      r3f.unmount();
      return undefined;
    }

    const slot: GlyphRenderSlot = {
      pool,
      r3f,
      renderer,
      surface,
      store: undefined,
      proxy: undefined,
      scene: undefined,
      inputs: new GlyphInputStream(),
      ready: false,
      resizing: false,
      resizeToken: 0,
      renderToken: 0,
    };
    this.#slots.set(pool.index, slot);
    this.setAttribute('data-glyph-slot-count', String(this.#slots.size));
    if (!this.#readyEventSent) {
      this.#readyEventSent = true;
      this.dispatchEvent(new CustomEvent('glyph-ready'));
    }
    return slot;
  }

  #release(slot: GlyphRenderSlot, now: number) {
    const proxy = slot.proxy;
    proxy?.setActive(false);
    slot.proxy = undefined;
    slot.scene = undefined;
    slot.inputs.clear();
    slot.ready = false;
    slot.resizing = false;
    slot.resizeToken += 1;
    slot.r3f.render(null);
    slot.store = undefined;
    if (proxy) this.#pool.release(proxy, now);
  }

  #retireIdle(now: number) {
    if (this.#retireTimer !== undefined) clearTimeout(this.#retireTimer);
    this.#retireTimer = undefined;
    const ttl = this.#idleTtl();
    const retired = this.#pool.retireIdle(now, ttl, [0]);
    for (const poolSlot of retired) {
      const slot = this.#slots.get(poolSlot.index);
      slot?.r3f.unmount();
      if (slot) window.setTimeout(() => slot.renderer.dispose(), 600);
      this.#slots.delete(poolSlot.index);
    }
    this.setAttribute('data-glyph-slot-count', String(this.#slots.size));
    const delay = this.#pool.nextRetirementDelay(now, ttl, [0]);
    if (delay !== undefined) {
      this.#retireTimer = setTimeout(
        () => {
          this.#retireTimer = undefined;
          this.#scheduleReconcile();
        },
        Math.ceil(delay) + 1,
      );
    }
  }

  #render(slot: GlyphRenderSlot, scene: string) {
    const token = beginGlyphRender(slot);
    slot.scene = scene;
    slot.proxy?.setActive(false);
    slot.store = slot.r3f.render(
      createElement(
        Suspense,
        { fallback: null },
        this.createScene({
          inputs: slot.inputs,
          onReady: () => this.#markReady(slot, token),
          scene,
        }),
      ),
    );
    this.#resizeSlot(slot);
    this.#updateDebugAttributes();
  }

  #markReady(slot: GlyphRenderSlot, token: number) {
    if (!completeGlyphRender(slot, token)) return;
    this.#updateLoop();
  }

  #resize() {
    this.setAttribute('data-glyph-resizing', '');
    if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
    this.#resizeTimer = setTimeout(() => {
      this.#resizeTimer = undefined;
      this.removeAttribute('data-glyph-resizing');
      if (!this.isConnected) return;
      for (const slot of this.#slots.values()) if (slot.proxy) this.#resizeSlot(slot);
    }, RESIZE_SETTLE_MS);
  }

  #onWindowResize = () => {
    this.#resize();
  };

  #resizeSlot(slot: GlyphRenderSlot) {
    const size = slot.proxy?.getBoundingClientRect();
    const width = Math.max(1, Math.round(size?.width ?? 640));
    const height = Math.max(1, Math.round(size?.height ?? 360));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    // Assigning either canvas dimension clears its presented frame, even when the
    // assigned number is unchanged. Preserve the bitmap during scene updates and
    // resize settling unless the backing dimensions genuinely changed.
    if (slot.surface.width === pixelWidth && slot.surface.height === pixelHeight) return;
    const token = ++slot.resizeToken;
    slot.resizing = true;
    slot.surface.width = pixelWidth;
    slot.surface.height = pixelHeight;
    void slot.r3f.configure({ dpr, frameloop: 'never', size: { height, left: 0, top: 0, width } }).finally(() => {
      if (token !== slot.resizeToken) return;
      slot.resizing = false;
      this.#updateLoop();
    });
  }

  #updateLoop() {
    const shouldRun =
      this.#eventQueue.length > 0 ||
      [...this.#slots.values()].some((slot) => slot.proxy && slot.ready && !slot.resizing);
    if (!shouldRun) {
      this.#running = false;
      cancelAnimationFrame(this.#raf);
      return;
    }
    if (this.#running) return;
    this.#running = true;
    this.#raf = requestAnimationFrame(this.#tick);
  }

  #tick = (timestamp: number) => {
    if (!this.#started) {
      this.#running = false;
      return;
    }
    this.#drainEvents();
    if (this.#previousTickAt !== -Infinity) {
      const elapsed = timestamp - this.#previousTickAt;
      this.#frameMs = this.#frameMs === 0 ? elapsed : this.#frameMs * 0.8 + elapsed * 0.2;
    }
    this.#previousTickAt = timestamp;
    if (timestamp - this.#lastFrame >= 1000 / 60 - 1) {
      this.#lastFrame = timestamp;
      const activeSlots = [...this.#slots.values()].filter(
        (slot): slot is GlyphRenderSlot & { store: GlyphR3fStore } =>
          slot.proxy !== undefined && slot.store !== undefined,
      );
      // Store advance is the global scheduler step in R3F WebGPU. One call advances
      // every mounted root even though each slot owns its canvas-sized renderer.
      advancePooledRoots(
        activeSlots.map((slot) => slot.store),
        timestamp,
      );
      for (const slot of activeSlots) {
        if (slot.ready && !slot.resizing) slot.proxy?.copy(slot.surface);
      }
    }
    this.#publishStats(timestamp);
    this.#running = false;
    this.#updateLoop();
  };

  #mountStatsPanel() {
    const panel = document.createElement('div');
    panel.setAttribute('data-glyph-stats', '');
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'top:0.75rem',
      'right:0.75rem',
      'min-width:12rem',
      'padding:0.65rem 0.75rem',
      'border:1px solid rgb(148 163 184 / 30%)',
      'border-radius:0.6rem',
      'background:rgb(3 7 18 / 88%)',
      'box-shadow:0 10px 30px rgb(0 0 0 / 35%)',
      'color:#dbeafe',
      'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
      'pointer-events:none',
      'white-space:pre',
      'backdrop-filter:blur(8px)',
    ].join(';');
    document.body.append(panel);
    this.#statsPanel = panel;
    this.#setStatsVisibility();
    this.#publishStats(performance.now(), true);
  }

  #toggleStats = (event: KeyboardEvent) => {
    if (event.code !== 'KeyG' || !event.altKey || !event.ctrlKey || !event.shiftKey || event.repeat) return;
    this.#statsEnabled = !this.#statsEnabled;
    this.#setStatsVisibility();
    if (this.#statsEnabled) this.#publishStats(performance.now(), true);
  };

  #setStatsVisibility() {
    if (this.#statsPanel) this.#statsPanel.hidden = !this.#statsEnabled;
  }

  #publishStats(timestamp: number, force = false) {
    if (!this.#statsEnabled || (!force && timestamp - this.#lastStatsAt < STATS_INTERVAL_MS)) return;
    this.#lastStatsAt = timestamp;
    const active = [...this.#slots.values()].filter((slot) => slot.proxy !== undefined).length;
    const stats: GlyphRenderStats = Object.freeze({
      active,
      idle: this.#slots.size - active,
      poolSize: this.#slots.size,
      poolLimit: this.#maxSlots(),
      frameMs: this.#frameMs,
      fps: this.#frameMs > 0 ? 1000 / this.#frameMs : 0,
    });
    this.dispatchEvent(
      new CustomEvent<GlyphRenderStats>('glyph-stats', { bubbles: true, composed: true, detail: stats }),
    );
    if (this.#statsPanel) {
      this.#statsPanel.textContent = [
        'glyph render pool',
        `active     ${stats.active}`,
        `idle       ${stats.idle}`,
        `pool       ${stats.poolSize}/${stats.poolLimit}`,
        `frame      ${stats.frameMs.toFixed(1)} ms`,
        `fps        ${stats.fps.toFixed(0)}`,
        '',
        'Ctrl+Alt+Shift+G to hide',
      ].join('\n');
    }
  }

  #drainEvents() {
    const events = this.#eventQueue.splice(0);
    for (const message of events) {
      if (message.type === 'input' && isGlyphSceneInput(message.payload)) {
        const targets = this.#targetProxies(message.target);
        for (const proxy of targets) {
          const slot = [...this.#slots.values()].find((candidate) => candidate.proxy === proxy);
          slot?.inputs.push(message.payload);
        }
      } else if (message.type === 'scene' && isGlyphSceneChange(message.payload)) {
        const targets = this.#targetProxies(message.target);
        const target = targets.find((proxy) => this.#visible.has(proxy)) ?? targets[0];
        if (target) {
          this.#sceneOverrides.set(target, message.payload.scene);
          const slot = [...this.#slots.values()].find((candidate) => candidate.proxy === target);
          if (slot) this.#render(slot, message.payload.scene);
        }
      } else {
        const detail = Object.freeze(message);
        this.dispatchEvent(new CustomEvent('glyph-message', { bubbles: true, composed: true, detail }));
        for (const proxy of this.#targetProxies(message.target)) {
          proxy.dispatchEvent(new CustomEvent('glyph-message', { detail }));
        }
      }
    }
  }

  #targetProxies(target: GlyphChannelTarget) {
    if (target === 'all') return [...this.#proxies];
    if (target === 'root') {
      const mostVisible = this.#rankVisible()[0]?.[0];
      return mostVisible === undefined ? [...this.#proxies].slice(0, 1) : [mostVisible];
    }
    if (target.rootId && target.rootId !== this.id) return [];
    if (target.proxyId) return [...this.#proxies].filter((proxy) => proxy.id === target.proxyId);
    return [...this.#proxies];
  }

  #deliverOutbound(messages: readonly GlyphOutboundMessage[]) {
    for (const message of messages) {
      const target =
        typeof message.target === 'object' && !message.target.rootId
          ? { ...message.target, rootId: this.id }
          : message.target;
      this.#eventQueue.push({
        channel: 'glyph',
        version: 1,
        sequence: ++this.#sequence,
        type: message.type,
        source: this.id || this.#instanceId,
        target,
        payload: message.payload,
        timestamp: performance.now(),
      });
    }
    this.#updateLoop();
  }

  #updateDebugAttributes() {
    const active = [...this.#slots.values()].filter((slot) => slot.proxy);
    this.setAttribute('data-glyph-active-count', String(active.length));
    this.setAttribute('data-glyph-pool-limit', String(this.#maxSlots()));
    if (active.length) {
      this.setAttribute('data-glyph-active-proxy', active[0]?.scene ?? 'default');
      this.setAttribute('data-glyph-scene', active.map((slot) => slot.scene ?? 'default').join(','));
    } else {
      this.removeAttribute('data-glyph-active-proxy');
      this.removeAttribute('data-glyph-scene');
    }
  }
}

function isGlyphSceneChange(value: unknown): value is { scene: string } {
  return typeof value === 'object' && value !== null && 'scene' in value && typeof value.scene === 'string';
}

export class GlyphProxyElement extends HTMLElement {
  static observedAttributes = ['root', 'data-scene'];

  #canvas: HTMLCanvasElement | undefined;
  #presenter: ImageBitmapRenderingContext | CanvasRenderingContext2D | undefined;
  #pendingCanvas: HTMLCanvasElement | undefined;
  #pendingPresenter: ImageBitmapRenderingContext | CanvasRenderingContext2D | undefined;
  #presented = false;
  #root: GlyphOffscreenRootElement | undefined;
  #resizeObserver: ResizeObserver | undefined;
  #resizeTimer: ReturnType<typeof setTimeout> | undefined;
  #onRootReady = () => this.#bind();

  get rootId() {
    return this.getAttribute('root') ?? this.closest('[data-glyph-root]')?.id;
  }

  get scene() {
    return this.getAttribute('data-scene') ?? 'default';
  }

  connectedCallback() {
    this.setAttribute('data-glyph-proxy', '');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'img');
    this.style.display = 'block';
    this.style.opacity = '0';
    this.style.transition = `opacity ${this.getAttribute('fade') ?? '180'}ms ease`;
    this.style.contain = 'layout paint';
    const declaredWidth = this.getAttribute('width');
    const declaredHeight = this.getAttribute('height');
    if (declaredWidth) this.style.width = declaredWidth;
    if (declaredHeight) this.style.height = declaredHeight;

    this.#canvas = this.querySelector('canvas') ?? document.createElement('canvas');
    styleProxyCanvas(this.#canvas);
    if (!this.#canvas.parentElement) this.append(this.#canvas);
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this);
    this.#resize();
    this.addEventListener('pointermove', this.#sendPointer);
    this.addEventListener('pointerdown', this.#sendPointerDown);
    this.addEventListener('pointerup', this.#sendPointerUp);
    this.addEventListener('pointercancel', this.#sendPointerUp);
    this.addEventListener('keydown', this.#sendKeyDown);
    if (
      !this.hasAttribute('tabindex') &&
      (this.getAttribute('role') === 'textbox' || this.getAttribute('role') === 'button')
    ) {
      this.tabIndex = 0;
    }
    window.addEventListener('glyph-root-ready', this.#onRootReady);
    this.#bind();
  }

  disconnectedCallback() {
    this.#root?.unregister(this);
    this.#root = undefined;
    this.#resizeObserver?.disconnect();
    if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
    this.#resizeTimer = undefined;
    this.removeEventListener('pointermove', this.#sendPointer);
    this.removeEventListener('pointerdown', this.#sendPointerDown);
    this.removeEventListener('pointerup', this.#sendPointerUp);
    this.removeEventListener('pointercancel', this.#sendPointerUp);
    this.removeEventListener('keydown', this.#sendKeyDown);
    window.removeEventListener('glyph-root-ready', this.#onRootReady);
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected) return;
    if (name === 'data-scene') this.#root?.updateProxyScene(this);
    this.#bind();
  }

  bind(root: GlyphOffscreenRootElement) {
    if (this.#root === root) return;
    this.#root?.unregister(this);
    this.#root = root;
  }

  setActive(active: boolean) {
    this.style.opacity = active ? '1' : '0';
  }

  copy(surface: OffscreenCanvas | HTMLCanvasElement) {
    const canvas = this.#pendingCanvas ?? this.#canvas;
    if (!canvas) return;
    const presenter = this.#pendingCanvas ? this.#pendingPresenter : this.#presenter;
    const resolved = presentSurface(canvas, presenter, surface);
    if (!resolved) return;
    if (this.#pendingCanvas === canvas) {
      this.#canvas?.replaceWith(canvas);
      this.#canvas = canvas;
      this.#presenter = resolved;
      this.#pendingCanvas = undefined;
      this.#pendingPresenter = undefined;
    } else {
      this.#presenter = resolved;
    }
    this.#presented = true;
    this.setActive(true);
  }

  #bind() {
    const root = this.rootId ? roots.get(this.rootId) : undefined;
    if (root) root.register(this);
    else if (this.#root) {
      this.#root.unregister(this);
      this.#root = undefined;
    }
  }

  #resize() {
    if (!this.#canvas) return;
    const rect = this.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (!this.#presented) {
      this.#resizeCanvas(width, height);
      return;
    }
    const target = this.#pendingCanvas ?? this.#canvas;
    if (target.width === width && target.height === height) return;
    if (this.#resizeTimer !== undefined) clearTimeout(this.#resizeTimer);
    this.#resizeTimer = setTimeout(() => {
      this.#resizeTimer = undefined;
      this.#resizeCanvas(width, height);
    }, RESIZE_SETTLE_MS);
  }

  #resizeCanvas(width: number, height: number) {
    if (!this.#canvas) return;
    if (!this.#presented) {
      this.#canvas.width = width;
      this.#canvas.height = height;
      this.#presenter = undefined;
      return;
    }
    const pending = document.createElement('canvas');
    pending.width = width;
    pending.height = height;
    styleProxyCanvas(pending);
    this.#pendingCanvas = pending;
    this.#pendingPresenter = undefined;
  }

  #sendPointer = (event: PointerEvent) => {
    const rect = this.getBoundingClientRect();
    this.#root?.sendInput(
      {
        type: 'pointermove',
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendPointerDown = (event: PointerEvent) => {
    this.focus({ preventScroll: true });
    this.setPointerCapture(event.pointerId);
    const rect = this.getBoundingClientRect();
    this.#root?.sendInput(
      {
        type: 'pointerdown',
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendPointerUp = (event: PointerEvent) => {
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    const rect = this.getBoundingClientRect();
    this.#root?.sendInput(
      {
        type: event.type,
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendKeyDown = (event: KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'Backspace', ' '].includes(event.key)) event.preventDefault();
    if (this.getAttribute('role') === 'button' && (event.key === 'Enter' || event.key === ' ')) {
      const rect = this.getBoundingClientRect();
      this.#root?.sendInput(
        { type: 'pointerdown', value: 'keyboard', x: rect.width / 2, y: rect.height / 2 },
        this.id ? { proxyId: this.id } : 'root',
      );
      return;
    }
    this.#root?.sendInput({ type: 'keydown', value: event.key }, this.id ? { proxyId: this.id } : 'root');
  };
}

function styleProxyCanvas(canvas: HTMLCanvasElement) {
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.height = '100%';
  canvas.style.width = '100%';
}

function presentSurface(
  canvas: HTMLCanvasElement,
  presenter: ImageBitmapRenderingContext | CanvasRenderingContext2D | undefined,
  surface: OffscreenCanvas | HTMLCanvasElement,
): ImageBitmapRenderingContext | CanvasRenderingContext2D | undefined {
  const transferable =
    typeof OffscreenCanvas === 'function' &&
    surface instanceof OffscreenCanvas &&
    typeof surface.transferToImageBitmap === 'function';
  const resolved =
    presenter ??
    (transferable ? canvas.getContext('bitmaprenderer') : null) ??
    canvas.getContext('2d', { alpha: true }) ??
    undefined;
  if (resolved === undefined) return undefined;
  if ('transferFromImageBitmap' in resolved && transferable) {
    resolved.transferFromImageBitmap(surface.transferToImageBitmap());
  } else if ('drawImage' in resolved) {
    resolved.imageSmoothingEnabled = false;
    resolved.drawImage(surface, 0, 0, canvas.width, canvas.height);
  }
  return resolved;
}

export class GlyphSceneControlElement extends HTMLElement {
  #root: GlyphOffscreenRootElement | undefined;
  #onRootReady = () => this.#bind();

  get rootId() {
    return this.getAttribute('root') ?? undefined;
  }

  get proxyId() {
    return this.getAttribute('proxy') ?? this.getAttribute('target') ?? undefined;
  }

  connectedCallback() {
    this.setAttribute('role', 'button');
    this.tabIndex = 0;
    this.addEventListener('click', this.#activate);
    this.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('glyph-root-ready', this.#onRootReady);
    this.#bind();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#activate);
    this.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('glyph-root-ready', this.#onRootReady);
  }

  #bind() {
    if (!this.rootId) return;
    const root = roots.get(this.rootId);
    if (root) this.#root = root;
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.#activate();
    }
  };

  #activate = () => {
    const scene = this.getAttribute('data-scene');
    const action = this.getAttribute('data-action');
    const target = this.proxyId ? { proxyId: this.proxyId } : 'root';
    if (scene) this.#root?.setScene(scene, target);
    this.#root?.sendInput({ type: 'control', value: action ?? scene ?? this.textContent ?? '' }, target);
    this.dispatchEvent(new CustomEvent('glyph-control', { bubbles: true, detail: { action, scene } }));
  };
}

export function defineGlyphRoot(tagName: string, element: CustomElementConstructor) {
  if (!customElements.get(tagName)) customElements.define(tagName, element);
}

if (!customElements.get('glyph-proxy')) customElements.define('glyph-proxy', GlyphProxyElement);
if (!customElements.get('glyph-scene-control')) {
  customElements.define('glyph-scene-control', GlyphSceneControlElement);
}
