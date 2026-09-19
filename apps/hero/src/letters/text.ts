import type { Glyphs, Text } from '@pmndrs/glyph/three';
import { mat4, vec3 } from 'math';
import { Matrix4 } from 'three/webgpu';

/** Full glyph records plus prefix centering, owned for the lifetime of the mounted line. */
export function createRetainedLine(source: Pick<Text<never>, 'text' | 'glyphs' | 'breakApart' | 'parent' | 'visible'>) {
  const layout = source.glyphs();
  const full = source.text;
  const prefixOffsets = new Float32Array(full.length + 1);
  const [glyphs, decorations] = source.breakApart();
  decorations?.dispose();
  source.parent?.add(glyphs);
  source.visible = false;

  try {
    for (let count = 1; count < full.length; count++) {
      source.text = full.slice(0, count);
      prefixOffsets[count] = source.glyphs().x[0]! - layout.x[0]!;
    }
  } catch (error) {
    glyphs.dispose();
    throw error;
  } finally {
    source.text = full;
  }

  const records = glyphs.measurements.map((glyph) => {
    const original = mat4.create();
    glyph.originalMatrix.toArray(original);
    const bounds = glyph.localInkBounds;

    return {
      index: glyph.index,
      cluster: glyphs.glyphAt(glyph.index)!.cluster,
      original,
      center: vec3.fromValues(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      ),
      empty: bounds.isEmpty(),
    };
  });

  return {
    glyphs,
    records,
    prefixOffsets,
    count: -1,
    transform: mat4.create(),
    draw: new Matrix4(),
    hidden: new Matrix4().makeScale(0, 0, 0),
  };
}

export type RetainedLine = ReturnType<typeof createRetainedLine>;

/** Show a centred prefix without shaping, React updates, or allocation. */
export function showLine(line: RetainedLine, count: number): void {
  if (count === line.count) return;

  line.count = count;
  const shift = line.prefixOffsets[count]!;

  for (let index = 0; index < line.records.length; index++) {
    const glyph = line.records[index]!;

    if (glyph.cluster >= count) line.glyphs.setMatrixAt(glyph.index, line.hidden);
    else {
      mat4.copy(line.transform, glyph.original);
      line.transform[12] += shift;
      line.glyphs.setMatrixAt(glyph.index, line.draw.fromArray(line.transform));
    }
  }
}

export function resetLine(line: RetainedLine, count: number): void {
  line.count = -1;
  line.glyphs.visible = true;
  showLine(line, count);
}

export function disposeLine(line: { glyphs: Glyphs }): void {
  line.glyphs.dispose();
}
