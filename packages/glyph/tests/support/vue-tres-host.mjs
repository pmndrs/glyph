/**
 * Node host for TresJS lifecycle tests. happy-dom supplies the DOM `TresCanvas` renders into; a stub renderer
 * without `isRenderer` skips GPU initialization so Tres starts its loop immediately. Tests assert lifecycle
 * accounting, never frames.
 */
import { Window } from 'happy-dom';

const window = new Window({ width: 640, height: 480 });

for (const key of [
  'HTMLElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'HTMLCanvasElement',
  'ResizeObserver',
  'MutationObserver',
  'SVGElement',
  'Text',
  'Comment',
  'DocumentFragment',
  'ShadowRoot',
  'navigator',
  'matchMedia',
  'getComputedStyle',
]) {
  if (globalThis[key] !== undefined || window[key] === undefined) continue;
  globalThis[key] = typeof window[key] === 'function' && /^[a-z]/.test(key) ? window[key].bind(window) : window[key];
}
globalThis.window = window;
globalThis.document = window.document;
globalThis.self = globalThis;
// Tres drives its loop with vueuse's rAF; a timer-backed shim keeps the loop alive without a compositor.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

const { createApp, defineComponent, h, nextTick, onErrorCaptured, onMounted } = await import('vue');
const { TresCanvas, useTresContext } = await import('@tresjs/core');

function stubRenderer(setup) {
  const canvas = setup.canvas.value ?? setup.canvas;
  return {
    domElement: canvas,
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: 'srgb',
    renders: 0,
    render() {
      this.renders += 1;
    },
    setSize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    setPixelRatio() {},
    setClearColor() {},
    dispose() {},
  };
}

/**
 * Mount `children` inside one TresCanvas. `children` is a render function; it runs inside the canvas so it may
 * use Glyph and Tres composables. Returns the Tres context and an `unmount` that flushes Vue's scheduler.
 *
 * Tres renders the canvas subtree through its own renderer with a default app context, so the outer
 * `app.config.errorHandler` never sees errors raised there. A probe component inside that subtree captures them
 * instead; a setup or render error rejects the mount, and later errors accumulate on `errors`.
 */
export async function mountTres(children, { renderMode = 'on-demand' } = {}) {
  let context;
  const captured = [];
  const settled = Promise.withResolvers();
  const Probe = defineComponent({
    setup() {
      context = useTresContext();
      onMounted(() => settled.resolve());
      onErrorCaptured((error) => {
        captured.push(error);
        settled.resolve();
        return false;
      });
      return children;
    },
  });
  const Root = defineComponent({
    setup() {
      return () => h(TresCanvas, { renderer: stubRenderer, renderMode, windowSize: true }, { default: () => h(Probe) });
    },
  });
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const app = createApp(Root);
  app.config.errorHandler = (error) => {
    captured.push(error);
    settled.resolve();
  };
  const unmount = async () => {
    app.unmount();
    container.remove();
    await nextTick();
    // Default-root release is deferred one microtask so sibling unmounts coalesce; give it that turn.
    await Promise.resolve();
  };
  app.mount(container);
  await settled.promise;
  await nextTick();
  if (captured.length !== 0) {
    await unmount();
    throw captured[0];
  }
  return {
    app,
    context,
    get scene() {
      return context.scene.value;
    },
    errors: captured,
    unmount,
  };
}

export { nextTick };
