import { float32Bits, float32UlpDistance } from '../../scripts/support/placement-representation-lab.mjs';

// This decomposes already-published f32 values across observable spans; it cannot prove a future f64 split.
export function summarizeRealCorpusPlacement(layout) {
  const slices = observableSlices(layout);
  const lineByGlyph = lineIndexByGlyph(layout);
  const sliceByGlyph = sliceIndexByGlyph(layout.glyphCount, slices);
  const lineAnchors = Array.from(layout.lineGlyphStarts, (glyphStart, lineIndex) => ({
    x: layout.x[glyphStart] ?? 0,
    y: layout.lineBaselines[lineIndex],
  }));
  const sliceAnchors = slices.map(({ glyphStart }) => ({ x: layout.x[glyphStart], y: layout.y[glyphStart] }));
  const candidates = {
    postNarrowLineRelative: emptyErrorSummary(),
    postNarrowSliceRelative: emptyErrorSummary(),
  };

  for (let glyphIndex = 0; glyphIndex < layout.glyphCount; glyphIndex += 1) {
    const referenceX = layout.x[glyphIndex];
    const referenceY = layout.y[glyphIndex];
    accumulatePair(candidates.postNarrowLineRelative, referenceX, referenceY, lineAnchors[lineByGlyph[glyphIndex]]);
    accumulatePair(candidates.postNarrowSliceRelative, referenceX, referenceY, sliceAnchors[sliceByGlyph[glyphIndex]]);
  }

  return Object.freeze({
    glyphs: layout.glyphCount,
    clusters: new Set(layout.clusters).size,
    lines: layout.lineCount,
    slices: slices.length,
    maximumGlyphsPerSlice: slices.reduce((result, { glyphCount }) => Math.max(result, glyphCount), 0),
    coordinateRange: Object.freeze({
      minimumX: minimum(layout.x),
      maximumX: maximum(layout.x),
      minimumY: minimum(layout.y),
      maximumY: maximum(layout.y),
    }),
    candidates: Object.freeze(candidates),
  });
}

export function reconstructPostNarrowRelative(absolute, anchor) {
  if (!Number.isFinite(absolute) || !Number.isFinite(anchor)) {
    throw new RangeError('absolute coordinate and anchor must be finite');
  }
  const local = Math.fround(absolute - anchor);
  const reconstructed = Math.fround(local + Math.fround(anchor));
  if (!Number.isFinite(reconstructed)) throw new RangeError('reconstructed coordinate must fit finite f32');
  return reconstructed;
}

function observableSlices(layout) {
  const slices = [];
  for (let lineIndex = 0; lineIndex < layout.lineCount; lineIndex += 1) {
    const lineStart = layout.lineGlyphStarts[lineIndex];
    const lineEnd = lineStart + layout.lineGlyphCounts[lineIndex];
    let sliceStart = lineStart;
    for (let glyphIndex = lineStart + 1; glyphIndex < lineEnd; glyphIndex += 1) {
      const clusterBoundary = layout.clusters[glyphIndex] !== layout.clusters[glyphIndex - 1];
      const topologyChanged =
        layout.glyphFontSlots[glyphIndex] !== layout.glyphFontSlots[sliceStart] ||
        layout.glyphBidiLevels[glyphIndex] !== layout.glyphBidiLevels[sliceStart] ||
        layout.glyphFontSizes[glyphIndex] !== layout.glyphFontSizes[sliceStart];
      if (clusterBoundary && topologyChanged) {
        slices.push(slice(lineIndex, sliceStart, glyphIndex));
        sliceStart = glyphIndex;
      }
    }
    if (sliceStart < lineEnd) slices.push(slice(lineIndex, sliceStart, lineEnd));
  }
  return slices;
}

function slice(lineIndex, glyphStart, glyphEnd) {
  return Object.freeze({ lineIndex, glyphStart, glyphCount: glyphEnd - glyphStart });
}

function lineIndexByGlyph(layout) {
  const indices = new Uint32Array(layout.glyphCount);
  for (let lineIndex = 0; lineIndex < layout.lineCount; lineIndex += 1) {
    const start = layout.lineGlyphStarts[lineIndex];
    indices.fill(lineIndex, start, start + layout.lineGlyphCounts[lineIndex]);
  }
  return indices;
}

function sliceIndexByGlyph(glyphCount, slices) {
  const indices = new Uint32Array(glyphCount);
  for (const [sliceIndex, entry] of slices.entries()) {
    indices.fill(sliceIndex, entry.glyphStart, entry.glyphStart + entry.glyphCount);
  }
  return indices;
}

function emptyErrorSummary() {
  return {
    coordinates: 0,
    bitMismatches: 0,
    maximumAbsoluteError: 0,
    maximumUlpError: 0,
  };
}

function accumulatePair(summary, referenceX, referenceY, anchor) {
  accumulateCoordinate(summary, referenceX, anchor.x);
  accumulateCoordinate(summary, referenceY, anchor.y);
}

function accumulateCoordinate(summary, reference, anchor) {
  const reconstructed = reconstructPostNarrowRelative(reference, anchor);
  const absoluteError = Math.abs(reference - reconstructed);
  const ulpError = float32UlpDistance(reference, reconstructed);
  summary.coordinates += 1;
  if (float32Bits(reference) !== float32Bits(reconstructed)) summary.bitMismatches += 1;
  summary.maximumAbsoluteError = Math.max(summary.maximumAbsoluteError, absoluteError);
  summary.maximumUlpError = Math.max(summary.maximumUlpError, ulpError);
}

function minimum(values) {
  return values.length === 0 ? 0 : values.reduce((result, value) => Math.min(result, value), Infinity);
}

function maximum(values) {
  return values.length === 0 ? 0 : values.reduce((result, value) => Math.max(result, value), -Infinity);
}
