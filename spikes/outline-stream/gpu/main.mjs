// Page logic: asset selection, the view button, and Run all (timing + pixel comparison + results table/JSON).
import { loadIndex, loadSpikeAsset } from './assets.mjs';
import { diffImageData, diffImages, pngBlob, rgbaToImageData, summarize } from './analysis.mjs';
import { GRID_SIZES, buildGrid, buildMagnified, drawableGlyphs } from './scene.mjs';
import { VARIANTS } from './shaders.mjs';
import { createWebGl2Backend } from './webgl2.mjs';
import { createWebGpuBackend } from './webgpu.mjs';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const OUT_URL = new URL('../out/', location.href);
const CASES = [...GRID_SIZES.map(String), 'mag'];
const BACKENDS = ['webgpu', 'webgl2'];
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const state = {
  fonts: [],
  asset: null,
  backends: new Map(), // name -> backend | Error
  results: null,
  diffUrls: new Map(),
};

function log(message, kind = 'info') {
  const line = document.createElement('div');
  line.className = kind;
  line.textContent = message;
  $('log').prepend(line);
  (kind === 'error' ? console.error : console.log)(message);
}

function status(message) {
  $('status').textContent = message;
}

function settings() {
  const checked = (name) => [...document.querySelectorAll(`input[name=${name}]:checked`)].map((e) => e.value);
  return {
    width: Number($('width').value),
    height: Number($('height').value),
    frames: Math.min(2048, Math.max(1, Number($('frames').value))),
    warmup: Math.max(0, Number($('warmup').value)),
    rounds: Math.max(1, Number($('rounds').value)),
    draws: Math.max(1, Number($('draws').value)),
    cases: checked('case'),
    backends: checked('backend'),
    variants: VARIANTS.filter((v) => checked('variant').includes(v.id)),
    magGlyph: Number($('glyph').value),
  };
}

function buildControls() {
  const add = (container, name, value, label, on) => {
    const wrap = document.createElement('label');
    wrap.innerHTML = `<input type="checkbox" name="${name}" value="${value}"${on ? ' checked' : ''}> ${label}`;
    $(container).append(wrap);
  };
  const want = (key, all) => (params.get(key) ? params.get(key).split(',') : all);
  const cases = want('sizes', CASES);
  for (const c of CASES) add('cases', 'case', c, c === 'mag' ? 'magnified' : `${c} px/em`, cases.includes(c));
  const backends = want('backends', BACKENDS);
  for (const b of BACKENDS) add('backendList', 'backend', b, b, backends.includes(b));
  const variants = want(
    'variants',
    VARIANTS.map((v) => v.id),
  );
  for (const v of VARIANTS) add('variantList', 'variant', v.id, v.label, variants.includes(v.id));
  for (const [key, id] of [
    ['w', 'width'],
    ['h', 'height'],
    ['frames', 'frames'],
    ['warmup', 'warmup'],
    ['rounds', 'rounds'],
    ['draws', 'draws'],
  ]) {
    if (params.get(key)) $(id).value = params.get(key);
  }
  for (const c of CASES) $('viewCase').append(new Option(c === 'mag' ? 'magnified' : `${c} px/em`, c));
  for (const b of BACKENDS) $('viewBackend').append(new Option(b, b));
  for (const v of VARIANTS) $('viewVariant').append(new Option(v.id, v.id));
}

async function backend(name) {
  if (state.backends.has(name)) {
    const existing = state.backends.get(name);
    if (existing instanceof Error) throw existing;
    return existing;
  }
  try {
    const created = name === 'webgpu' ? await createWebGpuBackend($('gpuCanvas')) : createWebGl2Backend($('glCanvas'));
    state.backends.set(name, created);
    created.assetName = null;
    log(`${name}: ${JSON.stringify(created.info)}; timer ${created.timer}`);
    return created;
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    state.backends.set(name, wrapped);
    log(`${name} unavailable: ${wrapped.message}`, 'error');
    throw wrapped;
  }
}

async function prepareBackend(name, width, height) {
  const b = await backend(name);
  if (b.assetName !== state.asset.name || b.assetRef !== state.asset) {
    b.setAsset(state.asset);
    b.assetName = state.asset.name;
    b.assetRef = state.asset;
  }
  if (b.width !== width || b.height !== height) {
    b.setTarget(width, height);
    b.width = width;
    b.height = height;
  }
  return b;
}

function buildCase(caseId, width, height, magGlyph) {
  if (caseId === 'mag') {
    const glyph = state.asset.glyphs[magGlyph] ?? drawableGlyphs(state.asset)[0];
    return buildMagnified(state.asset, glyph, width, height);
  }
  return buildGrid(state.asset, Number(caseId), width, height);
}

/** Fill the glyph-set select with the sets of `fontName`, preferring `preferred` (e.g. "latin"). */
function fillSets(fontName, preferred) {
  const select = $('set');
  select.replaceChildren();
  state.fonts.forEach((f, i) => {
    if (f.name === fontName) select.append(new Option(f.set, String(i)));
  });
  const match = [...select.options].find((o) => o.textContent === preferred);
  if (match) select.value = match.value;
}

async function selectFont(index) {
  const entry = state.fonts[index];
  status(`loading ${entry.label}…`);
  state.asset = await loadSpikeAsset(entry);
  const v = state.asset.validation;
  $('assetInfo').textContent =
    `${entry.label}: ${v.glyphs} glyphs (${v.drawable} drawable), unitsPerEm ${state.asset.unitsPerEm}, ` +
    `${v.references} band references (${v.quadratics} quadratic, ${v.lines} line), max ${v.maxBandCurves} per band, ` +
    `${state.asset.points.texels} points, ${state.asset.curves.texels} curve texels, ` +
    `A/B endpoint mismatch ${v.maxEndpointErrorFontUnits.toFixed(3)} font units ` +
    `(${v.maxEndpointHalfUlps.toFixed(2)} f16 half-ulps)` +
    (entry.glbUrl ? `; main GLB listed (${entry.glbUrl}) but not rendered by this harness` : '');
  for (const warning of v.warnings) log(`asset: ${warning}`, 'warn');
  const glyphSelect = $('glyph');
  glyphSelect.replaceChildren();
  const drawable = drawableGlyphs(state.asset);
  for (const g of drawable) glyphSelect.append(new Option(`${g.name} (${g.index})`, String(g.index)));
  const wanted = params.get('glyph');
  const preferred =
    drawable.find((g) => g.name === wanted || String(g.index) === wanted) ??
    drawable.find((g) => g.name === 'g') ??
    drawable[0];
  if (preferred) glyphSelect.value = String(preferred.index);
  status(`${entry.label} loaded`);
}

async function showDiff(key, pixelsA, pixelsB, width, height) {
  const image = diffImageData(pixelsA, pixelsB, width, height);
  const url = URL.createObjectURL(await pngBlob(image));
  const previous = state.diffUrls.get(key);
  if (previous) URL.revokeObjectURL(previous);
  state.diffUrls.set(key, url);
  $('diffImage').src = url;
  $('diffCaption').textContent = key;
  return url;
}

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Render one view; with a B variant also render A and show the diff. For automation, `images` adds PNG data URLs
 * of the variant, A and the diff, and `raw` adds base64 RGBA8 pixels of the variant and A.
 */
async function view({ backendName, caseId, variantId, magGlyph, images = false, raw = false } = {}) {
  const s = settings();
  backendName ??= $('viewBackend').value;
  caseId ??= $('viewCase').value;
  variantId ??= $('viewVariant').value;
  magGlyph ??= s.magGlyph;
  const b = await prepareBackend(backendName, s.width, s.height);
  const instances = buildCase(caseId, s.width, s.height, magGlyph);
  b.setScene(instances);
  const variant = VARIANTS.find((v) => v.id === variantId);
  const reference = VARIANTS[0];
  const pixelsA = await b.render(reference);
  const pixels = variant.id === reference.id ? pixelsA : await b.render(variant);
  const diff = diffImages(pixelsA, pixels, s.width, s.height);
  await showDiff(`${backendName} ${instances.label} ${variant.id} vs A`, pixelsA, pixels, s.width, s.height);
  status(
    `${backendName} ${instances.label} ${variant.id}: ${instances.count} instances; vs A max ${diff.maxAbs}/255, ` +
      `mean ${diff.meanAbs.toFixed(5)}/255, ${diff.over1} px > 1/255`,
  );
  const toDataUrl = async (imageData) => {
    const blob = await pngBlob(imageData);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };
  const result = {
    instances: instances.count,
    diff,
    width: s.width,
    height: s.height,
    pixelsPerEm: instances.pixelsPerEm,
  };
  if (images) {
    result.png = await toDataUrl(rgbaToImageData(pixels, s.width, s.height));
    result.pngA = await toDataUrl(rgbaToImageData(pixelsA, s.width, s.height));
    result.diffPng = await toDataUrl(diffImageData(pixelsA, pixels, s.width, s.height));
  }
  if (raw) Object.assign(result, { raw: base64(pixels), rawA: base64(pixelsA) });
  return result;
}

const fmt = (v, digits = 3) => (Number.isFinite(v) ? v.toFixed(digits) : '–');

function addRow(row) {
  const tr = document.createElement('tr');
  const cells = [
    row.backend,
    row.case,
    row.instances,
    row.variant,
    row.timer,
    fmt(row.medianMs),
    fmt(row.p90Ms),
    fmt(row.pipelinedWallMs),
    row.variant === 'A' ? '' : fmt(row.medianRatioVsA, 3),
    row.diffVsA ? row.diffVsA.maxAbs : '',
    row.diffVsA ? fmt(row.diffVsA.meanAbs, 5) : '',
    row.diffVsA ? row.diffVsA.over1 : '',
  ];
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.append(td);
  }
  const td = document.createElement('td');
  if (row.diffKey) {
    const button = document.createElement('button');
    button.textContent = 'diff';
    button.onclick = () => {
      $('diffImage').src = state.diffUrls.get(row.diffKey);
      $('diffCaption').textContent = row.diffKey;
    };
    td.append(button);
  }
  tr.append(td);
  $('results').append(tr);
}

async function runAll(overrides = {}) {
  const s = { ...settings(), ...overrides };
  const asset = state.asset;
  $('results').replaceChildren();
  const results = {
    schema: 'outline-stream-gpu-spike/1',
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    canvas: { width: s.width, height: s.height, devicePixelRatio },
    settings: { frames: s.frames, warmup: s.warmup, rounds: s.rounds, drawsPerFrame: s.draws },
    asset: {
      name: asset.name,
      unitsPerEm: asset.unitsPerEm,
      binBytes: asset.binBytes,
      glyphs: asset.validation.glyphs,
      drawable: asset.validation.drawable,
      references: asset.validation.references,
      quadratics: asset.validation.quadratics,
      lines: asset.validation.lines,
      maxBandCurves: asset.validation.maxBandCurves,
      maxEndpointErrorFontUnits: asset.validation.maxEndpointErrorFontUnits,
      warnings: asset.validation.warnings.length,
    },
    backends: {},
    rows: [],
    crossBackendA: [],
  };
  state.results = results;
  const firstA = new Map();
  const magGlyph = state.asset.glyphs[s.magGlyph] ?? drawableGlyphs(asset)[0];
  results.settings.magnifiedGlyph = magGlyph.name;

  for (const name of s.backends) {
    let b;
    try {
      b = await prepareBackend(name, s.width, s.height);
      results.backends[name] = { info: b.info, timer: b.timer };
    } catch (error) {
      results.backends[name] = { error: String(error?.message ?? error) };
      continue;
    }
    for (const caseId of s.cases) {
      const instances = buildCase(caseId, s.width, s.height, s.magGlyph);
      b.setScene(instances);
      const timings = new Map(s.variants.map((v) => [v.id, { samples: [], wall: [], timer: b.timer }]));
      try {
        // Interleave variants across rounds so clock ramps and thermal drift hit every variant alike.
        const perRound = Math.max(1, Math.ceil(s.frames / s.rounds));
        for (let round = 0; round < s.rounds; round += 1) {
          for (const variant of s.variants.filter((v) => !v.diagnostic)) {
            status(`${name} ${instances.label}: ${variant.id} round ${round + 1}/${s.rounds}`);
            await nextFrame();
            const warmup = round === 0 ? s.warmup : Math.min(s.warmup, 2);
            const t = await b.time(variant, { frames: perRound, warmup, draws: s.draws });
            const entry = timings.get(variant.id);
            entry.samples.push(...t.samples);
            entry.wall.push(t.pipelinedWallMs);
            entry.timer = t.timer;
          }
        }
        const pixels = new Map();
        for (const variant of s.variants) pixels.set(variant.id, await b.render(variant));
        const pixelsA = pixels.get('A');
        const medianA = timings.has('A') ? summarize(timings.get('A').samples).medianMs : NaN;
        const compare = (from, to) => {
          const diff = diffImages(from, to, s.width, s.height);
          return { maxAbs: diff.maxAbs, meanAbs: diff.meanAbs, over1: diff.over1, nonzero: diff.nonzero };
        };
        for (const variant of s.variants) {
          const t = timings.get(variant.id);
          const row = {
            backend: name,
            case: caseId === 'mag' ? `mag ${magGlyph.name}` : `${caseId}px`,
            pixelsPerEm: Number(instances.pixelsPerEm.toFixed(3)),
            instances: instances.count,
            variant: variant.id,
          };
          if (!variant.diagnostic) {
            const stats = summarize(t.samples);
            Object.assign(row, {
              timer: t.timer,
              ...stats,
              pipelinedWallMs: t.wall.reduce((sum, v) => sum + v, 0) / t.wall.length,
              medianRatioVsA: stats.medianMs / medianA,
            });
          } else {
            row.timer = 'not timed';
          }
          if (pixelsA && variant.id !== 'A') {
            row.diffVsA = compare(pixelsA, pixels.get(variant.id));
            row.diffKey = `${name} ${instances.label} ${variant.id} vs A`;
            await showDiff(row.diffKey, pixelsA, pixels.get(variant.id), s.width, s.height);
          }
          if (variant.id === 'B-dup' && pixels.has('B-mid'))
            row.diffVsBMid = compare(pixels.get('B-mid'), pixels.get('B-dup'));
          results.rows.push(row);
          addRow(row);
        }
        if (pixelsA) {
          const other = firstA.get(caseId);
          if (other) {
            const diff = diffImages(other.pixels, pixelsA, s.width, s.height);
            results.crossBackendA.push({
              case: caseId,
              backends: [other.backend, name],
              ...diff,
              firstOver: undefined,
            });
          } else {
            firstA.set(caseId, { backend: name, pixels: pixelsA });
          }
        }
      } catch (error) {
        log(`${name} ${instances.label}: ${error?.message ?? error}`, 'error');
        results.rows.push({ backend: name, case: caseId, error: String(error?.message ?? error) });
      }
    }
  }
  const json = JSON.stringify(results, (key, value) => (key === 'diffKey' ? undefined : value));
  $('json').textContent = json;
  console.log(json);
  status('Run all finished; JSON is below and in the console.');
  return results;
}

async function main() {
  buildControls();
  $('runAll').onclick = () => runAll().catch((error) => log(String(error?.stack ?? error), 'error'));
  $('view').onclick = () => view().catch((error) => log(String(error?.stack ?? error), 'error'));
  $('copyJson').onclick = () => navigator.clipboard.writeText($('json').textContent);
  const reload = () => selectFont(Number($('set').value)).catch((error) => log(String(error?.stack ?? error), 'error'));
  $('font').onchange = () => {
    fillSets($('font').value, $('set').selectedOptions[0]?.textContent ?? 'latin');
    reload();
  };
  $('set').onchange = reload;
  try {
    state.fonts = await loadIndex(OUT_URL);
  } catch (error) {
    status(String(error.message));
    log(String(error.message), 'error');
    return;
  }
  if (state.fonts.length === 0) {
    status('out/index.json lists no fonts');
    return;
  }
  const names = [...new Set(state.fonts.map((f) => f.name))];
  for (const name of names) $('font').append(new Option(name, name));
  const fontName = names.includes(params.get('font'))
    ? params.get('font')
    : (state.fonts.find((f) => !f.raw?.test) ?? state.fonts[0]).name;
  $('font').value = fontName;
  fillSets(fontName, params.get('set') ?? 'latin');
  await selectFont(Number($('set').value));
  if (params.get('run') === '1') await runAll();
}

const ready = main().catch((error) => {
  log(String(error?.stack ?? error), 'error');
  throw error;
});

// Automation hooks for the headless check in gpu/test/.
window.spike = { ready, runAll, view, state };
