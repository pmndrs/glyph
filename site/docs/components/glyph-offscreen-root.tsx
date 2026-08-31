import { createRoot, useFrame } from '@react-three/fiber/webgpu';
import { createElement, Fragment, Suspense, type ReactNode } from 'react';
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
import {
  largestGlyphSurface,
  proxyPointToVirtualFrame,
  type GlyphPoint,
  type GlyphSurfaceSize,
} from './glyph-shared-surface';

const RESIZE_SETTLE_MS = 120;
const STATS_INTERVAL_MS = 250;

export type GlyphRenderStats = Readonly<{
  active: number;
  idle: number;
  poolSize: number;
  poolLimit: number;
  copyMs: number;
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
  copy(surface: OffscreenCanvas | HTMLCanvasElement, frame: GlyphSurfaceSize, opaque: boolean): void;
  releaseFrame(): void;
  rootId: string | undefined;
  scene: string;
  setActive(active: boolean): void;
};

type GlyphR3fRoot = ReturnType<typeof createRoot>;
type GlyphR3fStore = ReturnType<GlyphR3fRoot['render']>;
type GlyphPresenter = CanvasRenderingContext2D | ImageBitmapRenderingContext;
type GlyphPresentationState = Readonly<{
  camera: Parameters<WebGPURenderer['render']>[1];
  scene: Parameters<WebGPURenderer['render']>[0];
}>;

type GlyphRenderSlot = {
  pool: GlyphPoolSlot<GlyphProxyHandle>;
  r3f: GlyphR3fRoot;
  store: GlyphR3fStore | undefined;
  proxy: GlyphProxyHandle | undefined;
  scene: string | undefined;
  inputs: GlyphInputStream;
  ready: boolean;
  resizing: boolean;
  resizeToken: number;
  renderToken: number;
  size: GlyphSurfaceSize;
};

const roots = new Map<string, GlyphOffscreenRootElement>();
let rootInstanceId = 0;

function GlyphSlotPresenter({ present }: { present: (state: GlyphPresentationState) => void }) {
  useFrame((state) => present(state), { phase: 'render' });
  return null;
}

/**
 * Shared controller for a page's virtual explainer canvases.
 *
 * The custom element is the only DOM root. Internally it owns a bounded pool of logical R3F roots.
 * Every root shares one renderer, one offscreen surface, and therefore one
 * WebGPU device or WebGL context. A single page RAF advances all ready, visible roots; each root is
 * rendered and copied before the following root can overwrite the shared surface. Every logical
 * root uses one page-level virtual frame; each proxy is a centered HTML clipping window over it.
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
  #copyMs = 0;
  #eventQueue: GlyphChannelMessage[] = [];
  #outbound = new GlyphOutboundDispatcher((messages) => this.#deliverOutbound(messages));
  #sequence = 0;
  #raf = 0;
  #started = false;
  #running = false;
  #lastFrame = -Infinity;
  #registeredId: string | undefined;
  #instanceId = `glyph-root-${++rootInstanceId}`;
  #renderer: WebGPURenderer | undefined;
  #surface: OffscreenCanvas | HTMLCanvasElement | undefined;
  #frameSize: GlyphSurfaceSize = { dpr: 1, height: 1, width: 1 };
  #frameSizeDirty = true;
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
    // R3F unregisters scheduler jobs after its deferred unmount cleanup. All logical roots
    // share this renderer, so dispose it once after every scene has released its resources.
    const renderer = this.#renderer;
    window.setTimeout(() => {
      renderer?.dispose();
    }, 600);
    this.#slots.clear();
    this.#renderer = undefined;
    this.#surface = undefined;
    this.#frameSize = { dpr: 1, height: 1, width: 1 };
    this.#frameSizeDirty = true;
    for (const proxy of this.#proxies) proxy.releaseFrame();
    this.#proxies.clear();
    this.#visible.clear();
    this.#sceneOverrides.clear();
    this.#copyMs = 0;
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

  /** Map a proxy-local point into the centered page-level virtual frame. */
  mapProxyPoint(proxy: GlyphProxyHandle, point: GlyphPoint): GlyphPoint {
    const rect = proxy.getBoundingClientRect();
    return proxyPointToVirtualFrame(this.#frameSize, rect, point);
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
    this.#frameSizeDirty = true;
    this.setAttribute('data-glyph-proxy-count', String(this.#proxies.size));
    this.#scheduleReconcile();
  }

  unregister(proxy: GlyphProxyHandle) {
    this.#proxies.delete(proxy);
    this.#visible.delete(proxy);
    this.#observer?.unobserve(proxy);
    this.#sceneOverrides.delete(proxy);
    this.#frameSizeDirty = true;
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
    this.#refreshVirtualFrame();
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
        this.#render(slot, scene);
      } else if (slot.ready) {
        proxy.setActive(true);
      }
    }

    for (const proxy of this.#proxies) {
      if (!desired.has(proxy)) proxy.releaseFrame();
    }
    this.#retireIdle(now);
    this.#updateDebugAttributes();
    this.#updateLoop();
  }

  async #createSlot(pool: GlyphPoolSlot<GlyphProxyHandle>) {
    this.#refreshVirtualFrame();
    const rootSurface =
      typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const ownsRenderer = this.#renderer === undefined;
    if (ownsRenderer) {
      this.#surface = rootSurface;
      this.#renderer = new WebGPURenderer({
        alpha: !this.hasAttribute('opaque'),
        antialias: true,
        canvas: rootSurface,
        forceWebGL:
          this.hasAttribute('force-webgl') || new URLSearchParams(window.location.search).get('renderer') === 'webgl',
      });
    }
    const renderer = this.#renderer;
    if (!renderer) return undefined;
    const r3f = createRoot(rootSurface);
    const { dpr, height, width } = this.#frameSize;
    await r3f.configure({
      camera: { fov: 35, far: 100, near: 0.01, position: [0, 0, 7] },
      dpr,
      frameloop: 'never',
      orthographic: false,
      renderer,
      size: { height, left: 0, top: 0, width },
      scene: { background: null },
    });

    const backend = renderer.backend as typeof renderer.backend & { isWebGPUBackend?: boolean };
    this.setAttribute('data-glyph-backend', backend.isWebGPUBackend ? 'webgpu' : 'webgl');

    if (!this.isConnected) {
      r3f.unmount();
      if (ownsRenderer) renderer.dispose();
      return undefined;
    }

    const slot: GlyphRenderSlot = {
      pool,
      r3f,
      store: undefined,
      proxy: undefined,
      scene: undefined,
      inputs: new GlyphInputStream(),
      ready: false,
      resizing: false,
      resizeToken: 0,
      renderToken: 0,
      size: this.#frameSize,
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
    proxy?.releaseFrame();
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
        Fragment,
        null,
        createElement(GlyphSlotPresenter, { present: (state) => this.#presentSlot(slot, state) }),
        createElement(
          Suspense,
          { fallback: null },
          this.createScene({
            inputs: slot.inputs,
            onReady: () => this.#markReady(slot, token),
            scene,
          }),
        ),
      ),
    );
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
      this.#frameSizeDirty = true;
      this.#refreshVirtualFrame();
    }, RESIZE_SETTLE_MS);
  }

  #onWindowResize = () => {
    this.#resize();
  };

  #measureVirtualFrame() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return largestGlyphSurface(
      [...this.#proxies].map((proxy) => {
        const rect = proxy.getBoundingClientRect();
        return {
          dpr,
          height: Math.max(1, Math.round(rect.height)),
          width: Math.max(1, Math.round(rect.width)),
        };
      }),
    );
  }

  #configureSlot(slot: GlyphRenderSlot, size: GlyphSurfaceSize) {
    if (slot.size.width === size.width && slot.size.height === size.height && slot.size.dpr === size.dpr) return;
    slot.size = size;
    const token = ++slot.resizeToken;
    slot.resizing = true;
    void slot.r3f
      .configure({
        dpr: size.dpr,
        frameloop: 'never',
        size: { height: size.height, left: 0, top: 0, width: size.width },
      })
      .finally(() => {
        if (token !== slot.resizeToken) return;
        slot.resizing = false;
        this.#updateLoop();
      });
  }

  #refreshVirtualFrame() {
    if (!this.#frameSizeDirty) return;
    const next = this.#measureVirtualFrame();
    if (
      this.#frameSize.width === next.width &&
      this.#frameSize.height === next.height &&
      this.#frameSize.dpr === next.dpr
    ) {
      this.#frameSizeDirty = false;
      return;
    }
    this.#frameSize = next;
    this.#frameSizeDirty = false;
    this.#renderer?.setDrawingBufferSize(next.width, next.height, next.dpr);
    for (const slot of this.#slots.values()) this.#configureSlot(slot, next);
    this.setAttribute('data-glyph-frame', `${next.width}x${next.height}@${next.dpr}`);
  }

  #presentSlot(slot: GlyphRenderSlot, state: GlyphPresentationState) {
    const renderer = this.#renderer;
    const surface = this.#surface;
    const proxy = slot.proxy;
    if (!renderer || !surface || !proxy || !slot.ready || slot.resizing) return;
    renderer.setViewport(0, 0, this.#frameSize.width, this.#frameSize.height);
    renderer.render(state.scene, state.camera);
    const copyStartedAt = performance.now();
    proxy.copy(surface, this.#frameSize, this.hasAttribute('opaque'));
    const copyElapsed = performance.now() - copyStartedAt;
    this.#copyMs = this.#copyMs === 0 ? copyElapsed : this.#copyMs * 0.8 + copyElapsed * 0.2;
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
      this.#refreshVirtualFrame();
      // One global scheduler step updates every logical root. Each root owns a render-phase
      // presenter which renders and copies immediately, before the next root overwrites the host.
      advancePooledRoots(
        activeSlots.map((slot) => slot.store),
        timestamp,
      );
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
      copyMs: this.#copyMs,
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
        `copy       ${stats.copyMs.toFixed(2)} ms`,
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
  #presenter: GlyphPresenter | undefined;
  #root: GlyphOffscreenRootElement | undefined;
  #onRootReady = () => this.#bind();
  #onFadeOut = (event: TransitionEvent) => {
    if (event.target !== this || event.propertyName !== 'opacity' || this.style.opacity !== '0') return;
    this.#clearFrame();
  };

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
    this.style.position = 'relative';
    this.style.overflow = 'hidden';
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
    this.removeEventListener('pointermove', this.#sendPointer);
    this.removeEventListener('pointerdown', this.#sendPointerDown);
    this.removeEventListener('pointerup', this.#sendPointerUp);
    this.removeEventListener('pointercancel', this.#sendPointerUp);
    this.removeEventListener('keydown', this.#sendKeyDown);
    this.removeEventListener('transitionend', this.#onFadeOut);
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
    if (active) this.removeEventListener('transitionend', this.#onFadeOut);
    this.style.opacity = active ? '1' : '0';
  }

  releaseFrame() {
    this.removeEventListener('transitionend', this.#onFadeOut);
    this.setActive(false);
    if (getComputedStyle(this).opacity === '0') this.#clearFrame();
    else this.addEventListener('transitionend', this.#onFadeOut);
  }

  copy(surface: OffscreenCanvas | HTMLCanvasElement, frame: GlyphSurfaceSize, opaque: boolean) {
    const canvas = this.#canvas;
    if (!canvas) return;
    const resolved = presentSurface(canvas, this.#presenter, surface, frame, opaque);
    if (!resolved) return;
    this.#presenter = resolved;
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

  #clearFrame() {
    const canvas = this.#canvas;
    if (!canvas) return;
    if (canvas.width === 1 && canvas.height === 1) return;
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.width = '1px';
    canvas.style.height = '1px';
  }

  #sendPointer = (event: PointerEvent) => {
    const rect = this.getBoundingClientRect();
    const point = this.#root?.mapProxyPoint(this, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    this.#root?.sendInput(
      {
        type: 'pointermove',
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: point?.x ?? event.clientX - rect.left,
        y: point?.y ?? event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendPointerDown = (event: PointerEvent) => {
    this.focus({ preventScroll: true });
    this.setPointerCapture(event.pointerId);
    const rect = this.getBoundingClientRect();
    const point = this.#root?.mapProxyPoint(this, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    this.#root?.sendInput(
      {
        type: 'pointerdown',
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: point?.x ?? event.clientX - rect.left,
        y: point?.y ?? event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendPointerUp = (event: PointerEvent) => {
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    const rect = this.getBoundingClientRect();
    const point = this.#root?.mapProxyPoint(this, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
    this.#root?.sendInput(
      {
        type: event.type,
        buttons: event.buttons,
        pointerId: event.pointerId,
        value: event.pointerType,
        x: point?.x ?? event.clientX - rect.left,
        y: point?.y ?? event.clientY - rect.top,
      },
      this.id ? { proxyId: this.id } : 'root',
    );
  };

  #sendKeyDown = (event: KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'Backspace', ' '].includes(event.key)) event.preventDefault();
    if (this.getAttribute('role') === 'button' && (event.key === 'Enter' || event.key === ' ')) {
      const rect = this.getBoundingClientRect();
      const point = this.#root?.mapProxyPoint(this, { x: rect.width / 2, y: rect.height / 2 });
      this.#root?.sendInput(
        {
          type: 'pointerdown',
          value: 'keyboard',
          x: point?.x ?? rect.width / 2,
          y: point?.y ?? rect.height / 2,
        },
        this.id ? { proxyId: this.id } : 'root',
      );
      return;
    }
    this.#root?.sendInput({ type: 'keydown', value: event.key }, this.id ? { proxyId: this.id } : 'root');
  };
}

function styleProxyCanvas(canvas: HTMLCanvasElement) {
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.position = 'absolute';
  canvas.style.left = '50%';
  canvas.style.top = '50%';
  canvas.style.display = 'block';
  canvas.style.maxWidth = 'none';
  canvas.style.transform = 'translate(-50%, -50%)';
}

function presentSurface(
  canvas: HTMLCanvasElement,
  presenter: GlyphPresenter | undefined,
  surface: OffscreenCanvas | HTMLCanvasElement,
  frame: GlyphSurfaceSize,
  opaque: boolean,
): GlyphPresenter | undefined {
  const transferable =
    typeof OffscreenCanvas === 'function' &&
    surface instanceof OffscreenCanvas &&
    typeof surface.transferToImageBitmap === 'function';
  const pixelWidth = Math.max(1, Math.round(frame.width * frame.dpr));
  const pixelHeight = Math.max(1, Math.round(frame.height * frame.dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  canvas.style.width = `${frame.width}px`;
  canvas.style.height = `${frame.height}px`;

  // Every proxy consumes the same complete frame. The bitmap-renderer path transfers
  // ownership directly; HTML performs the centered crop without another pixel blit.
  const resolved =
    presenter ??
    (transferable
      ? (canvas.getContext('bitmaprenderer', { alpha: !opaque }) ?? undefined)
      : (canvas.getContext('2d', { alpha: !opaque }) ?? undefined));
  if (resolved === undefined) return undefined;
  if (transferable && 'transferFromImageBitmap' in resolved) {
    resolved.transferFromImageBitmap(surface.transferToImageBitmap());
  } else if ('drawImage' in resolved) {
    resolved.imageSmoothingEnabled = false;
    if (transferable) {
      const bitmap = surface.transferToImageBitmap();
      resolved.drawImage(bitmap, 0, 0);
      bitmap.close();
    } else {
      resolved.drawImage(surface, 0, 0);
    }
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
