import * as THREE from 'three/webgpu';

import type { PortableResourceGroupPayload } from '../../config/resources.js';
import { slugSchema } from '../../raster/slug.js';
import { SLUG_RESIDENT_BAND_CURVE_WIDTH, SlugBandResidency } from '../../raster/internal/slug-residency.js';
import type { RetainedBuffer } from './host-buffer.js';
import { bufferMember, dataTexture, ownedUint32, textureMember } from './portable-resource.js';
import type { RetainedSlugPage } from './renderer-resources.js';
import { slugGlyphTable } from './slug-glyph-table.js';

/**
 * Realizes one Slug page whose band curves start empty. The header grid is uploaded whole; a glyph's band entries are
 * resolved into the band-curve texture, and its table row pointed at them, the first time a publication commits an
 * instance of it (see `syncSlugDraws`), before the frame that draws it.
 */
export function createSlugPage(data: PortableResourceGroupPayload): RetainedSlugPage {
  const headers = textureMember(data, 'headers', 'r32uint', 'Slug');
  const headerBytes = ownedUint32(headers.bytes);
  const headerTexture = dataTexture(
    headerBytes,
    headers.width,
    headers.height,
    THREE.RedIntegerFormat,
    THREE.UnsignedIntType,
  );
  const residency = new SlugBandResidency(
    bufferMember(data, 'curves', 'Slug').bytes,
    bufferMember(data, 'references', 'Slug').bytes,
    bufferMember(data, 'glyphs', 'Slug').bytes,
  );
  const bandCurveTexture = dataTexture(
    residency.entries,
    SLUG_RESIDENT_BAND_CURVE_WIDTH,
    residency.lines,
    THREE.RGBAIntegerFormat,
    THREE.UnsignedIntType,
  );
  const glyphTable = slugGlyphTable(residency.table);
  return {
    headerTexture,
    headerWidth: headers.width,
    bandCurveTexture,
    bandCurveWidth: SLUG_RESIDENT_BAND_CURVE_WIDTH,
    glyphTable,
    get byteLength() {
      return headerBytes.byteLength + residency.entries.byteLength + glyphTable.byteLength;
    },
    use(lane, start, end, stride) {
      const admission = residency.use(lane, start, end, stride);
      if (admission === undefined) return;
      if (admission.grew) {
        // A texture cannot change size in place: release the GPU copy and let the next frame rebuild it.
        bandCurveTexture.dispose();
        bandCurveTexture.image = {
          data: residency.entries,
          width: SLUG_RESIDENT_BAND_CURVE_WIDTH,
          height: residency.lines,
        };
      }
      bandCurveTexture.needsUpdate = true;
      for (const row of admission.rows) glyphTable.write(residency.table, row);
    },
    dispose() {
      headerTexture.dispose();
      bandCurveTexture.dispose();
      glyphTable.texture.dispose();
    },
  };
}

const pageByMaterial = new WeakMap<THREE.Material, RetainedSlugPage>();

/** Records which page every draw of `material` reads. */
export function registerSlugPageUse(material: THREE.NodeMaterial, page: RetainedSlugPage): void {
  pageByMaterial.set(material, page);
}

/** What the publication pass reads for one Slug draw; the lane belongs to the draw, which is rebuilt with its buffers. */
interface SlugDrawState {
  readonly page: RetainedSlugPage;
  /** `[glyph table row, placement slot]` per instance. */
  readonly glyphs: RetainedBuffer;
}

/** Remembers a new Slug draw's page and glyph lane. */
export function attachSlugDrawState(
  mesh: THREE.Mesh,
  material: THREE.Material,
  lanes: ReadonlyMap<RetainedBuffer['codecBufferId'], RetainedBuffer>,
): void {
  const page = pageByMaterial.get(material);
  const glyphs = lanes.get(slugSchema.buffers.glyph.id);
  if (page === undefined || glyphs === undefined) return;
  const state: SlugDrawState = { page, glyphs };
  mesh.userData.pmndrsGlyphSlug = state;
}

type Publication = Readonly<{
  draws: { readonly changed: boolean };
  bufferMutations: { readonly uploads: readonly { readonly buffer: RetainedBuffer }[] };
}>;

/**
 * Makes resident the glyphs of every Slug draw whose glyph lane a publication wrote (or of every draw, when it
 * replaced them), before the frame that first shows them.
 */
export function syncSlugDraws(draws: readonly THREE.Mesh[], publication: Publication): void {
  const written = writtenLanes(publication);
  if (written === null) return;
  for (const mesh of draws) {
    const state = mesh.userData.pmndrsGlyphSlug as SlugDrawState | undefined;
    if (state !== undefined && (written === undefined || written.has(state.glyphs))) admitDraw(mesh, state);
  }
}

/** The lanes a publication wrote; undefined when it replaced every draw, null when it changed nothing. */
function writtenLanes(publication: Publication): ReadonlySet<RetainedBuffer> | undefined | null {
  if (publication.draws.changed) return undefined;
  const uploads = publication.bufferMutations.uploads;
  return uploads.length === 0 ? null : new Set(uploads.map(({ buffer }) => buffer));
}

function admitDraw(mesh: THREE.Mesh, state: SlugDrawState): void {
  const start = (mesh.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
  const end = start + (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
  state.page.use(state.glyphs.array as Uint32Array, start, end, state.glyphs.vectorWidth);
}
