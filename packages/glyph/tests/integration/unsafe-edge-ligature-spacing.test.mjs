import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { bitmap, glyph, span, txt } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { decorationSchema } from '../../dist/three/codec.js';
import { loadFont } from '../../dist/loader.js';

// CrossSpace5 ligates `f i` -> f_i and widens it after a space (`space f_i' -> f_i.init`): a line starting at "fi"
// opens with a corrected edge island whose `i` cluster owns no glyph, yet the correction priced its letter spacing.
const fontUrl = new URL('../../../../benches/fixtures/rendering/cross-space-5-bitmap-16.font.glb', import.meta.url);
const text = 'the big office find five fish and a fine fig fit for fifty';
const letterSpacing = 3;

test('a corrected line start whose island holds a ligature spaces its glyphless cluster like the paragraph does', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  t.after(() => font.dispose());
  // A root spans one scene, and a speculative query holds its frame back: every measurement gets its own root.
  let roots = 0;
  const paragraph = (layout, constraints) => {
    const root = glyph.handle(`three:integration:unsafe-edge-ligature-spacing:${String(roots++)}`, defineThreeConfig());
    const label = root.createText({
      font,
      text: txt`${span({ decoration: { underline: true } })`${text}`}`,
      style: { fontSize: 24, letterSpacing },
      layout,
      constraints,
    });
    t.after(() => {
      label.dispose();
      root.dispose();
    });
    return label;
  };
  const flat = paragraph({ wrap: 'none' }, {}).glyphs();
  const at = Array.from(flat.clusters).indexOf(text.indexOf('fi'));
  // One ligature glyph plus the spacing of both clusters it covers: the paragraph's own width for "fi".
  const ligatureSpan = flat.x[at + 1] - flat.x[at];

  let checked = 0;
  for (const width of [160, 200, 240]) {
    const label = paragraph({ wrap: 'word' }, { width: { mode: 'exact', size: width } });
    const scene = new THREE.Scene();
    scene.add(label);
    scene.updateMatrixWorld(true);
    const glyphs = label.glyphs();
    const decoration = scene
      .getObjectByName('@pmndrs/glyph:anonymous')
      .children.find((draw) => draw.userData.pmndrsGlyphPrimitiveKind === 'decoration');
    const rects = decoration.geometry.getAttribute(`_pmndrsGlyph_${decorationSchema.buffers.rect.id}`);
    const first = decoration.userData.pmndrsGlyphRunStart;
    glyphs.lineTextStarts.forEach((start, line) => {
      if (!text.startsWith('fi', start)) return;
      const from = glyphs.lineGlyphStarts[line];
      const last = from + glyphs.lineGlyphCounts[line] - 1;
      const name = `width ${String(width)}: "${text.slice(start, glyphs.lineTextEnds[line])}"`;
      const body = glyphs.x[from + 1] - glyphs.x[from];
      assert.ok(
        Math.abs(body - ligatureSpan) < 0.05,
        `${name} lays its body ${String(body)} after the ligature, not ${String(ligatureSpan)}`,
      );
      const covered = glyphs.x[last] + glyphs.glyphAdvances[last] + letterSpacing - glyphs.x[from];
      const underlined = rects.getZ(first + line);
      assert.ok(
        Math.abs(underlined - covered) < 0.05,
        `${name} underlines ${String(underlined)} of ${String(covered)}`,
      );
      checked += 1;
    });
  }
  assert.equal(checked > 0, true, 'the fixture wraps at the ligature');
});
