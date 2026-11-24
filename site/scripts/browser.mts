import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/** Shared by the site's browser checks: the preview server, a GPU-enabled Chromium, and page instrumentation. */
export const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface GpuCounters {
  readonly devices: number;
  readonly contexts: readonly string[];
}

export async function serve(port: number): Promise<() => void> {
  const child = spawn(process.execPath, [resolve(SITE, 'scripts/preview.mts')], {
    cwd: SITE,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((ready, fail) => {
    child.stdout.once('data', () => ready());
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`preview server exited with ${code}; is dist/ built?`)));
  });
  return () => child.kill();
}

export function launch(): Promise<Browser> {
  return chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
}

/** Counts every GPU device and every rendering context the page creates, from before its first script. */
export async function instrument(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const counters = { devices: 0, contexts: [] as string[] };
    Object.defineProperty(window, '__glyphGpu', { value: counters });
    const adapter = (globalThis as { GPUAdapter?: { prototype: { requestDevice: (...args: unknown[]) => unknown } } })
      .GPUAdapter;
    if (adapter !== undefined) {
      const requestDevice = adapter.prototype.requestDevice;
      adapter.prototype.requestDevice = function (...args: unknown[]) {
        counters.devices += 1;
        return requestDevice.apply(this, args);
      };
    }
    const seen = new WeakSet<object>();
    for (const canvas of [HTMLCanvasElement, OffscreenCanvas]) {
      const getContext = canvas.prototype.getContext as (this: object, type: string, ...rest: unknown[]) => unknown;
      (canvas.prototype as { getContext: unknown }).getContext = function (
        this: object,
        type: string,
        ...rest: unknown[]
      ) {
        const result = getContext.call(this, type, ...rest);
        if (result !== null && !seen.has(this)) {
          seen.add(this);
          counters.contexts.push(type);
        }
        return result;
      };
    }
  });
}

export function watch(page: Page, label: string): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${label}: console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`${label}: uncaught: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`${label}: HTTP ${response.status()} ${response.url()}`);
  });
  return problems;
}

export const gpuCounters = (page: Page) =>
  page.evaluate(() => (window as unknown as { __glyphGpu: GpuCounters }).__glyphGpu) as Promise<GpuCounters>;

export const waitForProxyState = (page: Page, selector: string, state: string, timeout = 30_000) =>
  page.waitForFunction(
    ([query, wanted]) => document.querySelector(query!)?.getAttribute('data-glyph-state') === wanted,
    [selector, state] as const,
    { timeout },
  );
