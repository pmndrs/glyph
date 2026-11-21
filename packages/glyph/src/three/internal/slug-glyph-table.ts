import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { SLUG_GLYPH_TABLE_STRIDE } from '../../raster/slug.js';
import { dataTexture } from './portable-resource.js';

/** Glyph rows per line of the table texture. */
const ROWS_PER_LINE = 256;
/** `rgba32uint` texels per glyph row. */
const TEXELS_PER_ROW = SLUG_GLYPH_TABLE_STRIDE / 4;

/** One Slug page's glyph table as an `rgba32uint` texture: four texels per row, `rowsPerLine` rows per texture line. */
export interface SlugGlyphTable {
  readonly texture: THREE.DataTexture;
  readonly rowsPerLine: number;
  readonly byteLength: number;
  /** Copies row `row` of `table` into the texture and schedules its upload. */
  write(table: Uint32Array, row: number): void;
}

/** The per-glyph constants of one table row, resolved to nodes. */
export interface SlugGlyphRow {
  /** Em-space quad `(left, top, width, height)`. */
  readonly quad: THREE.Node<'vec4'>;
  /** Band transform `(scaleX, scaleY, offsetX, offsetY)`. */
  readonly band: THREE.Node<'vec4'>;
  /** `(curveBase, horizontalHeaderBase, verticalHeaderBase, referenceBase)`. */
  readonly starts: THREE.Node<'uvec4'>;
  /** `(horizontalBands, verticalBands)`. */
  readonly counts: THREE.Node<'uvec2'>;
}

/** Realizes a page's glyph table from its rows of sixteen words. */
export function slugGlyphTable(table: Uint32Array): SlugGlyphTable {
  const rows = table.length / SLUG_GLYPH_TABLE_STRIDE;
  const rowsPerLine = Math.min(ROWS_PER_LINE, Math.max(1, rows));
  const lines = Math.max(1, Math.ceil(rows / rowsPerLine));
  const words = new Uint32Array(rowsPerLine * lines * SLUG_GLYPH_TABLE_STRIDE);
  words.set(table);
  const texture = dataTexture(
    words,
    rowsPerLine * TEXELS_PER_ROW,
    lines,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
  );
  return {
    texture,
    rowsPerLine,
    byteLength: words.byteLength,
    write(source, row) {
      const start = row * SLUG_GLYPH_TABLE_STRIDE;
      words.set(source.subarray(start, start + SLUG_GLYPH_TABLE_STRIDE), start);
      texture.needsUpdate = true;
    },
  };
}

/** Reads one glyph's row; meant for the vertex stage, whose outputs the fragment receives as varyings. */
export function slugGlyphRow(table: SlugGlyphTable, row: THREE.Node<'uint'>): SlugGlyphRow {
  const index = TSL.int(row);
  const origin = TSL.ivec2(index.mod(table.rowsPerLine).mul(TEXELS_PER_ROW), index.div(table.rowsPerLine)).toVar(
    'slugGlyphRowOrigin',
  );
  // Three 0.185.1 types `textureLoad` as a float load; on an integer texture it returns `uvec4`.
  const texel = (column: number) =>
    TSL.textureLoad(table.texture, origin.add(TSL.ivec2(column, 0))) as unknown as THREE.Node<'uvec4'>;
  return {
    quad: floatBits(texel(0)),
    band: floatBits(texel(1)),
    starts: texel(2),
    counts: texel(3).xy,
  };
}

/** Three 0.185.1's GLSL builder names only scalar bitcasts, so a vector is reinterpreted one component at a time. */
function floatBits(bits: THREE.Node<'uvec4'>): THREE.Node<'vec4'> {
  const component = (value: THREE.Node<'uint'>) => TSL.uintBitsToFloat(value) as unknown as THREE.Node<'float'>;
  return TSL.vec4(component(bits.x), component(bits.y), component(bits.z), component(bits.w));
}
