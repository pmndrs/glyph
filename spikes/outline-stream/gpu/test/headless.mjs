#!/usr/bin/env node
// Headless correctness check for the GPU harness (software rendering; timings here mean nothing).
//
//   node spikes/outline-stream/gpu/test/fake-asset.mjs      # or a real prepare run
//   node spikes/outline-stream/gpu/test/headless.mjs [--font fake] [--set shapes] [--size 512] [--glyphs a,g]
//                                                    [--backends webgpu,webgl2] [--port 5191]
//
// It serves spikes/outline-stream/, opens the page in Chromium (SwiftShader for WebGL2 and WebGPU), and:
//   1. renders the magnified view of every drawable glyph with A and B, and compares each with a CPU reference
//      (8x8 supersampled non-zero winding of the exact B outline, built from the asset's own band references);
//   2. runs "Run all" on a small canvas with few frames, checking A-vs-B pixel differences;
//   3. writes PNGs into gpu/test/ (screenshot-*.png) and prints a JSON summary.
// Environment: CHROMIUM (default /opt/pw-browsers/chromium when present), PLAYWRIGHT (module path).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = new URL('./', import.meta.url);
const spikeRoot = new URL('../../', import.meta.url);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fontName = option('font', 'fake');
const setName = option('set', fontName === 'fake' ? 'shapes' : 'latin');
const size = Number(option('size', '512'));
const backends = option('backends', 'webgpu,webgl2').split(',');
const port = Number(option('port', '5191'));
const glyphFilter = option('glyphs', fontName === 'fake' ? '' : 'a,g,e,O,Q,S,&,@,8,ß');

const playwrightPath =
  process.env.PLAYWRIGHT ??
  fileURLToPath(new URL('../../../../benches/node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const executablePath =
  process.env.CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// ---- CPU reference -------------------------------------------------------------------------------------------
// Load the asset with the page's own parser by serving file: URLs through a tiny fetch shim.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (!href.startsWith('file:')) return realFetch(url, init);
  try {
    const bytes = await readFile(new URL(href));
    return new Response(bytes, { status: 200 });
  } catch {
    return new Response('missing', { status: 404 });
  }
};
const { loadIndex, loadSpikeAsset, decodeCurveB } = await import(new URL('../assets.mjs', import.meta.url).href);
const { buildMagnified, drawableGlyphs } = await import(new URL('../scene.mjs', import.meta.url).href);
const fonts = await loadIndex(new URL('out/', spikeRoot));
const entry = fonts.find((f) => f.name === fontName && f.set === setName);
if (!entry) throw new Error(`${fontName} / ${setName} not in out/index.json (${fonts.map((f) => f.label).join(', ')})`);
const asset = await loadSpikeAsset(entry);
globalThis.fetch = realFetch;

/** Every curve of a glyph in font units: the union of its B band references (exact, midpoint lines). */
function glyphCurves(glyph) {
  const seen = new Set();
  const curves = [];
  for (let band = 0; band < glyph.hBands + glyph.vBands; band += 1) {
    const header = asset.headers.data[glyph.bandBase + band];
    for (let k = 0; k < header >>> 16; k += 1) {
      const point = glyph.pointBase + asset.refsB.data[glyph.bandBase + (header & 0xffff) + k];
      if (seen.has(point)) continue;
      seen.add(point);
      curves.push(decodeCurveB(asset.points.data, point));
    }
  }
  return curves;
}

/** 8x8 supersampled non-zero coverage (0..255) of `glyph` in the magnified view, top-down. */
function referenceCoverage(glyph, width, height) {
  const scene = buildMagnified(asset, glyph, width, height);
  const view = new DataView(scene.data);
  const [rx, ry, rw, rh, ex, ey, ew, eh] = Array.from({ length: 8 }, (_, k) => view.getFloat32(k * 4, true));
  const upem = asset.unitsPerEm;
  // Flatten quadratics to segments in pixel space.
  const segments = [];
  for (const c of glyphCurves(glyph)) {
    const toPixel = ([x, y]) => [rx + ((x / upem - ex) / ew) * rw, ry + ((ey - y / upem) / eh) * rh];
    const p0 = toPixel(c.p0);
    const p1 = toPixel(c.p1);
    const p2 = toPixel(c.p2);
    const steps = c.line ? 1 : 64;
    let previous = p0;
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const u = 1 - t;
      const point = [
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
      ];
      segments.push([previous[0], previous[1], point[0], point[1]]);
      previous = point;
    }
  }
  const N = 8;
  const coverage = new Float32Array(width * height);
  for (let py = 0; py < height; py += 1) {
    for (let sy = 0; sy < N; sy += 1) {
      const y = py + (sy + 0.5) / N;
      const crossings = [];
      for (const [x0, y0, x1, y1] of segments) {
        if (y0 <= y && y < y1) crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), 1]);
        else if (y1 <= y && y < y0) crossings.push([x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), -1]);
      }
      crossings.sort((a, b) => a[0] - b[0]);
      let winding = 0;
      let next = 0;
      for (let px = 0; px < width; px += 1) {
        for (let sx = 0; sx < N; sx += 1) {
          const x = px + (sx + 0.5) / N;
          while (next < crossings.length && crossings[next][0] < x) winding += crossings[next++][1];
          if (winding !== 0) coverage[py * width + px] += 1 / (N * N);
        }
      }
    }
  }
  return Uint8Array.from(coverage, (v) => Math.round(Math.min(1, v) * 255));
}

function compareToReference(pixels, reference) {
  let sum = 0;
  let max = 0;
  let over64 = 0;
  let over128 = 0;
  const histogram = [];
  for (let i = 0; i < reference.length; i += 1) {
    const d = Math.abs(pixels[i * 4] - reference[i]);
    sum += d;
    if (d > max) max = d;
    if (d > 64) over64 += 1;
    if (d > 128) over128 += 1;
    histogram.push(d);
  }
  histogram.sort((a, b) => a - b);
  return {
    meanAbs: Number((sum / reference.length).toFixed(4)),
    p99Abs: histogram[Math.floor(histogram.length * 0.99)],
    p999Abs: histogram[Math.floor(histogram.length * 0.999)],
    maxAbs: max,
    over64,
    over128,
  };
}

// ---- Browser ---------------------------------------------------------------------------------------------------
const server = spawn(process.execPath, [fileURLToPath(new URL('serve.mjs', spikeRoot))], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => String(chunk).includes('http://') && resolve());
  server.on('exit', (code) => reject(new Error(`serve.mjs exited with ${code}`)));
});

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-vulkan=swiftshader',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const summary = { font: fontName, set: setName, size, backends: {}, magnified: [], runAll: null, consoleErrors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
  page.on('console', (message) => {
    if (message.type() === 'error') summary.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => summary.consoleErrors.push(String(error)));
  await page.goto(
    `http://localhost:${port}/gpu/?font=${fontName}&set=${setName}&w=${size}&h=${size}&frames=8&warmup=2&rounds=2&backends=${backends.join(',')}`,
  );
  await page.evaluate(() => window.spike.ready);

  const fileSafe = (name) => name.replace(/[^A-Za-z0-9]/g, (c) => `U${c.codePointAt(0).toString(16)}`);
  const save = async (name, dataUrl) => {
    await writeFile(new URL(`screenshot-${fontName}-${name}`, here), Buffer.from(dataUrl.split(',')[1], 'base64'));
  };

  for (const backendName of backends) {
    try {
      const result = await page.evaluate(
        ({ backendName }) => window.spike.view({ backendName, caseId: '32', variantId: 'B-mid', images: true }),
        { backendName },
      );
      await save(`${backendName}-grid32-B-mid.png`, result.png);
      await save(`${backendName}-grid32-diff.png`, result.diffPng);
      summary.backends[backendName] = { rendered: true, grid32BvsA: result.diff };
    } catch (error) {
      summary.backends[backendName] = { rendered: false, error: String(error.message ?? error).split('\n')[0] };
      continue;
    }
    const wanted = glyphFilter ? glyphFilter.split(',') : null;
    for (const glyph of drawableGlyphs(asset).filter((g) => !wanted || wanted.includes(g.name))) {
      const reference = referenceCoverage(glyph, size, size);
      for (const variantId of ['B-mid', 'B-dup', 'B-f16']) {
        const result = await page.evaluate(
          ({ backendName, variantId, magGlyph }) =>
            window.spike.view({ backendName, caseId: 'mag', variantId, magGlyph, images: true, raw: true }),
          { backendName, variantId, magGlyph: glyph.index },
        );
        const decode = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
        const entry = {
          backend: backendName,
          glyph: glyph.name,
          variant: variantId,
          bVsA: result.diff,
          aVsReference: variantId === 'B-mid' ? compareToReference(decode(result.rawA), reference) : undefined,
          bVsReference: compareToReference(decode(result.raw), reference),
        };
        delete entry.bVsA.firstOver;
        summary.magnified.push(entry);
        if (variantId === 'B-mid') {
          await save(`${backendName}-mag-${fileSafe(glyph.name)}-A.png`, result.pngA);
          await save(`${backendName}-mag-${fileSafe(glyph.name)}-B.png`, result.png);
        }
      }
    }
  }

  summary.runAll = await page.evaluate(() => window.spike.runAll());
  await page.screenshot({ path: fileURLToPath(new URL(`screenshot-${fontName}-page.png`, here)), fullPage: true });
} finally {
  await browser.close();
  server.kill();
}

if (args.includes('--json')) {
  console.log(JSON.stringify(summary, null, 1));
} else {
  const line = (d) => (d ? `max ${d.maxAbs} mean ${d.meanAbs} >64: ${d.over64}` : '');
  console.log(`${summary.font} / ${summary.set}, ${size}x${size}`);
  console.log('backends:', JSON.stringify(summary.backends));
  console.log('console errors:', JSON.stringify(summary.consoleErrors));
  console.log('magnified: B vs A, and each vs the 8x8 supersampled CPU reference (all /255)');
  for (const m of summary.magnified) {
    console.log(
      `  ${m.backend.padEnd(6)} ${m.glyph.padEnd(7)} ${m.variant.padEnd(5)} B-A max ${m.bVsA.maxAbs} >1/255: ${m.bVsA.over1}` +
        ` | A-ref ${line(m.aVsReference)} | B-ref ${line(m.bVsReference)}`,
    );
  }
  if (summary.runAll) {
    console.log('run all (software rendering: timings are not meaningful):');
    for (const r of summary.runAll.rows) {
      console.log(
        r.error
          ? `  ${r.backend} ${r.case} ERROR ${r.error}`
          : `  ${r.backend.padEnd(6)} ${r.case.padEnd(12)} ${r.variant.padEnd(5)} n=${String(r.instances).padEnd(5)} ` +
              (r.medianMs === undefined ? '(not timed)' : `${r.medianMs.toFixed(3)} ms (${r.timer})`) +
              (r.diffVsA
                ? ` vs A: max ${r.diffVsA.maxAbs} mean ${r.diffVsA.meanAbs.toFixed(5)} >1/255: ${r.diffVsA.over1}`
                : '') +
              (r.diffVsBMid ? ` vs B-mid: max ${r.diffVsBMid.maxAbs} >1/255: ${r.diffVsBMid.over1}` : ''),
      );
    }
    for (const c of summary.runAll.crossBackendA) {
      console.log(`  A ${c.backends.join(' vs ')} ${c.case}: max ${c.maxAbs} >1/255: ${c.over1}`);
    }
  }
}
