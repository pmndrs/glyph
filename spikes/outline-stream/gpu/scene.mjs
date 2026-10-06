// Instance data for the glyph grid and the magnified single-glyph view. Both variants and both backends draw the
// same instance buffer; only the curve fetch (and the coordinate scale uniform) differs between A and B.
//
// Per instance, 68 bytes:
//   rect     f32x4  quad top-left and size in pixels (y down)
//   em       f32x4  em-space quad origin (minX, maxY) and size, y up
//   band     f32x4  em-space band transform (scaleX, scaleY, offsetX, offsetY): band = coord * scale + offset
//   invScale f32    ems per pixel, carries the dilation offset into em space
//   glyph    u32x4  curveBase, pointBase, bandBase, hBands | vBands << 16
export const INSTANCE_STRIDE = 68;

export const GRID_SIZES = [12, 32, 128, 512];

/** Glyphs the grid cycles through: every glyph with bands and a non-empty box, in asset order. */
export function drawableGlyphs(asset) {
  return asset.glyphs.filter(
    (g) => g.hBands > 0 && g.vBands > 0 && g.bounds[2] > g.bounds[0] && g.bounds[3] > g.bounds[1],
  );
}

function writeInstance(view, index, glyph, unitsPerEm, penX, baselineY, pixelsPerEm) {
  const o = index * INSTANCE_STRIDE;
  const [minX, minY, maxX, maxY] = glyph.bounds.map((v) => v / unitsPerEm);
  const width = maxX - minX;
  const height = maxY - minY;
  const scaleX = width > 0 ? glyph.vBands / width : 0;
  const scaleY = height > 0 ? glyph.hBands / height : 0;
  const values = [
    penX + minX * pixelsPerEm,
    baselineY - maxY * pixelsPerEm,
    width * pixelsPerEm,
    height * pixelsPerEm,
    minX,
    maxY,
    width,
    height,
    scaleX,
    scaleY,
    -minX * scaleX,
    -minY * scaleY,
    1 / pixelsPerEm,
  ];
  values.forEach((v, k) => view.setFloat32(o + k * 4, v, true));
  view.setUint32(o + 52, glyph.curveBase, true);
  view.setUint32(o + 56, glyph.pointBase, true);
  view.setUint32(o + 60, glyph.bandBase, true);
  view.setUint32(o + 64, (glyph.hBands | (glyph.vBands << 16)) >>> 0, true);
}

/** The drawable glyphs repeated in reading order until the canvas is full, at `pixelsPerEm`. */
export function buildGrid(asset, pixelsPerEm, width, height) {
  const glyphs = drawableGlyphs(asset);
  if (glyphs.length === 0) throw new Error('asset has no drawable glyphs');
  const upem = asset.unitsPerEm;
  // Set like text when the asset carries metrics (ascender/descender line pitch, advance widths); otherwise pack
  // ink boxes. Zero-advance glyphs (combining marks) fall back to their ink width so they do not stack.
  const metrics = asset.ascender !== null && asset.descender !== null;
  const top = (metrics ? asset.ascender : Math.max(...glyphs.map((g) => g.bounds[3]))) / upem;
  const bottom = (metrics ? asset.descender : Math.min(...glyphs.map((g) => g.bounds[1]))) / upem;
  const gap = 0.08;
  const pitch = (top - bottom + (metrics ? 0 : gap)) * pixelsPerEm;
  const margin = Math.max(2, gap * pixelsPerEm);
  const placements = [];
  let baseline = margin + top * pixelsPerEm;
  let next = 0;
  // At least one row, even when a line is taller than the canvas (512 px/em on a small canvas): it is clipped.
  while (placements.length === 0 || baseline - bottom * pixelsPerEm <= height) {
    let pen = margin;
    let placedInRow = 0;
    for (;;) {
      const glyph = glyphs[next % glyphs.length];
      const [minX, , maxX] = glyph.bounds.map((v) => v / upem);
      const byAdvance = glyph.advance !== null && glyph.advance > 0;
      const origin = byAdvance ? pen : pen - minX * pixelsPerEm;
      if (origin + maxX * pixelsPerEm > width - margin && placedInRow > 0) break;
      placements.push([glyph, origin, baseline]);
      placedInRow += 1;
      next += 1;
      pen += byAdvance ? (glyph.advance / upem) * pixelsPerEm : (maxX - minX + gap) * pixelsPerEm;
    }
    baseline += pitch;
  }
  return pack(asset, placements, pixelsPerEm, `grid ${pixelsPerEm}px`);
}

/** One glyph filling 90% of the canvas, centred. */
export function buildMagnified(asset, glyph, width, height) {
  const upem = asset.unitsPerEm;
  const [minX, minY, maxX, maxY] = glyph.bounds.map((v) => v / upem);
  const pixelsPerEm = 0.9 * Math.min(width / (maxX - minX), height / (maxY - minY));
  const penX = (width - (maxX - minX) * pixelsPerEm) / 2 - minX * pixelsPerEm;
  const baseline = (height - (maxY - minY) * pixelsPerEm) / 2 + maxY * pixelsPerEm;
  return pack(asset, [[glyph, penX, baseline]], pixelsPerEm, `magnified ${glyph.name}`);
}

function pack(asset, placements, pixelsPerEm, label) {
  const data = new ArrayBuffer(Math.max(1, placements.length) * INSTANCE_STRIDE);
  const view = new DataView(data);
  placements.forEach(([glyph, pen, baseline], i) =>
    writeInstance(view, i, glyph, asset.unitsPerEm, pen, baseline, pixelsPerEm),
  );
  return { data, count: placements.length, pixelsPerEm, label };
}

/** Clip-space rows for pixel coordinates with y up (object y = -pixel y), as the dilation expects. */
export function projectionUniforms(width, height) {
  return {
    row0: [2 / width, 0, 0, -1],
    row1: [0, 2 / height, 0, 1],
    row3: [0, 0, 0, 1],
    viewport: [width, height],
  };
}
