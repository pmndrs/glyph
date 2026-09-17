import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchProjectChromium } from '../../../../benches/scripts/support/project-chromium.mts';

/** Verify custom WebGPURenderer setup and retained text updates against installed peers. */
export async function checkReactBrowser(glyph: string, entries: readonly string[]): Promise<void> {
  await cp(
    fileURLToPath(new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    join(glyph, 'tests/browser/inter-bitmap-16.font.glb'),
  );
  const { createServer }: typeof import('vite') = await import(
    pathToFileURL(join(glyph, 'node_modules/vite/dist/node/index.js')).href
  );
  const browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  try {
    for (const entry of entries) {
      const server = await createServer({
        root: glyph,
        configFile: false,
        resolve: {
          alias: { '@glyph-test/fiber': entry === 'webgpu' ? '@react-three/fiber/webgpu' : '@react-three/fiber' },
        },
        server: { host: '127.0.0.1', port: 0 },
      });
      try {
        await server.listen();
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') throw new Error('Vite did not open a TCP listener');
        for (const backend of ['webgpu', 'webgl2']) {
          const page = await browser.newPage();
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
          });
          try {
            await page.goto(
              `http://127.0.0.1:${address.port}/tests/browser/r3f-compatibility.html?entry=${entry}&backend=${backend}`,
            );
            await page.waitForFunction(async () => {
              if (!('r3fCompatibility' in window)) return false;
              await window.r3fCompatibility;
              return true;
            });
            const result = await page.evaluate(
              () => (window as typeof window & { r3fCompatibility: Promise<unknown> }).r3fCompatibility,
            );
            if (errors.length) throw new Error(errors.join('\n'));
            console.log(`R3F ${entry} ${backend}:`, result);
          } finally {
            await page.close();
          }
        }
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
}
