/**
 * Reads what a caller's Three material is given about each glyph, the way its vertex stage does: the glyph-index lane
 * and the glyph-origin lane of every record a draw holds, with the origin moved by the record's placement slot.
 */
import { slugSchema } from '@pmndrs/glyph/core';

import { threeSystemBuffers } from '../../dist/three/codec.js';

const lane = (declaration) => `_pmndrsGlyph_${declaration.id}`;

/** The storage attributes a node graph reads, in traversal order. */
function storageAttributes(node) {
  const attributes = new Set();
  node.traverse((child) => {
    if (child.isStorageBufferNode === true) attributes.add(child.value);
  });
  return [...attributes];
}

/** The session placement table: the one `vec2` table `glyphOrigin` reads besides a draw's origin lane. */
function placementTable(glyphOrigin, originLanes) {
  const tables = storageAttributes(glyphOrigin).filter(
    (attribute) => !originLanes.has(attribute) && attribute.itemSize === 2 && attribute.array instanceof Float32Array,
  );
  if (tables.length !== 1) throw new Error(`glyphOrigin reads ${tables.length} placement tables, expected one`);
  return tables[0].array;
}

/**
 * Every glyph record under `root` as `{ draw, index, stableId, x, y }`, with `x`/`y` in layout space (y down): what
 * `glyphIndex` and `glyphOrigin` evaluate to for that record, before `glyphOrigin` negates y. `glyphOrigin` is the node
 * a material context of this root was given.
 */
export function drawnGlyphFacts(root, glyphOrigin) {
  const facts = [];
  const draws = [];
  root.traverse((object) => {
    if (object.isMesh === true && object.geometry.getAttribute(lane(threeSystemBuffers.glyphIndex)) !== undefined) {
      draws.push(object);
    }
  });
  const originLanes = new Set(draws.map((mesh) => mesh.geometry.getAttribute(lane(threeSystemBuffers.glyphOrigin))));
  const table = placementTable(glyphOrigin, originLanes);
  for (const [draw, mesh] of draws.entries()) {
    const geometry = mesh.geometry;
    const start = mesh.userData.pmndrsGlyphRunStart ?? 0;
    const indices = geometry.getAttribute(lane(threeSystemBuffers.glyphIndex)).array;
    const origins = geometry.getAttribute(lane(threeSystemBuffers.glyphOrigin));
    const stableIds = geometry.getAttribute(lane(threeSystemBuffers.stableGlyphId)).array;
    const slotLane = geometry.getAttribute(lane(threeSystemBuffers.placementSlot));
    // Three packs Slug's placement slot into the second component of its glyph lane.
    const slugLane = geometry.getAttribute(lane(slugSchema.buffers.glyph));
    const slot = (record) => (slotLane === undefined ? slugLane.array[record * 2 + 1] : slotLane.array[record]);
    for (let record = start; record < start + geometry.instanceCount; record += 1) {
      facts.push({
        draw,
        index: indices[record],
        stableId: stableIds[record],
        x: origins.array[record * 2] + table[slot(record) * 2],
        y: origins.array[record * 2 + 1] + table[slot(record) * 2 + 1],
      });
    }
  }
  return facts;
}
