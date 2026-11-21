/* @workflow { "name": "benchmark:pixi3d-parity", "summary": "Render the same scenes through @pmndrs/glyph-pixi3d (PixiJS 3D on WebGPU and on WebGL2) and through Glyph's Three renderer at the same camera in headless Chrome, and compare their pixels.", "requirements": "Playwright Chromium with WebGPU and the baked rendering fixtures. --backends=webgpu,webgl selects PixiJS 3D backends; --scenes=a,b selects scenes; --tolerance=<n> sets the channel tolerance (default 8); --out=<dir> writes each scene's Pixi and Three images; --where prints the first pixels over the tolerance; --console prints the page's other console messages.", "writes": "Only the directory named by --out." } */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

import type { Pixi3DBackend, Pixi3DParityCapture } from '../src/pixi3d-parity-contract.ts';
import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const tolerance = Number(option('tolerance') ?? 8);
const outDirectory = option('out');
const selected = option('scenes')?.split(',');
const backends = (option('backends')?.split(',') ?? ['webgpu', 'webgl']) as Pixi3DBackend[];

interface Budget {
  /** Pixels over the tolerance, as a share of the pixels Three lights. */
  readonly share: number;
  readonly why: string;
}

/**
 * What a scene may differ from Three by more than the tolerance. Every budget names its intended difference; a
 * scene without one must match within the tolerance.
 */
function budget(backend: Pixi3DBackend, scene: string): Budget | undefined {
  if (scene === 'msdf-effects') {
    return {
      share: 0.0005,
      why: 'Three trims MSDF quads to the ink, outline and shadow; where an outline is wider than the baked padding the trim drops coverage the untrimmed Pixi cell draws',
    };
  }
  // A quad edge exactly on a pixel centre belongs to the pixel on one side. PixiJS 3D's WebGL path draws y-flipped,
  // so such an edge lands one row over: Bitmap quads, which reach the ink, show it; padded MSDF cells do not.
  if (backend === 'webgl' && scene.startsWith('bitmap-')) {
    return { share: 0.02, why: 'WebGL owns pixel-centre quad edges from the other side' };
  }
  if (backend === 'webgl' && scene.startsWith('slug-')) {
    return { share: 0.0005, why: 'WebGL owns pixel-centre quad edges from the other side' };
  }
  return undefined;
}

interface Difference {
  readonly over: number;
  readonly max: number;
  readonly lost: number;
  readonly lit: number;
  readonly where: readonly string[];
}

function compare(candidate: Uint8Array, reference: Uint8Array, width: number): Difference {
  let over = 0;
  let max = 0;
  let lost = 0;
  let lit = 0;
  const where: string[] = [];
  for (let offset = 0; offset < candidate.length; offset += 4) {
    let delta = 0;
    let candidateLit = 0;
    let referenceLit = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta = Math.max(delta, Math.abs(candidate[offset + channel]! - reference[offset + channel]!));
      candidateLit = Math.max(candidateLit, candidate[offset + channel]!);
      referenceLit = Math.max(referenceLit, reference[offset + channel]!);
    }
    if (referenceLit > 0) lit += 1;
    if (delta > tolerance) {
      over += 1;
      if (where.length < 12) {
        const pixel = offset / 4;
        const rgb = (bytes: Uint8Array): string => Array.from(bytes.subarray(offset, offset + 3)).join(' ');
        where.push(
          `${String(pixel % width)},${String(Math.floor(pixel / width))} ${rgb(candidate)} / ${rgb(reference)}`,
        );
      }
    }
    if (referenceLit > tolerance && candidateLit === 0) lost += 1;
    max = Math.max(max, delta);
  }
  return { over, max, lost, lit, where };
}

const decode = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
const row = (cells: readonly (string | number)[]): string => `| ${cells.join(' | ')} |`;

let browser: Awaited<ReturnType<typeof launchProjectChromium>> | undefined;
let server: ViteDevServer | undefined;
const failures: string[] = [];
try {
  server = await createServer({ root, logLevel: 'warn', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Vite did not publish its loopback TCP address');
  }
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  process.stdout.write(
    `Channel tolerance ${String(tolerance)}/255 on the max RGB channel; "lost" = lit by Three, black in Pixi.\n`,
  );
  for (const backend of backends) {
    const page = await browser.newPage({ viewport: { width: 832, height: 1200 }, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on('console', (message) => {
      // Chrome reports WebGPU validation errors (a shader that fails to compile, an invalid pipeline) as warnings,
      // and PixiJS reports a GLSL compile failure as a warning too: both mean a draw silently did nothing.
      const graphicsError = /WGSL|Invalid (?:ShaderModule|RenderPipeline|CommandBuffer)|shader|GL_INVALID/i;
      if (message.type() === 'error' || (message.type() === 'warning' && graphicsError.test(message.text()))) {
        errors.push(message.text());
      } else if (process.argv.includes('--console')) {
        process.stdout.write(`    [${message.type()}] ${message.text()}\n`);
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${String(address.port)}/pixi3d-parity.html?backend=${backend}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.pixi3dParity !== undefined, undefined, { timeout: 120_000 });
    const scenes = await page.evaluate(async () => (await window.pixi3dParity).scenes);
    process.stdout.write(`\nPixiJS 3D on ${backend} against Three on WebGPU\n\n`);
    process.stdout.write(`${row(['scene', 'meshes', 'lit px (Three)', 'over', 'over %', 'max', 'lost', 'budget'])}\n`);
    process.stdout.write(`${row(Array.from({ length: 8 }, () => '---'))}\n`);
    for (const scene of scenes) {
      if (selected !== undefined && !selected.includes(scene)) continue;
      const capture: Pixi3DParityCapture = await page.evaluate(async (name) => {
        try {
          return await (await window.pixi3dParity).capture(name);
        } catch (error) {
          throw new Error(error instanceof Error ? (error.stack ?? error.message) : String(error), { cause: error });
        }
      }, scene);
      if (errors.length !== 0) throw new Error(`${backend} ${scene}: browser errors: ${errors.splice(0).join(' | ')}`);
      const pixi = decode(capture.pixi);
      const difference = compare(pixi, decode(capture.three), capture.width);
      const allowed = budget(backend, scene);
      const share = difference.lit === 0 ? 0 : difference.over / difference.lit;
      process.stdout.write(
        `${row([scene, capture.meshes, difference.lit, difference.over, (share * 100).toFixed(2), difference.max, difference.lost, allowed === undefined ? '0' : `${String(allowed.share * 100)}%: ${allowed.why}`])}\n`,
      );
      if (process.argv.includes('--where')) {
        for (const at of difference.where) process.stdout.write(`    ${at}\n`);
      }
      if (outDirectory !== undefined) {
        await mkdir(resolve(outDirectory), { recursive: true });
        for (const [suffix, rgba] of [
          [backend, capture.pixi],
          ['three', capture.three],
        ] as const) {
          const png = await page.evaluate(
            async ([data, width, height]) => (await window.pixi3dParity).toPng(data, width, height),
            [rgba, capture.width, capture.height] as const,
          );
          await writeFile(resolve(outDirectory, `${scene}.${suffix}.png`), Buffer.from(png, 'base64'));
        }
      }
      if (difference.lit < 100) failures.push(`${scene}: Three lit only ${String(difference.lit)} pixels`);
      if (share > (allowed?.share ?? 0)) {
        failures.push(
          `${backend} ${scene}: ${String(difference.over)} pixels (${(share * 100).toFixed(2)}% of lit) differ from Three by more than ${String(tolerance)}/255`,
        );
      }
    }
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}
if (failures.length !== 0) {
  process.stderr.write(`\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('\npixi3d-parity-ok\n');
