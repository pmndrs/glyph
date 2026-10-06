// Loads out/index.json and one font's out/<font>.spike.{json,bin}, per the "Asset format" section of
// .agents/docs/planning/outline-stream-spike.md, and validates it on the CPU before any GPU work.
import { TEXTURE_WIDTH } from './shaders.mjs';

const GLYPH_STRIDE = 32;
const SECTION_NAMES = ['glyphs', 'curvesF16', 'pointsI16', 'bandHeaders', 'bandRefsA', 'bandRefsB'];

/**
 * @typedef {{
 *   name: string, set: string, label: string, spikeUrl: string, binUrl: string | null, glbUrl: string | null,
 *   unitsPerEm: number | undefined, raw: any,
 * }} FontEntry
 * @typedef {{
 *   index: number, curveBase: number, pointBase: number, bandBase: number,
 *   hBands: number, vBands: number, bounds: [number, number, number, number], name: string,
 * }} GlyphRecord
 */

const pick = (object, ...keys) => {
  for (const key of keys) if (object && object[key] !== undefined && object[key] !== null) return object[key];
  return undefined;
};

/**
 * Read out/index.json as written by prepare.mjs: `{ fonts: [{ name, unitsPerEm, variants: { full, latin, … },
 * main: { core, slug } }] }` with each variant `{ json, bin }`. One entry is returned per font and glyph set.
 * A font without `variants` (gpu/test/fake-asset.mjs) is one set named after its `spike` file.
 */
export async function loadIndex(baseUrl) {
  const url = new URL('index.json', baseUrl);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} (run prepare, or gpu/test/fake-asset.mjs)`);
  const json = await response.json();
  const list = Array.isArray(json) ? json : (json.fonts ?? []);
  /** @type {FontEntry[]} */
  const entries = [];
  for (const raw of list) {
    const name = String(pick(raw, 'name', 'font') ?? 'font');
    const slug = raw.main?.slug ?? null;
    const sets = raw.variants ? Object.entries(raw.variants) : [['all', { json: raw.spike ?? raw.json, bin: raw.bin }]];
    for (const [set, files] of sets) {
      if (!files?.json) continue;
      entries.push({
        name,
        set,
        label: `${name} / ${set}`,
        spikeUrl: new URL(String(files.json), url).href,
        binUrl: files.bin ? new URL(String(files.bin), url).href : null,
        glbUrl: slug ? new URL(String(slug), url).href : null,
        unitsPerEm: raw.unitsPerEm,
        raw,
      });
    }
  }
  return entries;
}

function sectionBytes(bin, meta, name) {
  const sections = meta.sections ?? meta;
  const section = sections[name];
  if (!section) throw new Error(`asset JSON has no "${name}" section`);
  const offset = Number(pick(section, 'offset', 'byteOffset'));
  const length = Number(pick(section, 'length', 'byteLength'));
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || offset + length > bin.byteLength) {
    throw new Error(`section ${name} {offset ${offset}, length ${length}} is outside the ${bin.byteLength}-byte bin`);
  }
  return new Uint8Array(bin, offset, length);
}

/** Copy `bytes` into a fresh typed array padded to whole `TEXTURE_WIDTH` rows of `texelBytes`-byte texels. */
function padRows(bytes, texelBytes, ArrayType) {
  const texels = Math.floor(bytes.byteLength / texelBytes);
  const rows = Math.max(1, Math.ceil(texels / TEXTURE_WIDTH));
  const out = new Uint8Array(rows * TEXTURE_WIDTH * texelBytes);
  out.set(bytes.subarray(0, texels * texelBytes));
  return { data: new ArrayType(out.buffer), texels, rows };
}

/** @param {FontEntry} entry */
export async function loadSpikeAsset(entry) {
  const metaResponse = await fetch(entry.spikeUrl);
  if (!metaResponse.ok) throw new Error(`${entry.spikeUrl}: HTTP ${metaResponse.status}`);
  const meta = await metaResponse.json();
  const binUrl =
    entry.binUrl ??
    new URL(String(pick(meta, 'bin') ?? entry.spikeUrl.replace(/\.json$/, '.bin')), entry.spikeUrl).href;
  const binResponse = await fetch(binUrl);
  if (!binResponse.ok) throw new Error(`${binUrl}: HTTP ${binResponse.status}`);
  const bin = await binResponse.arrayBuffer();

  const unitsPerEm = Number(pick(meta, 'unitsPerEm') ?? entry.unitsPerEm);
  if (!(unitsPerEm > 0)) throw new Error('asset JSON has no unitsPerEm');
  const declaredWidth = pick(meta, 'rowTexels', 'textureWidth');
  if (declaredWidth !== undefined && Number(declaredWidth) !== TEXTURE_WIDTH) {
    throw new Error(`asset textureWidth ${declaredWidth} != ${TEXTURE_WIDTH}`);
  }

  const bytes = Object.fromEntries(SECTION_NAMES.map((name) => [name, sectionBytes(bin, meta, name)]));
  const glyphView = new DataView(bytes.glyphs.buffer, bytes.glyphs.byteOffset, bytes.glyphs.byteLength);
  const glyphCount = Math.floor(bytes.glyphs.byteLength / GLYPH_STRIDE);
  const names = meta.glyphNames ?? [];
  const ids = meta.glyphIds ?? [];
  const chars = meta.codepoints ?? [];
  const advances = meta.advances ?? [];
  /** @type {GlyphRecord[]} */
  const glyphs = [];
  for (let i = 0; i < glyphCount; i += 1) {
    const o = i * GLYPH_STRIDE;
    const label =
      names[i] ??
      (Number.isInteger(chars[i]) && chars[i] >= 0 && chars[i] <= 0x10ffff
        ? String.fromCodePoint(chars[i])
        : undefined) ??
      (ids[i] !== undefined ? `gid ${ids[i]}` : `#${i}`);
    glyphs.push({
      index: i,
      curveBase: glyphView.getUint32(o, true),
      pointBase: glyphView.getUint32(o + 4, true),
      bandBase: glyphView.getUint32(o + 8, true),
      hBands: glyphView.getUint16(o + 12, true),
      vBands: glyphView.getUint16(o + 14, true),
      bounds: [
        glyphView.getFloat32(o + 16, true),
        glyphView.getFloat32(o + 20, true),
        glyphView.getFloat32(o + 24, true),
        glyphView.getFloat32(o + 28, true),
      ],
      name: String(label),
      advance: typeof advances[i] === 'number' ? advances[i] : null,
    });
  }

  const curves = padRows(bytes.curvesF16, 8, Uint16Array);
  const points = padRows(bytes.pointsI16, 4, Int16Array);
  const headers = padRows(bytes.bandHeaders, 4, Uint32Array);
  const refsA = padRows(bytes.bandRefsA, 2, Uint16Array);
  const refsB = padRows(bytes.bandRefsB, 2, Uint16Array);

  const asset = {
    name: entry.label ?? entry.name,
    entry,
    meta,
    unitsPerEm,
    ascender: typeof meta.ascender === 'number' ? meta.ascender : null,
    descender: typeof meta.descender === 'number' ? meta.descender : null,
    glyphs,
    curves,
    points,
    headers,
    refsA,
    refsB,
    binBytes: bin.byteLength,
  };
  asset.validation = validateAsset(asset);
  return asset;
}

const halfTable = new Float32Array(65536);
for (let h = 0; h < 65536; h += 1) {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const mantissa = h & 0x3ff;
  halfTable[h] =
    exponent === 0
      ? sign * mantissa * 2 ** -24
      : exponent === 31
        ? mantissa
          ? NaN
          : sign * Infinity
        : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/** Half of one f16 ulp at `value` (subnormal floor 2^-25). */
function halfUlp(value) {
  const magnitude = Math.abs(value);
  if (magnitude < 2 ** -14) return 2 ** -25;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 11);
}

/** CPU decode of variant B's curve for point `index`, using the same read rule as the shaders (midpoint lines). */
export function decodeCurveB(points, index) {
  const at = (i) => {
    const x = points[i * 2];
    return [x >> 1, points[i * 2 + 1], x & 1];
  };
  const previous = index > 0 ? at(index - 1) : at(0);
  const current = at(index);
  const next = at(index + 1);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (current[2]) {
    return {
      line: false,
      p0: previous[2] ? mid(previous, current) : [previous[0], previous[1]],
      p1: [current[0], current[1]],
      p2: next[2] ? mid(current, next) : [next[0], next[1]],
      nextOffCurve: false,
    };
  }
  return {
    line: true,
    p0: [current[0], current[1]],
    p1: mid(current, next),
    p2: [next[0], next[1]],
    nextOffCurve: next[2] === 1,
  };
}

/** CPU decode of variant A's curve at texel `index`, em units. */
export function decodeCurveA(halfs, index) {
  const t = (i, k) => halfTable[halfs[i * 4 + k]];
  return { p0: [t(index, 0), t(index, 1)], p1: [t(index, 2), t(index, 3)], p2: [t(index + 1, 0), t(index + 1, 1)] };
}

/**
 * Check every band reference of both variants against the arrays it indexes, and that A and B name the same curve
 * (endpoints agree to f16 precision). This is what proves the harness reads the encoder's layout the way it was
 * written; the GPU never sees data that failed here without a warning on the page.
 */
export function validateAsset(asset) {
  const warnings = [];
  const { glyphs, unitsPerEm } = asset;
  const headerCount = asset.headers.texels;
  let references = 0;
  let maxBand = 0;
  let maxEndpointError = 0;
  let maxEndpointUlps = 0;
  let worst = null;
  let lines = 0;
  let quadratics = 0;
  let drawable = 0;
  for (const glyph of glyphs) {
    const bandCount = glyph.hBands + glyph.vBands;
    if (bandCount === 0) continue;
    if (glyph.hBands === 0 || glyph.vBands === 0) {
      warnings.push(`glyph ${glyph.name}: ${glyph.hBands} horizontal and ${glyph.vBands} vertical bands; skipped`);
      continue;
    }
    drawable += 1;
    if (glyph.bandBase + bandCount > headerCount) {
      warnings.push(`glyph ${glyph.name}: band headers ${glyph.bandBase}+${bandCount} past ${headerCount}`);
      continue;
    }
    for (let band = 0; band < bandCount; band += 1) {
      const header = asset.headers.data[glyph.bandBase + band];
      const count = header >>> 16;
      const offset = header & 0xffff;
      maxBand = Math.max(maxBand, count);
      for (let k = 0; k < count; k += 1) {
        const slot = glyph.bandBase + offset + k;
        if (slot >= asset.refsA.texels || slot >= asset.refsB.texels) {
          if (warnings.length < 50)
            warnings.push(`glyph ${glyph.name} band ${band}: reference slot ${slot} out of range`);
          continue;
        }
        references += 1;
        const texel = glyph.curveBase + asset.refsA.data[slot];
        const point = glyph.pointBase + asset.refsB.data[slot];
        if (texel + 1 >= asset.curves.texels || point + 1 >= asset.points.texels) {
          if (warnings.length < 50)
            warnings.push(`glyph ${glyph.name}: curve texel ${texel} or point ${point} out of range`);
          continue;
        }
        const b = decodeCurveB(asset.points.data, point);
        if (b.line) lines += 1;
        else quadratics += 1;
        if (b.nextOffCurve && warnings.length < 50) {
          warnings.push(`glyph ${glyph.name}: B reference ${point} is on-curve but followed by an off-curve point`);
        }
        const a = decodeCurveA(asset.curves.data, texel);
        const pairs = [
          [a.p0[0], b.p0[0]],
          [a.p0[1], b.p0[1]],
          [a.p2[0], b.p2[0]],
          [a.p2[1], b.p2[1]],
        ];
        for (const [av, bv] of pairs) {
          const em = bv / unitsPerEm;
          const error = Math.abs(av - em);
          const ulps = error / halfUlp(em);
          if (error > maxEndpointError) maxEndpointError = error;
          if (!(ulps <= maxEndpointUlps)) {
            maxEndpointUlps = ulps;
            worst = { glyph: glyph.name, band, k, texel, point, a, b };
          }
        }
      }
    }
  }
  // A correct pair differs only by f16 rounding: at most half an f16 ulp of the em coordinate (a little slack for
  // the f32 division by unitsPerEm).
  if (maxEndpointUlps > 1.01) {
    warnings.unshift(
      `A and B disagree: an endpoint differs by ${maxEndpointUlps.toFixed(1)} f16 half-ulps ` +
        `(glyph ${worst?.glyph}, A texel ${worst?.texel}, B point ${worst?.point}); ` +
        'the band references may not name the same curves',
    );
  }
  return {
    glyphs: glyphs.length,
    drawable,
    references,
    quadratics,
    lines,
    maxBandCurves: maxBand,
    maxEndpointErrorEm: maxEndpointError,
    maxEndpointErrorFontUnits: maxEndpointError * unitsPerEm,
    maxEndpointHalfUlps: maxEndpointUlps,
    warnings,
  };
}
