import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page, Request, Response } from 'playwright';
import { createServer, searchForWorkspaceRoot } from 'vite';

import { assertPresentationDrawTopology } from '../src/benchmark/presentation-draw-topology.ts';
import type { ComparisonWorkloadId } from '../src/workloads/comparison/contracts.ts';
import { LOOPBACK_HOST, selectLoopbackPort } from './support/loopback-port.mts';
import { archiveBenchmarkLoaderResolution } from './support/archive-benchmark-loader.mts';
import { launchProjectChromium } from './support/project-chromium.mts';
import { inspectEditorialPng, type EditorialPixels } from './support/editorial-pixel-proof.mts';
import { assertEditorialSceneMatchesCapture, captureEditorialSceneOnly } from './support/editorial-scene-capture.mts';
import {
  assertArchiveSha256,
  assertCompleteArchiveEnvironment,
  assertDeliveredEntries,
  assertInstalledDist,
  assertProofServerNonce,
  distInventory,
  installedDistResponseSource,
  sha256,
} from './support/archive-dist-proof.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const technique = presentationFormat(process.env.PRESENTATION_TECHNIQUE);
const backend = presentationBackend(process.env.PRESENTATION_BACKEND);
const shaders = presentationShaders(process.env.PRESENTATION_SHADERS);
const shaderQuery = shaders === 'typegpu' ? '&shaders=typegpu' : '';
const presentationIntervalMs = 7_000;
const presentationSamplePeriodMs = 300;
interface PresentationWorkload {
  readonly id: ComparisonWorkloadId;
  readonly label: string;
  readonly fontSize: number;
  readonly layoutWidthRatio: number;
  readonly amount: number;
  readonly camera: 'perspective' | 'orthographic';
}
const screenshotDirectory = process.env.PRESENTATION_SCREENSHOT_DIR;
const editorialPixelDirectory = process.env.PRESENTATION_EDITORIAL_PIXEL_DIR;
const editorialPixelRole = process.env.PRESENTATION_EDITORIAL_PIXEL_ROLE;
const archiveEnvironment = [
  process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT,
  process.env.PRESENTATION_DELIVERY_OUTPUT_DIR,
  process.env.PRESENTATION_ARCHIVE_ARTIFACT,
  process.env.PRESENTATION_ARCHIVE_SHA256,
];
const serverNonce = randomUUID();
const archiveReceiptPath =
  process.env.PRESENTATION_DELIVERY_OUTPUT_DIR === undefined
    ? undefined
    : resolvePath(
        process.env.PRESENTATION_DELIVERY_OUTPUT_DIR,
        `${backend}-${technique}-${shaders}-${process.env.PRESENTATION_WORKLOAD ?? 'all'}.json`,
      );
let acquisitionServer: Awaited<ReturnType<typeof createServer>> | undefined;
let receiptWritten = false;
let outerFailure: unknown;
let outerFailed = false;
let cleanupError: unknown;
let outerReceiptFailure: unknown;
try {
  assertCompleteArchiveEnvironment(archiveEnvironment);
  if (screenshotDirectory !== undefined) await mkdir(screenshotDirectory, { recursive: true });
  if (editorialPixelDirectory !== undefined) await mkdir(editorialPixelDirectory, { recursive: true });
  const installedRoot =
    process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT === undefined
      ? undefined
      : await realpath(resolvePath(process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT));
  const deliveryOutputDirectory = process.env.PRESENTATION_DELIVERY_OUTPUT_DIR;
  if (
    installedRoot !== undefined &&
    (deliveryOutputDirectory === undefined ||
      process.env.PRESENTATION_ARCHIVE_ARTIFACT === undefined ||
      process.env.PRESENTATION_ARCHIVE_SHA256 === undefined)
  ) {
    throw new Error(
      'Installed presentation proof requires PRESENTATION_DELIVERY_OUTPUT_DIR, PRESENTATION_ARCHIVE_ARTIFACT, and PRESENTATION_ARCHIVE_SHA256',
    );
  }
  // A Wasm-only override is separate from installed-archive proof.
  const shaperArtifactPath = process.env.PRESENTATION_SHAPER_ARTIFACT;
  if (installedRoot !== undefined && shaperArtifactPath !== undefined) {
    throw new Error('PRESENTATION_SHAPER_ARTIFACT cannot authenticate an installed archive');
  }
  const shaperArtifact = shaperArtifactPath === undefined ? undefined : await readFile(shaperArtifactPath);
  if (installedRoot !== undefined && process.env.PRESENTATION_BASE_URL !== undefined) {
    throw new Error('Installed presentation proof owns its Vite server so package aliases are enforced');
  }
  if (
    editorialPixelDirectory !== undefined &&
    (installedRoot === undefined || process.env.PRESENTATION_WORKLOAD !== 'editorial')
  ) {
    throw new Error('Editorial pixel proof requires an installed archive and PRESENTATION_WORKLOAD=editorial');
  }
  if (
    editorialPixelDirectory !== undefined &&
    editorialPixelRole !== 'candidate' &&
    editorialPixelRole !== 'cold-main'
  ) {
    throw new Error('Editorial pixel proof requires PRESENTATION_EDITORIAL_PIXEL_ROLE=candidate or cold-main');
  }
  let archiveProof:
    | {
        archiveSha256: string;
        installedDistSha256ByPath: Record<string, string>;
        packageRoot: string;
        workspaceLockSha256: string;
        peers: { glyph: string; three: string; typegpu: string };
        sceneSha256: string;
        sceneProofSha256: string;
        runtimeSourceSha256: string;
        captureSourceSha256: string;
        interFixtureSha256: string;
        viewportSourceSha256: string;
      }
    | undefined;
  if (installedRoot !== undefined) {
    const archive = resolvePath(process.env.PRESENTATION_ARCHIVE_ARTIFACT!);
    const expected = process.env.PRESENTATION_ARCHIVE_SHA256!;
    assertArchiveSha256(await readFile(archive), expected);
    const unpacked = await mkdtemp(resolvePath(tmpdir(), 'glyph-presentation-archive-'));
    try {
      await promisify(execFileCallback)('tar', ['-xzf', archive, '-C', unpacked]);
      const archiveDist = await distInventory(resolvePath(unpacked, 'package/dist'));
      const installedDist = await distInventory(resolvePath(installedRoot, 'dist'));
      assertInstalledDist(archiveDist, installedDist);
      if (installedDist['loader.js'] === undefined) {
        throw new Error('Installed archive is missing the benchmark font library loader.js member');
      }
      archiveProof = {
        archiveSha256: expected,
        installedDistSha256ByPath: installedDist,
        packageRoot: installedRoot,
        workspaceLockSha256: sha256(await readFile(resolvePath(root, '../pnpm-lock.yaml'))),
        peers: {
          glyph: await packageVersion(resolvePath(installedRoot, 'package.json')),
          three: await packageVersion(resolvePath(root, 'node_modules/three/package.json')),
          typegpu: await packageVersion(resolvePath(root, 'node_modules/typegpu/package.json')),
        },
        sceneSha256: sha256(await readFile(resolvePath(root, 'src/workloads/editorial/scene.ts'))),
        sceneProofSha256: sha256(
          await readFile(resolvePath(root, 'src/surfaces/benchmark/scenes/editorial-scene-proof.ts')),
        ),
        runtimeSourceSha256: sha256(
          await readFile(resolvePath(root, 'src/surfaces/benchmark/scenes/comparison-workload.ts')),
        ),
        captureSourceSha256: sha256(await readFile(resolvePath(root, 'scripts/support/editorial-scene-capture.mts'))),
        interFixtureSha256: sha256(await readFile(resolvePath(root, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'))),
        viewportSourceSha256: sha256(
          await readFile(resolvePath(root, 'src/surfaces/benchmark/comparison-workload-viewport.tsx')),
        ),
      };
    } finally {
      await rm(unpacked, { recursive: true, force: true });
    }
    await mkdir(deliveryOutputDirectory!, { recursive: true });
  }
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let baseUrl: URL;
  if (process.env.PRESENTATION_BASE_URL === undefined) {
    const exportedEntries = [
      ['@pmndrs/glyph/three/typegpu', 'three/typegpu.js'],
      ['@pmndrs/glyph/shaders/tsl', 'shaders/tsl/index.js'],
      ['@pmndrs/glyph/shaders/typegpu', 'shaders/typegpu/index.js'],
      ['@pmndrs/glyph/runtime-bake', 'runtime-bake.js'],
      ['@pmndrs/glyph/three', 'three.js'],
      ['@pmndrs/glyph/react', 'react/index.js'],
      ['@pmndrs/glyph/typegpu', 'typegpu.js'],
      ['@pmndrs/glyph/baker', 'bake.js'],
      ['@pmndrs/glyph/core', 'core.js'],
      ['@pmndrs/glyph', 'index.js'],
    ] as const;
    const aliases =
      installedRoot === undefined
        ? []
        : exportedEntries.map(([find, member]) => ({
            find: new RegExp(`^${find.replaceAll('/', '\\/')}$`, 'u'),
            replacement: resolvePath(installedRoot, 'dist', member),
          }));
    const port = process.env.PORT === undefined ? await selectLoopbackPort() : Number(process.env.PORT);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('PORT must be a valid TCP port');
    server = await createServer({
      root,
      plugins: [
        ...(installedRoot === undefined
          ? []
          : [
              {
                name: 'glyph-presentation-archive-benchmark-loader',
                enforce: 'pre' as const,
                resolveId(id: string, importer: string | undefined) {
                  return archiveBenchmarkLoaderResolution(id, importer, root, installedRoot);
                },
              },
            ]),
        {
          name: 'glyph-presentation-proof-origin',
          configureServer(viteServer) {
            viteServer.middlewares.use((_request, response, next) => {
              response.setHeader('x-glyph-proof-nonce', serverNonce);
              next();
            });
          },
        },
      ],
      ...(installedRoot === undefined
        ? {}
        : {
            optimizeDeps: { exclude: exportedEntries.map(([name]) => name) },
            resolve: { alias: aliases, dedupe: ['three'] },
          }),
      server: {
        host: LOOPBACK_HOST,
        port,
        strictPort: process.env.PORT !== undefined,
        ...(installedRoot === undefined ? {} : { fs: { allow: [searchForWorkspaceRoot(root), installedRoot] } }),
      },
    });
    acquisitionServer = server;
    await server.listen();
    const address = server.httpServer?.address();
    if (address === null || address === undefined || typeof address === 'string') {
      throw new Error('Vite did not publish a local TCP address');
    }
    baseUrl = new URL(process.env.PORTLESS_URL ?? `http://${LOOPBACK_HOST}:${String(address.port)}`);
  } else {
    baseUrl = new URL(process.env.PRESENTATION_BASE_URL);
  }

  const allWorkloads = [
    { id: 'editorial', label: 'Editorial', fontSize: 24, layoutWidthRatio: 0.82, amount: 50, camera: 'perspective' },
    {
      id: 'text-ladder',
      label: 'Text ladder',
      fontSize: 24,
      layoutWidthRatio: 0.82,
      amount: 50,
      camera: 'orthographic',
    },
    {
      id: 'zoom-text',
      label: 'Zoom text',
      fontSize: 8 * (96 / 72),
      layoutWidthRatio: 0.82,
      amount: 50,
      camera: 'orthographic',
    },
    { id: 'icon-grid', label: 'Icon grid', fontSize: 64, layoutWidthRatio: 0.82, amount: 50, camera: 'orthographic' },
    {
      id: 'billboard-labels',
      label: 'Billboard labels',
      fontSize: 18,
      layoutWidthRatio: 0.82,
      amount: 100,
      camera: 'perspective',
    },
    {
      id: 'off-axis-3d',
      label: 'Off-axis / 3D',
      fontSize: 96,
      layoutWidthRatio: 1.2,
      amount: 100,
      camera: 'perspective',
    },
    {
      id: 'dynamic-layout',
      label: 'Dynamic layout',
      fontSize: 32,
      layoutWidthRatio: 0.82,
      amount: 50,
      camera: 'orthographic',
    },
    {
      id: 'paragraph-stress',
      label: 'Paragraph stress',
      fontSize: 24,
      layoutWidthRatio: 0.82,
      amount: 100,
      camera: 'orthographic',
    },
    {
      id: 'paint-effects',
      label: 'Paint & effects',
      fontSize: 52,
      layoutWidthRatio: 0.82,
      amount: 50,
      camera: 'orthographic',
    },
    {
      id: 'rich-text',
      label: 'Rich text spans',
      fontSize: 26,
      layoutWidthRatio: 0.82,
      amount: 50,
      camera: 'orthographic',
    },
  ] as const;
  const selectedWorkload = process.env.PRESENTATION_WORKLOAD;
  const workloads =
    selectedWorkload === undefined ? allWorkloads : allWorkloads.filter((workload) => workload.id === selectedWorkload);
  if (workloads.length === 0) {
    throw new RangeError(`PRESENTATION_WORKLOAD is not a maintained presentation workload: ${selectedWorkload}`);
  }

  const consoleProblems: string[] = [];
  let browser: Browser | undefined;
  const deliveryResponses: {
    url: string;
    source: string;
    status: number;
    resourceType: string;
    contentType: string;
    bytes: number;
    sha256: string;
  }[] = [];
  const deliveryErrors: string[] = [];
  const unmatchedGlyphResponses: string[] = [];
  const deliveryTasks: Promise<void>[] = [];
  let deliveryStatus: 'running' | 'completed' | 'failed' = 'running';
  let observedBackend: string | null = null;
  let editorialPixelCapture:
    | (EditorialPixels & {
        readonly path: string;
        readonly pngSha256: string;
        readonly hiddenOverlayElements: number;
        readonly state: {
          readonly animationEnabled: false;
          readonly backend: string;
          readonly camera: string;
          readonly canvasBacking: readonly [number, number];
          readonly canvasCss: readonly [number, number];
          readonly configurationRevision: number;
          readonly dpr: number;
          readonly drawCount: number;
          readonly fontFixture: string;
          readonly frameCount: number;
          readonly glyphCount: number;
          readonly showGrid: boolean;
          readonly workload: string;
        };
      })
    | undefined;
  let editorialSceneReceipt: { readonly path: string; readonly sha256: string } | undefined;
  let primaryFailure: unknown;
  let innerFailed = false;
  let innerReceiptFailure: unknown;
  try {
    browser = await launchProjectChromium({
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
    });
    const page = await browser.newPage({
      viewport: { width: 1_280, height: 720 },
      ignoreHTTPSErrors: process.env.PORTLESS_URL !== undefined,
    });
    if (installedRoot !== undefined) {
      const originProbe = await page.request.get(new URL('/__glyph-proof-origin__', baseUrl).href);
      assertProofServerNonce(originProbe.headers(), serverNonce);
    }
    let observeInstalledResponse: ((response: Response) => void) | undefined;
    let observeInstalledFailure: ((request: Request) => void) | undefined;
    if (installedRoot !== undefined) {
      const expectedOrigin = baseUrl.origin;
      const distRoot = resolvePath(installedRoot, 'dist');
      const workspaceGlyphRoot = resolvePath(root, '../packages/glyph');
      observeInstalledResponse = (response: Response) => {
        const url = response.url();
        const source = installedDistResponseSource(url, expectedOrigin, root, distRoot);
        if (source === undefined) {
          if (
            installedDistResponseSource(url, expectedOrigin, root, workspaceGlyphRoot) !== undefined ||
            /@pmndrs[/_]glyph|text-shaper\.wasm/u.test(decodeURIComponent(new URL(url).pathname))
          ) {
            unmatchedGlyphResponses.push(url);
            deliveryErrors.push(`Glyph package response did not come from installed dist: ${url}`);
          }
          return;
        }
        if (archiveProof!.installedDistSha256ByPath[source] === undefined) {
          deliveryErrors.push(`Installed dist response is absent from authenticated archive inventory: ${source}`);
          return;
        }
        deliveryTasks.push(
          response
            .body()
            .then((body) => {
              const digest = sha256(body);
              const binaryFetch = source === 'text-shaper.wasm' && response.request().resourceType() === 'fetch';
              const responseSource =
                source === 'text-shaper.wasm' && !binaryFetch ? 'text-shaper.wasm:url-module' : source;
              deliveryResponses.push({
                url,
                source: responseSource,
                status: response.status(),
                resourceType: response.request().resourceType(),
                contentType: response.headers()['content-type'] ?? '',
                bytes: body.byteLength,
                sha256: digest,
              });
              try {
                assertProofServerNonce(response.headers(), serverNonce);
              } catch (error) {
                deliveryErrors.push(`Invalid proof origin for installed ${source}: ${String(error)} ${url}`);
              }
              if (response.status() < 200 || response.status() >= 300) {
                deliveryErrors.push(`Invalid installed ${source} response: ${url}`);
              }
              if (
                binaryFetch &&
                (body.byteLength < 8 ||
                  body[0] !== 0 ||
                  body[1] !== 97 ||
                  body[2] !== 115 ||
                  body[3] !== 109 ||
                  digest !== archiveProof!.installedDistSha256ByPath[source])
              ) {
                deliveryErrors.push(`Delivered shaper differs from archive: ${url}`);
              }
            })
            .catch((error: unknown) => {
              deliveryErrors.push(`Could not read installed response ${url}: ${String(error)}`);
            }),
        );
      };
      observeInstalledFailure = (request: Request) => {
        const url = request.url();
        const source = installedDistResponseSource(url, expectedOrigin, root, distRoot);
        if (
          source !== undefined ||
          installedDistResponseSource(url, expectedOrigin, root, workspaceGlyphRoot) !== undefined ||
          /@pmndrs[/_]glyph|text-shaper\.wasm/u.test(decodeURIComponent(new URL(url).pathname))
        ) {
          deliveryErrors.push(`Failed installed or fallback Glyph request: ${url}`);
        }
      };
      page.context().on('response', observeInstalledResponse);
      page.context().on('requestfailed', observeInstalledFailure);
    }
    let shaperArtifactRequests = 0;
    if (shaperArtifact !== undefined) {
      await page.route('**/text-shaper.wasm*', async (route) => {
        // Vite can also request a JavaScript URL module for this path; only replace fetched bytes.
        if (route.request().resourceType() !== 'fetch') {
          await route.continue();
          return;
        }
        await route.fulfill({ contentType: 'application/wasm', body: shaperArtifact });
        shaperArtifactRequests += 1;
      });
    }
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
    await page.goto(
      new URL(
        `/presentation?mode=benchmark&technique=${technique}&backend=${backend}&delivery=baked&dpr=2&font=inter&workload=text-ladder${shaderQuery}${editorialPixelDirectory === undefined ? '' : '&editorialProof=1'}`,
        baseUrl,
      ).href,
      { waitUntil: 'domcontentloaded' },
    );
    const workloadControl = page.getByLabel('Live workload', { exact: true });
    await workloadControl.waitFor();
    await page.waitForFunction(() => document.querySelector('canvas[data-configured-renderer-active="true"]') !== null);
    await page.waitForFunction((expectedBackend) => {
      const viewport = document.querySelector<HTMLElement>(
        '[data-testid="comparison-live-viewport"][data-workload="text-ladder"]',
      );
      return (
        viewport?.dataset.presentationPending === 'false' &&
        viewport.dataset.backend === expectedBackend &&
        Number(viewport.dataset.glyphCount) > 0 &&
        Number(viewport.dataset.drawCount) > 0 &&
        Number(viewport.dataset.framesPerSecond) > 0
      );
    }, backend);
    if (shaperArtifact !== undefined) {
      if (shaperArtifactRequests === 0) throw new Error('Presentation did not fetch the pinned shaper artifact');
      console.log('presentation-shaper-artifact', createHash('sha256').update(shaperArtifact).digest('hex'));
    }
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
      const scope = globalThis as typeof globalThis & {
        presentationProbeCanvas: HTMLCanvasElement | undefined;
        presentationProbeCanvasEvidence: CanvasEvidence | undefined;
        presentationProbeCanvasEvents: string[];
        presentationProbeInputEvents: string[];
      };
      scope.presentationProbeCanvas = canvas ?? undefined;
      if (canvas === null) {
        scope.presentationProbeCanvasEvidence = undefined;
      } else {
        const bounds = canvas.getBoundingClientRect();
        scope.presentationProbeCanvasEvidence = {
          backingHeight: canvas.height,
          backingWidth: canvas.width,
          connected: canvas.isConnected,
          cssHeight: bounds.height,
          cssWidth: bounds.width,
        };
      }
      scope.presentationProbeCanvasEvents = [];
      scope.presentationProbeInputEvents = [];
      document.addEventListener(
        'click',
        (event) => {
          const target = event.target instanceof Element ? event.target : undefined;
          scope.presentationProbeInputEvents.push(
            `${performance.now().toFixed(1)}ms click ${target?.getAttribute('aria-label') ?? target?.textContent?.trim().slice(0, 80) ?? 'unknown'}`,
          );
        },
        { capture: true },
      );
      if (canvas !== null) {
        new MutationObserver((records) => {
          for (const record of records) {
            scope.presentationProbeCanvasEvents.push(
              `${performance.now().toFixed(1)}ms attribute ${record.attributeName ?? 'unknown'} ${record.oldValue ?? 'null'} -> ${canvas.getAttribute(record.attributeName ?? '') ?? 'null'}`,
            );
          }
        }).observe(canvas, { attributeFilter: ['height', 'width'], attributeOldValue: true, attributes: true });
        new ResizeObserver(() => {
          const bounds = canvas.getBoundingClientRect();
          scope.presentationProbeCanvasEvents.push(
            `${performance.now().toFixed(1)}ms css ${String(bounds.width)}x${String(bounds.height)}`,
          );
        }).observe(canvas);
        new MutationObserver(() => {
          if (!canvas.isConnected) {
            scope.presentationProbeCanvasEvents.push(`${performance.now().toFixed(1)}ms disconnected`);
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      }
    });

    let deliveryClosed = false;
    for (const workload of workloads) {
      await workloadControl.click();
      await page.getByRole('option', { name: workload.label, exact: true }).click();
      // Sample the batch topology at the settled mount, before the presentation timeline advances. Paragraph stress
      // animates its own size and measure, so a sample taken later in the soak would report a different scene.
      await waitForSettledWorkload(page, workload, backend, false);
      if (workload.id === 'editorial') {
        observedBackend = await page.locator('[data-testid="comparison-live-viewport"]').getAttribute('data-backend');
      }
      if (archiveProof !== undefined && !deliveryClosed) {
        if (observeInstalledResponse !== undefined) page.context().off('response', observeInstalledResponse);
        if (observeInstalledFailure !== undefined) page.context().off('requestfailed', observeInstalledFailure);
        deliveryClosed = true;
        await Promise.all(deliveryTasks);
        assertDeliveredEntries(deliveryResponses, [
          'index.js',
          'loader.js',
          'three.js',
          'text-shaper.wasm',
          ...(shaders === 'typegpu' ? ['three/typegpu.js'] : []),
        ]);
        if (deliveryErrors.length > 0) {
          throw new Error(
            `Presentation archive delivery failed: ${deliveryErrors.join(' | ')}; unmatched Glyph URLs: ${unmatchedGlyphResponses.join(' | ') || 'none'}`,
          );
        }
      }
      const settled = await readBatching(page);
      assertPresentationDrawTopology(workload.id, settled.drawCount);
      console.log(
        'presentation-workload-settled',
        workload.id,
        `draws=${String(settled.drawCount)}`,
        `glyphs=${String(settled.glyphCount)}`,
      );
      await assertPresentationRemainsVisible(page, workload.id, backend);
      if (workload.id === 'editorial') {
        const reflow = await readReflowTelemetry(page);
        if (reflow.sampleCount < 3) throw new Error('editorial did not publish enough retained reflow samples');
        console.log('presentation-workload-reflow', workload.id, JSON.stringify(reflow));
      }
      await waitForSettledWorkload(page, workload, backend, true);
      const retainedCanvas = await page.evaluate(() => {
        const scope = globalThis as typeof globalThis & { presentationProbeCanvas: Element | undefined };
        return (
          scope.presentationProbeCanvas === document.querySelector('canvas[data-configured-renderer-active="true"]')
        );
      });
      if (!retainedCanvas) throw new Error(`${workload.id} replaced the persistent renderer canvas`);
      if (Number(await page.locator('html').getAttribute('data-active-configured-renderers')) !== 1) {
        throw new Error(`${workload.id} did not retain exactly one configured renderer`);
      }
      if (screenshotDirectory !== undefined || (editorialPixelDirectory !== undefined && workload.id === 'editorial')) {
        if (workload.id === 'editorial') await pauseEditorialForCapture(page);
        if (screenshotDirectory !== undefined) {
          await page.screenshot({
            path: resolvePath(screenshotDirectory, `${backend}-${technique}-${workload.id}.png`),
          });
        }
        if (editorialPixelDirectory !== undefined && workload.id === 'editorial') {
          const path = resolvePath(editorialPixelDirectory, `${backend}-${technique}-${shaders}-editorial.png`);
          const { png, hiddenOverlayElements } = await captureEditorialSceneOnly(page);
          await writeFile(path, png, { flag: 'wx' });
          const pixels = await inspectEditorialPng(page, png);
          if (pixels.foregroundPixels < 300 || pixels.foregroundBounds === null) {
            throw new Error(
              `Paused editorial canvas contains only ${String(pixels.foregroundPixels)} foreground pixels`,
            );
          }
          editorialPixelCapture = {
            ...pixels,
            path,
            pngSha256: sha256(png),
            hiddenOverlayElements,
            state: await readEditorialCaptureState(page),
          };
          // Query the current producer only after Chromium has captured the paused scene; mainline inspection may
          // materialize glyph columns and must not influence the pixel comparison.
          const semantic = await requestEditorialSceneProof(page);
          assertEditorialSceneMatchesCapture(semantic, editorialPixelCapture.state);
          const semanticArtifact = {
            queryOrder: 'after-scene-only-png' as const,
            capturedState: editorialPixelCapture.state,
            producer: semantic,
          };
          const semanticPath = resolvePath(
            editorialPixelDirectory,
            `${backend}-${technique}-${shaders}-editorial-scene.json`,
          );
          const semanticJson = `${JSON.stringify(semanticArtifact, null, 2)}\n`;
          await writeFile(semanticPath, semanticJson, { flag: 'wx' });
          editorialSceneReceipt = { path: semanticPath, sha256: sha256(Buffer.from(semanticJson)) };
        }
        if (workload.id === 'editorial') {
          await page.getByRole('button', { name: 'Animation: OFF', exact: true }).click();
          await page.getByRole('switch', { name: 'Animate', exact: true }).click();
        }
      }
    }
    if (technique === 'bitmap') {
      const dprMenu = page.getByRole('button', { name: 'Device pixel ratio: 2×', exact: true });
      await dprMenu.click();
      await page
        .getByRole('button', { name: '1×', exact: true })
        .evaluate((element) => (element as HTMLButtonElement).click());
      await page.waitForFunction(() => new URLSearchParams(location.search).get('dpr') === '1');
      await assertCanvasHandoff(page, 'DPR 2→1', backend);
      await page.getByRole('button', { name: 'Device pixel ratio: 1×', exact: true }).click();
      await page
        .getByRole('button', { name: '2×', exact: true })
        .evaluate((element) => (element as HTMLButtonElement).click());
      await page.waitForFunction(() => new URLSearchParams(location.search).get('dpr') === '2');
      await assertCanvasHandoff(page, 'DPR 1→2', backend);

      const mtsdfControl = page.getByRole('button', { name: 'MSDF', exact: true });
      await mtsdfControl.evaluate((element) => (element as HTMLButtonElement).click());
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
        return viewport?.dataset.technique === 'mtsdf' && viewport.dataset.presentationPending === 'false';
      });
      await assertCanvasHandoff(page, 'Bitmap→MTSDF', backend);
      await page
        .getByRole('button', { name: 'Bitmap', exact: true })
        .evaluate((element) => (element as HTMLButtonElement).click());
      await page.waitForFunction(() => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
        return viewport?.dataset.technique === 'bitmap' && viewport.dataset.presentationPending === 'false';
      });
      await assertCanvasHandoff(page, 'MTSDF→Bitmap', backend);
    }
    const editorialWorkload = workloads.find((workload) => workload.id === 'editorial');
    if (backend === 'webgpu' && technique === 'mtsdf' && editorialWorkload !== undefined) {
      await assertWebGpuToWebGl2Switch(page, workloadControl, editorialWorkload);
    }
    if (consoleProblems.length > 0) {
      throw new Error(`Presentation emitted browser warnings or errors: ${consoleProblems.join(' | ')}`);
    }
    deliveryStatus = 'completed';
    console.log(
      'presentation-workloads-ready',
      JSON.stringify({ backend, workloads: workloads.length, rendererCount: 1, shaders, technique }),
    );
  } catch (error) {
    innerFailed = true;
    primaryFailure = error;
    deliveryStatus = 'failed';
    deliveryErrors.push(String(error));
    console.error('presentation-probe-problems', JSON.stringify(consoleProblems.slice(-12)));
    const failurePage = browser?.contexts()[0]?.pages()[0];
    if (failurePage !== undefined && screenshotDirectory !== undefined) {
      await failurePage
        .screenshot({ path: resolvePath(screenshotDirectory, `${backend}-${technique}-failure.png`) })
        .catch((screenshotError) => console.error('presentation-probe-screenshot-error', screenshotError));
    }
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      deliveryStatus = 'failed';
      deliveryErrors.push(`browser close: ${String(error)}`);
    }
    try {
      await server?.close();
    } catch (error) {
      deliveryStatus = 'failed';
      deliveryErrors.push(`server close: ${String(error)}`);
    }
    acquisitionServer = undefined;
    if (archiveProof !== undefined) {
      try {
        await Promise.all(deliveryTasks);
        await writeFile(
          archiveReceiptPath!,
          `${JSON.stringify(
            {
              schemaVersion: 1,
              status: deliveryStatus,
              scenario: {
                requestedBackend: backend,
                observedBackend,
                technique,
                shaders,
                workload: selectedWorkload ?? 'all',
                viewport: [1280, 720],
                dpr: 2,
                ...(editorialPixelDirectory === undefined ? {} : { editorialPixelRole }),
              },
              archive: archiveProof,
              shaper: {
                source: 'archive manifest',
                sha256: archiveProof.installedDistSha256ByPath['text-shaper.wasm'],
              },
              browserVersion: browser?.version(),
              responses: deliveryResponses.sort((left, right) => left.url.localeCompare(right.url)),
              unmatchedGlyphResponses,
              ...(editorialPixelCapture === undefined ? {} : { editorialPixelCapture }),
              ...(editorialSceneReceipt === undefined ? {} : { editorialSceneReceipt }),
              errors: [...consoleProblems, ...deliveryErrors],
              limitations: [
                'The paused editorial scene-only PNG contains browser-composited canvas pixels after a later reported renderer frame; the request-time semantic scene artifact records layout but is not an independent correctness oracle.',
              ],
            },
            null,
            2,
          )}\n`,
          { flag: 'wx' },
        );
        receiptWritten = true;
      } catch (error) {
        innerReceiptFailure = error;
      }
    }
  }
  if (innerFailed) throw primaryFailure;
  if (innerReceiptFailure !== undefined) throw innerReceiptFailure;
  if (deliveryStatus === 'failed') throw new Error(`Presentation teardown failed: ${deliveryErrors.join(' | ')}`);
} catch (error) {
  outerFailed = true;
  outerFailure = error;
} finally {
  if (acquisitionServer !== undefined) {
    try {
      await acquisitionServer.close();
    } catch (error) {
      cleanupError = error;
    }
  }
  if (archiveReceiptPath !== undefined && !receiptWritten) {
    try {
      await mkdir(dirname(archiveReceiptPath), { recursive: true });
      await writeFile(
        archiveReceiptPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            status: 'failed',
            scenario: {
              requestedBackend: backend,
              technique,
              shaders,
              workload: process.env.PRESENTATION_WORKLOAD ?? 'all',
            },
            archive: {
              path: process.env.PRESENTATION_ARCHIVE_ARTIFACT,
              expectedSha256: process.env.PRESENTATION_ARCHIVE_SHA256,
              installedPackageRoot: process.env.GLYPH_RETAINED_UPLOAD_PACKAGE_ROOT,
            },
            errors: [
              String(outerFailure ?? 'setup or teardown failed'),
              ...(cleanupError === undefined ? [] : [String(cleanupError)]),
            ],
          },
          null,
          2,
        )}\n`,
        { flag: 'wx' },
      );
    } catch (error) {
      outerReceiptFailure = error;
    }
  }
}
if (outerFailed) {
  if (outerReceiptFailure !== undefined) {
    process.stderr.write(`Could not persist presentation failure receipt: ${String(outerReceiptFailure)}\n`);
  }
  throw outerFailure;
}
if (outerReceiptFailure !== undefined) throw outerReceiptFailure;
if (cleanupError !== undefined) throw cleanupError;

async function packageVersion(path: string): Promise<string> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string') {
    throw new Error(`Invalid package version at ${path}`);
  }
  return value.version;
}

/** Waits until the named workload owns the viewport at its authored configuration and is publishing frames.
 * `requireZoomBuildUp` is excluded from settle-on-mount: Zoom text reaches its reported scale mid-cycle. */
async function waitForSettledWorkload(
  page: Page,
  workload: PresentationWorkload,
  expectedBackend: PresentationBackend,
  requireZoomBuildUp: boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ expected, requireZoom }) => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      if (viewport === null) return false;
      const close = (attribute: string, value: number): boolean =>
        Math.abs(Number(viewport.getAttribute(attribute)) - value) < 0.000_001;
      const zoomReady = !requireZoom || expected.id !== 'zoom-text' || Number(viewport.dataset.zoomScale) >= 3;
      const animatedParagraph = expected.id === 'paragraph-stress';
      return (
        viewport.dataset.workload === expected.id &&
        viewport.dataset.presentationPending === 'false' &&
        viewport.dataset.backend === expected.backend &&
        viewport.dataset.cameraKind === expected.camera &&
        viewport.dataset.canvasGrid === 'true' &&
        viewport.dataset.animationEnabled === 'true' &&
        close('data-animation-speed', 50) &&
        (animatedParagraph || close('data-applied-font-size', expected.fontSize)) &&
        (animatedParagraph || close('data-layout-width-ratio', expected.layoutWidthRatio)) &&
        close('data-applied-workload-amount', expected.amount) &&
        Number(viewport.dataset.glyphCount) > 0 &&
        Number(viewport.dataset.drawCount) > 0 &&
        Number(viewport.dataset.framesPerSecond) > 0 &&
        zoomReady
      );
    },
    { expected: { ...workload, backend: expectedBackend }, requireZoom: requireZoomBuildUp },
  );
}

/** Draw/glyph counts are the batching evidence for one cell — the renderer issues one draw per packed glyph run. */
async function readBatching(page: Page): Promise<{ readonly drawCount: number; readonly glyphCount: number }> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return { drawCount: Number(viewport?.dataset.drawCount), glyphCount: Number(viewport?.dataset.glyphCount) };
  });
}

async function pauseEditorialForCapture(page: Page): Promise<void> {
  const before = await page.locator('[data-testid="comparison-live-viewport"]').evaluate((element) => ({
    revision: Number(element.getAttribute('data-configuration-revision')),
    frameCount: Number(element.getAttribute('data-frame-count')),
  }));
  if (!Number.isSafeInteger(before.revision) || !Number.isSafeInteger(before.frameCount)) {
    throw new Error('Editorial capture requires published configuration and frame counters');
  }
  await page.getByRole('button', { name: 'Animation: ON', exact: true }).click();
  await page.getByRole('switch', { name: 'Animate', exact: true }).click();
  await page.waitForFunction((previousRevision) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return (
      viewport?.dataset.workload === 'editorial' &&
      viewport.dataset.animationEnabled === 'false' &&
      viewport.dataset.presentationPending === 'false' &&
      Number(viewport.dataset.configurationRevision) > previousRevision
    );
  }, before.revision);
  const paused = await page.locator('[data-testid="comparison-live-viewport"]').evaluate((element) => ({
    revision: Number(element.getAttribute('data-configuration-revision')),
    frameCount: Number(element.getAttribute('data-frame-count')),
  }));
  // Stats can publish the new configuration from the prior frame's telemetry. A later completed host frame proves
  // that the fixed editorial state has reached canvasSurface.render before Chromium captures its composited canvas.
  await page.waitForFunction(({ revision, frameCount }) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return (
      viewport?.dataset.animationEnabled === 'false' &&
      Number(viewport.dataset.configurationRevision) === revision &&
      Number(viewport.dataset.frameCount) >= frameCount + 2
    );
  }, paused);
  await page.mouse.click(1_200, 680);
  await page.getByRole('switch', { name: 'Animate', exact: true }).waitFor({ state: 'hidden' });
}

async function requestEditorialSceneProof(page: Page): Promise<unknown> {
  const nonce = randomUUID();
  const result: unknown = await page.evaluate((requestNonce) => {
    let response: unknown;
    window.dispatchEvent(
      new CustomEvent('glyph-editorial-proof-request', {
        detail: {
          nonce: requestNonce,
          respond: (value: unknown) => {
            response = value;
          },
        },
      }),
    );
    return response;
  }, nonce);
  if (typeof result !== 'object' || result === null || !('nonce' in result) || result.nonce !== nonce) {
    throw new Error('Editorial scene proof did not receive a fresh runtime response');
  }
  if (!('status' in result) || result.status !== 'ok' || !('receipt' in result)) {
    throw new Error(`Editorial scene proof producer failed: ${JSON.stringify(result)}`);
  }
  return result.receipt;
}

async function readEditorialCaptureState(page: Page): Promise<{
  readonly animationEnabled: false;
  readonly backend: string;
  readonly camera: string;
  readonly canvasBacking: readonly [number, number];
  readonly canvasCss: readonly [number, number];
  readonly configurationRevision: number;
  readonly dpr: number;
  readonly drawCount: number;
  readonly fontFixture: string;
  readonly frameCount: number;
  readonly glyphCount: number;
  readonly showGrid: boolean;
  readonly workload: string;
}> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    if (viewport === null || canvas === null) throw new Error('Editorial capture lost its viewport or canvas');
    const bounds = canvas.getBoundingClientRect();
    const state = {
      animationEnabled: viewport.dataset.animationEnabled,
      backend: viewport.dataset.backend,
      camera: viewport.dataset.cameraKind,
      canvasBacking: [canvas.width, canvas.height] as const,
      canvasCss: [bounds.width, bounds.height] as const,
      configurationRevision: Number(viewport.dataset.configurationRevision),
      dpr: Number(viewport.dataset.dpr),
      drawCount: Number(viewport.dataset.drawCount),
      fontFixture: viewport.dataset.fontFixture,
      frameCount: Number(viewport.dataset.frameCount),
      glyphCount: Number(viewport.dataset.glyphCount),
      showGrid: viewport.dataset.canvasGrid,
      workload: viewport.dataset.workload,
    };
    if (
      state.animationEnabled !== 'false' ||
      state.backend === undefined ||
      state.camera !== 'perspective' ||
      state.fontFixture !== 'inter' ||
      state.showGrid !== 'true' ||
      state.workload !== 'editorial' ||
      state.dpr !== 2 ||
      state.canvasBacking.some((value) => value <= 0) ||
      state.canvasCss.some((value) => value <= 0) ||
      !Number.isSafeInteger(state.configurationRevision) ||
      !Number.isSafeInteger(state.frameCount) ||
      state.drawCount <= 0 ||
      state.glyphCount <= 0 ||
      Number(document.documentElement.dataset.activeConfiguredRenderers) !== 1
    ) {
      throw new Error(`Editorial capture state is incomplete: ${JSON.stringify(state)}`);
    }
    return {
      ...state,
      animationEnabled: false as const,
      backend: state.backend,
      camera: 'perspective' as const,
      fontFixture: state.fontFixture,
      showGrid: true as const,
      workload: 'editorial' as const,
    };
  });
}

interface ReflowTelemetry {
  readonly sampleCount: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly medianStageMs: number;
  readonly medianPublishMs: number;
  readonly medianLayoutMs: number;
  readonly p95StageMs: number;
  readonly p95PublishMs: number;
  readonly p95LayoutMs: number;
}

async function readReflowTelemetry(page: Page): Promise<ReflowTelemetry> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    if (viewport === null) throw new Error('comparison viewport is missing');
    const number = (name: string): number => {
      const value = Number(viewport.getAttribute(name));
      if (!Number.isFinite(value)) throw new Error(`comparison viewport ${name} is not finite`);
      return value;
    };
    return {
      sampleCount: number('data-reflow-sample-count'),
      medianMs: number('data-reflow-median-ms'),
      p95Ms: number('data-reflow-p95-ms'),
      medianStageMs: number('data-reflow-median-stage-ms'),
      medianPublishMs: number('data-reflow-median-publish-ms'),
      medianLayoutMs: number('data-reflow-median-layout-ms'),
      p95StageMs: number('data-reflow-p95-stage-ms'),
      p95PublishMs: number('data-reflow-p95-publish-ms'),
      p95LayoutMs: number('data-reflow-p95-layout-ms'),
    };
  });
}

async function assertCanvasHandoff(page: Page, label: string, expectedBackend: PresentationBackend): Promise<void> {
  const evidence = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      presentationProbeCanvas: HTMLCanvasElement | undefined;
      presentationProbeCanvasEvents: string[];
    };
    const current = document.querySelector('canvas[data-configured-renderer-active="true"]');
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return {
      backend: viewport?.dataset.backend,
      disconnected: scope.presentationProbeCanvasEvents.some((event) => event.endsWith('disconnected')),
      rendererCount: Number(document.documentElement.dataset.activeConfiguredRenderers),
      retained: current !== null && current === scope.presentationProbeCanvas && current.isConnected,
    };
  });
  if (
    !evidence.retained ||
    evidence.disconnected ||
    evidence.rendererCount !== 1 ||
    evidence.backend !== expectedBackend
  ) {
    throw new Error(`${label} did not retain one continuously attached renderer canvas: ${JSON.stringify(evidence)}`);
  }
}

async function assertWebGpuToWebGl2Switch(
  page: Page,
  workloadControl: ReturnType<Page['getByLabel']>,
  editorialWorkload: PresentationWorkload,
): Promise<void> {
  await workloadControl.click();
  await page.getByRole('option', { name: editorialWorkload.label, exact: true }).click();
  await waitForSettledWorkload(page, editorialWorkload, 'webgpu', false);
  await page.evaluate(async () => {
    const modulePath = '/src/renderer/gpu-frame-timer.ts';
    const timerModule = (await import(/* @vite-ignore */ modulePath)) as {
      waitForGpuFrameTimerRetirement(target: EventTarget): Promise<{ readonly pendingCount: number }>;
    };
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    if (canvas === null) throw new Error('the WebGPU→WebGL2 probe lost its source canvas');
    const scope = globalThis as typeof globalThis & {
      presentationProbeTimerRetirement?: Promise<{ readonly pendingCount: number }>;
    };
    scope.presentationProbeTimerRetirement = timerModule.waitForGpuFrameTimerRetirement(canvas);
  });
  await page.getByRole('button', { name: 'Graphics backend: GPU', exact: true }).click();
  await page.getByRole('button', { name: 'GL', exact: true }).click();
  await waitForSettledWorkload(page, editorialWorkload, 'webgl2', false);
  const retirement = await page.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      presentationProbeTimerRetirement?: Promise<{ readonly pendingCount: number }>;
    };
    if (scope.presentationProbeTimerRetirement === undefined) {
      throw new Error('the WebGPU→WebGL2 probe lost its retirement observation');
    }
    return scope.presentationProbeTimerRetirement;
  });
  // A real read may settle before the UI switch. Deferred unit tests prove waiting; this probe records the actual state.
  console.log('presentation-timer-retirement', retirement);
  await page.waitForFunction(() => {
    const scope = globalThis as typeof globalThis & { presentationProbeCanvas?: HTMLCanvasElement };
    const retiredCanvas = scope.presentationProbeCanvas;
    const currentCanvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    return (
      retiredCanvas !== undefined &&
      currentCanvas !== null &&
      currentCanvas !== retiredCanvas &&
      !retiredCanvas.isConnected &&
      retiredCanvas.dataset.configuredRendererActive === 'false' &&
      Number(document.documentElement.dataset.activeConfiguredRenderers) === 1
    );
  });
  console.log('presentation-backend-switch-ready', 'webgpu→webgl2', editorialWorkload.id);
}

function presentationFormat(value: string | undefined): 'bitmap' | 'mtsdf' | 'slug' {
  if (value === undefined || value === 'mtsdf') return 'mtsdf';
  if (value === 'bitmap' || value === 'slug') return value;
  throw new RangeError(`PRESENTATION_TECHNIQUE must be bitmap, msdf, or slug; received ${value}`);
}

function presentationBackend(value: string | undefined): PresentationBackend {
  if (value === undefined || value === 'webgpu') return 'webgpu';
  if (value === 'webgl2') return value;
  throw new RangeError(`PRESENTATION_BACKEND must be webgpu or webgl2; received ${value}`);
}

function presentationShaders(value: string | undefined): 'tsl' | 'typegpu' {
  if (value === undefined || value === 'tsl') return 'tsl';
  if (value === 'typegpu') return value;
  throw new RangeError(`PRESENTATION_SHADERS must be tsl or typegpu; received ${value}`);
}

async function assertPresentationRemainsVisible(
  page: Page,
  workload: ComparisonWorkloadId,
  expectedBackend: PresentationBackend,
): Promise<void> {
  const minimumRequiredInkPixels = workload === 'zoom-text' ? 32 : 300;
  const startedAt = await page.evaluate(() => performance.now());
  while (true) {
    const canvasFailure = await page.evaluate((reportedBackend) => {
      const scope = globalThis as typeof globalThis & {
        presentationProbeCanvas: HTMLCanvasElement | undefined;
        presentationProbeCanvasEvidence: CanvasEvidence | undefined;
        presentationProbeCanvasEvents: string[];
        presentationProbeInputEvents: string[];
      };
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
      const expected = scope.presentationProbeCanvasEvidence;
      if (canvas === null || expected === undefined) return 'the configured renderer canvas is missing';
      if (canvas !== scope.presentationProbeCanvas) return 'the configured renderer canvas identity changed';
      const bounds = canvas.getBoundingClientRect();
      const actual: CanvasEvidence = {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        connected: canvas.isConnected,
        cssHeight: bounds.height,
        cssWidth: bounds.width,
      };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        const navigationStatus =
          document.querySelector<HTMLElement>('[data-testid="canvas-navigation-status"]')?.textContent ?? 'missing';
        return `the canvas dimensions changed from ${JSON.stringify(expected)} to ${JSON.stringify(actual)}; browser DPR ${String(devicePixelRatio)}; URL ${location.search}; status ${navigationStatus.trim()}; canvas events ${scope.presentationProbeCanvasEvents.slice(-12).join(' | ')}; input events ${scope.presentationProbeInputEvents.slice(-12).join(' | ')}`;
      }
      const rendererCount = Number(document.documentElement.dataset.activeConfiguredRenderers);
      if (rendererCount !== 1) return `the active renderer count changed to ${String(rendererCount)}`;
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      if (viewport?.dataset.backend !== reportedBackend) {
        return `the active backend changed to ${viewport?.dataset.backend ?? 'missing'}`;
      }
      if (Number(viewport?.dataset.glyphCount) <= 0 || Number(viewport?.dataset.drawCount) <= 0) {
        return 'the active workload stopped publishing glyphs or draw calls';
      }
      return undefined;
    }, expectedBackend);
    if (canvasFailure !== undefined) throw new Error(`${workload}: ${canvasFailure}`);
    const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);
    if (elapsedMs >= presentationIntervalMs) break;
    const nextSampleAt = startedAt + Math.min(presentationIntervalMs, elapsedMs + presentationSamplePeriodMs);
    await page.evaluate(
      (targetTimestamp) =>
        new Promise<void>((resolve) => {
          const advance = (timestamp: number): void => {
            if (timestamp >= targetTimestamp) resolve();
            else requestAnimationFrame(advance);
          };
          requestAnimationFrame(advance);
        }),
      nextSampleAt,
    );
  }

  // Full-page capture can perturb a hardware-composited canvas on some Chromium/macOS combinations. Keep cadence
  // monitoring capture-free, then take one bounded headless proof after the workload has survived the interval.
  const screenshot = await page.screenshot();
  const visibleInkPixels = await visiblePresentationInkPixels(page, screenshot.toString('base64'));
  if (visibleInkPixels < minimumRequiredInkPixels) {
    throw new Error(`${workload} rendered only ${String(visibleInkPixels)} visible foreground pixels`);
  }
  const batching = await readBatching(page);
  assertPresentationDrawTopology(workload, batching.drawCount);
  console.log(
    'presentation-workload-visible',
    workload,
    visibleInkPixels,
    `draws=${String(batching.drawCount)}`,
    `glyphs=${String(batching.glyphCount)}`,
  );
}

interface CanvasEvidence {
  readonly backingHeight: number;
  readonly backingWidth: number;
  readonly connected: boolean;
  readonly cssHeight: number;
  readonly cssWidth: number;
}

type PresentationBackend = 'webgpu' | 'webgl2';

async function visiblePresentationInkPixels(page: Page, screenshotBase64: string): Promise<number> {
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Presentation screenshot did not expose a 2D pixel context');
    context.drawImage(image, 0, 0);
    const crop = context.getImageData(112, 88, 680, 540).data;
    let visibleInkPixels = 0;
    for (let offset = 0; offset < crop.length; offset += 4) {
      if (Math.max(crop[offset] ?? 0, crop[offset + 1] ?? 0, crop[offset + 2] ?? 0) >= 110) {
        visibleInkPixels += 1;
      }
    }
    return visibleInkPixels;
  }, screenshotBase64);
}
