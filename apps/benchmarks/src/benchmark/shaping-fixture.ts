import type { RegisteredFont, ShapeBatchRequest, ShapedBatchViews } from '@pmndrs/text';

export interface ShapingOracleCase {
  readonly id: string;
  readonly text: string;
  readonly segment: {
    readonly direction: 'ltr' | 'rtl';
    readonly script: string;
    readonly language: string;
    readonly features: readonly string[];
  };
  readonly glyphs: readonly {
    readonly glyphId: number;
    readonly cluster: number;
    readonly xAdvance: number;
    readonly yAdvance: number;
    readonly xOffset: number;
    readonly yOffset: number;
    readonly flags: number;
  }[];
}

export function shapingFixtureBatch(
  cases: readonly ShapingOracleCase[],
  font: RegisteredFont['handle'],
): ShapeBatchRequest {
  const codeUnits: number[] = [];
  const features: { tag: string; value: number; start: number; end: number }[] = [];
  const runs: ShapeBatchRequest['runs'][number][] = [];
  for (const fixture of cases) {
    const start = codeUnits.length;
    for (let index = 0; index < fixture.text.length; index += 1) {
      codeUnits.push(fixture.text.charCodeAt(index));
    }
    const end = codeUnits.length;
    const featureStart = features.length;
    for (const source of fixture.segment.features) {
      const match = /^(.{4})(?:=(\d+))?$/.exec(source);
      if (match === null) throw new Error(`unsupported shaping fixture feature ${source}`);
      features.push({
        tag: match[1]!,
        value: match[2] === undefined ? 1 : Number(match[2]),
        start,
        end,
      });
    }
    runs.push({
      font,
      textStart: start,
      textEnd: end,
      direction: fixture.segment.direction,
      script: fixture.segment.script,
      language: fixture.segment.language,
      clusterLevel: 0,
      flags: 0x40,
      featureStart,
      featureCount: features.length - featureStart,
    });
  }
  return { textUtf16: Uint16Array.from(codeUnits), runs, features };
}

export function assertShapingFixture(
  shaped: ShapedBatchViews,
  font: RegisteredFont['handle'],
  cases: readonly ShapingOracleCase[],
): void {
  exactArray('fontHandles', shaped.fontHandles, [font]);
  exactArray(
    'runFontSlots',
    shaped.runFontSlots,
    cases.map(() => 0),
  );
  let glyphStart = 0;
  let textStart = 0;
  for (const [run, fixture] of cases.entries()) {
    if (shaped.runGlyphStarts[run] !== glyphStart) {
      throw new Error(`shaping fixture ${fixture.id} has an unexpected glyph start`);
    }
    if (shaped.runGlyphCounts[run] !== fixture.glyphs.length) {
      throw new Error(`shaping fixture ${fixture.id} has an unexpected glyph count`);
    }
    for (const [local, expected] of fixture.glyphs.entries()) {
      const glyph = glyphStart + local;
      exactValue(fixture.id, 'glyphId', local, shaped.glyphIds[glyph], expected.glyphId);
      exactValue(fixture.id, 'cluster', local, shaped.clusters[glyph], expected.cluster + textStart);
      exactValue(fixture.id, 'xAdvance', local, shaped.xAdvances[glyph], expected.xAdvance);
      exactValue(fixture.id, 'yAdvance', local, shaped.yAdvances[glyph], expected.yAdvance);
      exactValue(fixture.id, 'xOffset', local, shaped.xOffsets[glyph], expected.xOffset);
      exactValue(fixture.id, 'yOffset', local, shaped.yOffsets[glyph], expected.yOffset);
      exactValue(fixture.id, 'flags', local, shaped.glyphFlags[glyph], expected.flags);
    }
    glyphStart += fixture.glyphs.length;
    textStart += fixture.text.length;
  }
  if (glyphStart !== shaped.glyphIds.length) {
    throw new Error('shaping output contains trailing glyphs outside the pinned corpus');
  }
}

export function shapedFixtureBytes(shaped: ShapedBatchViews): number {
  return shapingArrays(shaped).reduce((sum, values) => sum + values.byteLength, 0);
}

export function hashShapedFixture(shaped: ShapedBatchViews): string {
  let hash = 2_166_136_261;
  for (const values of shapingArrays(shaped)) {
    hash = Math.imul(hash ^ values.length, 16_777_619);
    for (let index = 0; index < values.length; index += 1) {
      hash = Math.imul(hash ^ (values[index]! >>> 0), 16_777_619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function shapingArrays(shaped: ShapedBatchViews): readonly (Uint16Array | Uint32Array | Int32Array)[] {
  return [
    shaped.fontHandles,
    shaped.runFontSlots,
    shaped.runGlyphStarts,
    shaped.runGlyphCounts,
    shaped.glyphIds,
    shaped.clusters,
    shaped.xAdvances,
    shaped.yAdvances,
    shaped.xOffsets,
    shaped.yOffsets,
    shaped.glyphFlags,
  ];
}

function exactArray(label: string, actual: ArrayLike<number>, expected: readonly number[]): void {
  if (actual.length !== expected.length) throw new Error(`${label} length differs from its fixture`);
  for (let index = 0; index < expected.length; index += 1) {
    exactValue('batch', label, index, actual[index], expected[index]);
  }
}

function exactValue(
  fixture: string,
  field: string,
  index: number,
  actual: number | undefined,
  expected: number | undefined,
): void {
  if (actual !== expected) {
    throw new Error(`shaping fixture ${fixture}.${field}[${index}] differs: ${String(actual)} !== ${String(expected)}`);
  }
}
