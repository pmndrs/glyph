import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bitmap, glyph } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

/** Fixture fonts the physics tests bake with outlines; Dancing Script is CFF, the others TrueType. */
const FONT_SOURCES = {
  'dancing-script': '../../../../fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf',
  inter: '../../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
  'source-serif-4': '../../../../fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf',
} as const;

export type OutlinedFontFixture = keyof typeof FONT_SOURCES;

type OutlinedFont = Awaited<ReturnType<typeof bakeOutlinedFont>>;

const bakes = new Map<OutlinedFontFixture, Promise<OutlinedFont>>();
let nextHandle = 1;

async function bakeOutlinedFont(fixture: OutlinedFontFixture) {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-physics-font-'));
  try {
    const output = join(directory, `${fixture}.font.glb`);
    await bakeFont({
      input: new URL(FONT_SOURCES[fixture], import.meta.url),
      output,
      font: { fontFaceIndex: 0, outlines: true },
      rasters: [{ baker: bitmapBaker, packaging: { artifact: 'embedded' }, options: { strikes: [16] } }],
    });
    const face = glyph.fontFace(new Blob([new Uint8Array(await readFile(output))], { type: 'model/gltf-binary' }), {
      format: bitmap({ strikes: [16] }),
    });
    await face.load();
    return face;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

/** Bakes a fixture font with outlines once per test file; the same face is shared by every paragraph. */
export function outlinedFont(fixture: OutlinedFontFixture): Promise<OutlinedFont> {
  let baked = bakes.get(fixture);
  if (baked === undefined) {
    baked = bakeOutlinedFont(fixture);
    bakes.set(fixture, baked);
  }
  return baked;
}

/** Commits a paragraph on an outlined font and breaks it apart, exactly as the workload does; spaces have no outline and are not in `glyphs`. */
export async function breakApartParagraph(
  fixture: OutlinedFontFixture,
  source: string,
  fontSize: number,
  width?: number,
) {
  const font = await outlinedFont(fixture);
  await glyph.init();
  const handle = glyph.handle(`glyph-physics:test:${String(nextHandle++)}`, ThreeConfig);
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  const text = handle.createText({
    font,
    text: source,
    style: { fontSize },
    ...(width === undefined
      ? {}
      : { constraints: { width: { mode: 'exact', size: width } }, layout: { wrap: 'word' } }),
  });
  scene.add(group);
  group.add(text);
  scene.updateMatrixWorld(true);
  if (group.error !== undefined) throw group.error;
  const [glyphs] = text.breakApart();
  scene.add(glyphs);
  scene.updateMatrixWorld(true);
  return {
    dispose() {
      glyphs.dispose();
      text.dispose();
      group.dispose();
      handle.dispose();
    },
    glyphs,
    text,
  };
}
