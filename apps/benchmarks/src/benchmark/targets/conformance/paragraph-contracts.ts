import type {
  LoadedFont,
  ParagraphContentBox,
  ParagraphLayoutInspection,
  ParagraphLayoutPolicy,
  ParagraphStyle,
} from '@pmndrs/glyph';
import { Paragraph } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { FontLoader, Text, TextGroup } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import amiriFontUrl from '../../../../fixtures/rendering/amiri-bitmap-16.font.glb?url';
import cjkFontUrl from '../../../../fixtures/rendering/noto-sans-cjk-contract-bitmap-16.font.glb?url';
import interFontUrl from '../../../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import bidiContractJson from '../../../../fixtures/contracts/paragraph-bidi-layout-v0.json' with { type: 'json' };
import cjkContractJson from '../../../../fixtures/contracts/paragraph-cjk-layout-v0.json' with { type: 'json' };
import type { BenchmarkTarget } from '../../contracts';
import { exactValue } from '../../exact-value';
import { paragraphCjkCoverageText } from '../../paragraph-contract-corpus';
import { hashParagraphLayouts, paragraphLayoutBytes, paragraphLayoutContract } from '../../paragraph-layout-digest';
import { createUikitLayoutFixture, YogaMeasureMode } from '../../uikit-layout-fixture';

type BitmapFont = LoadedFont<typeof bitmap>;

interface LegacyAxis {
  readonly mode: 'unconstrained' | 'at-most' | 'exactly';
  readonly size?: number;
}

interface LegacyConstraints {
  readonly width?: LegacyAxis;
  readonly height?: LegacyAxis;
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
}

interface LayoutGolden {
  readonly measurement: Readonly<Record<string, unknown>>;
  readonly hash: string;
  readonly [field: string]: unknown;
}

interface ParagraphFixture {
  readonly text: string;
  readonly style: ParagraphStyle;
  readonly constraints: LegacyConstraints;
  readonly layout: LayoutGolden;
}

interface BidiContract {
  readonly bidi: Readonly<Record<string, ParagraphFixture>>;
  readonly policies: {
    readonly text: string;
    readonly style: ParagraphStyle;
    readonly cases: Readonly<
      Record<string, { readonly constraints: LegacyConstraints; readonly layout: LayoutGolden }>
    >;
  };
  readonly uikit: {
    readonly input: { readonly text: string; readonly style: ParagraphStyle };
    readonly policy: LegacyConstraints;
    readonly customLayouting: Readonly<Record<string, unknown>>;
    readonly measurements: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly resolved: {
      readonly outerSize: readonly [number, number];
      readonly padding: readonly [number, number, number, number];
      readonly border: readonly [number, number, number, number];
      readonly contentBox: Readonly<Record<string, unknown>>;
      readonly centeredX: readonly number[];
      readonly centeredY: readonly number[];
      readonly layout: LayoutGolden;
    };
  };
}

interface CjkContract {
  readonly constraints: Readonly<Record<string, LegacyConstraints>>;
  readonly cases: Readonly<
    Record<
      string,
      {
        readonly text: string;
        readonly style: ParagraphStyle;
        readonly layouts: Readonly<Record<string, LayoutGolden>>;
      }
    >
  >;
}

type State =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly loader: FontLoader;
      readonly inter: BitmapFont;
      readonly amiri: BitmapFont;
      readonly cjk: BitmapFont;
    };

const bidiContract = bidiContractJson as unknown as BidiContract;
const cjkContract = cjkContractJson as unknown as CjkContract;

export function createParagraphContractsConformanceTarget(): BenchmarkTarget {
  let state: State = { kind: 'empty' };
  return {
    id: 'paragraph-contracts',
    label: 'Rust paragraph contracts',
    detail: 'bidi · policies · uikit seam · full CJK corpus · public Text',
    color: 'violet',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (_controls, context) => {
      if (state.kind === 'ready') return;
      const loader = new FontLoader(new THREE.LoadingManager());
      const fonts: BitmapFont[] = [];
      try {
        const load = (url: string, coverage?: string) =>
          loader.loadAsync({
            input: { baked: url },
            raster: {
              technique: bitmap,
              options: { strikes: [16], ...(coverage === undefined ? {} : { coverage: { text: coverage } }) },
            },
            ...(context?.signal === undefined ? {} : { signal: context.signal }),
          });
        const loaded = await Promise.all([
          load(interFontUrl),
          load(amiriFontUrl),
          load(cjkFontUrl, paragraphCjkCoverageText),
        ]);
        fonts.push(...loaded);
        const [inter, amiri, cjk] = loaded;
        if (inter === undefined || amiri === undefined || cjk === undefined) {
          throw new Error('paragraph contract fonts did not load');
        }
        state = { kind: 'ready', loader, inter, amiri, cjk };
      } catch (error) {
        for (const font of fonts) font.dispose();
        loader.dispose();
        throw error;
      }
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') throw new Error('paragraph contracts target was not loaded');
      return runContracts(state, context?.signal);
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const ready = state;
      state = { kind: 'empty' };
      ready.inter.dispose();
      ready.amiri.dispose();
      ready.cjk.dispose();
      ready.loader.dispose();
    },
  };
}

function runContracts(state: Extract<State, { readonly kind: 'ready' }>, signal: AbortSignal | undefined) {
  const group = new TextGroup({ capacity: { size: 4_096, policy: 'grow' } });
  const texts: Text<typeof bitmap>[] = [];
  const expected: Array<{ readonly id: string; readonly golden: LayoutGolden; readonly full: boolean }> = [];
  const add = (
    id: string,
    font: BitmapFont,
    text: string,
    style: ParagraphStyle,
    constraints: LegacyConstraints,
    golden: LayoutGolden,
    full: boolean,
  ) => {
    const value = new Text({ font, text, style, contentBox: contentBox(constraints) });
    texts.push(value);
    expected.push({ id, golden, full });
    group.add(value);
  };

  for (const [id, fixture] of Object.entries(bidiContract.bidi)) {
    add(`bidi.${id}`, state.amiri, fixture.text, fixture.style, fixture.constraints, fixture.layout, true);
  }
  for (const [id, fixture] of Object.entries(bidiContract.policies.cases)) {
    add(
      `policy.${id}`,
      state.inter,
      bidiContract.policies.text,
      bidiContract.policies.style,
      fixture.constraints,
      fixture.layout,
      false,
    );
  }
  for (const [caseId, fixture] of Object.entries(cjkContract.cases)) {
    for (const [constraintId, constraints] of Object.entries(cjkContract.constraints)) {
      const golden = fixture.layouts[constraintId];
      if (golden === undefined) throw new Error(`CJK contract omitted ${caseId}.${constraintId}`);
      add(`cjk.${caseId}.${constraintId}`, state.cjk, fixture.text, fixture.style, constraints, golden, true);
    }
  }

  let uikitParagraph: Paragraph<typeof bitmap> | undefined;
  try {
    signal?.throwIfAborted();
    group.updateMatrixWorld(true);
    if (group.error !== undefined) throw group.error;
    const layouts = texts.map((text, index) => {
      const layout = text.inspectLayout();
      const contract = expected[index];
      if (layout === undefined || contract === undefined)
        throw new Error('paragraph contract layout was not published');
      assertObject(contract.id, paragraphLayoutContract(layout, contract.full), narrowLayoutGolden(contract.golden));
      return layout;
    });

    // The uikit seam is exercised through the real framework-neutral Paragraph: no scene
    // graph, no adapter. Identical retained goldens prove the Paragraph route agrees with
    // the Text route the contract was generated through.
    uikitParagraph = new Paragraph({
      font: state.inter,
      text: bidiContract.uikit.input.text,
      style: bidiContract.uikit.input.style,
      policy: policy(bidiContract.uikit.policy),
    });
    const uikit = createUikitLayoutFixture(uikitParagraph, policy(bidiContract.uikit.policy));
    const custom = uikit.customLayouting();
    assertObject(
      'uikit.customLayouting',
      { minWidth: custom.minWidth, minHeight: custom.minHeight, firstBaseline: custom.firstBaseline },
      narrowLayoutGolden(bidiContract.uikit.customLayouting),
    );
    const natural = custom.measure(Number.NaN, YogaMeasureMode.Undefined, Number.NaN, YogaMeasureMode.Undefined);
    const atMost = custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost);
    const exactWidth = custom.measure(420.001, YogaMeasureMode.Exactly, Number.NaN, YogaMeasureMode.Undefined);
    for (let index = 0; index < 20; index += 1) {
      assertObject(
        'uikit.repeatedAtMost',
        custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost),
        bidiContract.uikit.measurements.atMost!,
      );
    }
    assertObject('uikit.natural', natural, bidiContract.uikit.measurements.natural!);
    assertObject('uikit.atMost', atMost, bidiContract.uikit.measurements.atMost!);
    assertObject('uikit.exactWidth', exactWidth, uikitExactWidthGolden());
    assertObject(
      'uikit.definite',
      uikit.resolveYogaLeaf(401.237, YogaMeasureMode.Exactly, 150.111, YogaMeasureMode.Exactly),
      bidiContract.uikit.measurements.definite!,
    );
    const resolved = uikit.layoutResolvedBox(
      bidiContract.uikit.resolved.outerSize,
      bidiContract.uikit.resolved.padding,
      bidiContract.uikit.resolved.border,
    );
    assertObject('uikit.contentBox', resolved.contentBox, bidiContract.uikit.resolved.contentBox);
    assertObject(
      'uikit.layout',
      paragraphLayoutContract(resolved.layout, false),
      narrowLayoutGolden(bidiContract.uikit.resolved.layout),
    );
    assertArray('uikit.centeredX', resolved.centeredX, bidiContract.uikit.resolved.centeredX);
    assertArray('uikit.centeredY', resolved.centeredY, bidiContract.uikit.resolved.centeredY);
    layouts.push(resolved.layout as ParagraphLayoutInspection);

    return {
      bytes: layouts.reduce((total, layout) => total + paragraphLayoutBytes(layout), 0),
      hash: hashParagraphLayouts(layouts),
      metrics: {
        bidiLayoutCount: Object.keys(bidiContract.bidi).length,
        policyLayoutCount: Object.keys(bidiContract.policies.cases).length,
        cjkLayoutCount: Object.keys(cjkContract.cases).length * Object.keys(cjkContract.constraints).length,
        uikitMeasurementCount: uikit.calls.measure,
        uikitLayoutCount: uikit.calls.layout,
      },
    };
  } finally {
    uikitParagraph?.dispose();
    for (const text of texts) text.dispose();
    group.dispose();
  }
}

function policy(value: LegacyConstraints): ParagraphLayoutPolicy {
  return {
    ...(value.maxLines === undefined ? {} : { maxLines: value.maxLines }),
    ...(value.wrap === undefined ? {} : { wrap: value.wrap }),
    ...(value.align === undefined ? {} : { align: value.align }),
    ...(value.overflow === undefined ? {} : { overflow: value.overflow }),
  };
}

function contentBox(value: LegacyConstraints): ParagraphContentBox {
  return {
    ...(value.width === undefined ? {} : { width: axis(value.width) }),
    ...(value.height === undefined ? {} : { height: axis(value.height) }),
    ...(value.maxLines === undefined ? {} : { maxLines: value.maxLines }),
    ...(value.wrap === undefined ? {} : { wrap: value.wrap }),
    ...(value.align === undefined ? {} : { align: value.align }),
    ...(value.overflow === undefined ? {} : { overflow: value.overflow }),
  };
}

function axis(value: LegacyAxis) {
  if (value.mode === 'unconstrained') return { mode: 'unconstrained' as const };
  if (value.size === undefined) throw new Error(`${value.mode} constraint omitted its size`);
  return { mode: value.mode === 'exactly' ? ('exact' as const) : ('at-most' as const), size: value.size };
}

function assertObject(label: string, actual: unknown, expected: unknown): void {
  if (!exactValue(actual, expected)) {
    throw new Error(`${label} differs from its retained paragraph contract at ${firstDifference(actual, expected)}`);
  }
}

function narrowLayoutGolden<Value>(value: Value): Value {
  if (typeof value === 'number') return Math.fround(value) as Value;
  if (Array.isArray(value)) return value.map(narrowLayoutGolden) as Value;
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, narrowLayoutGolden(child)])) as Value;
  }
  return value;
}

function uikitExactWidthGolden(): Readonly<Record<string, unknown>> {
  const expected = bidiContract.uikit.measurements.exactWidth;
  if (expected === undefined) throw new Error('uikit contract omitted exact-width measurement');
  const layoutMeasurement = record(bidiContract.uikit.resolved.layout.measurement, 'uikit resolved measurement');
  const contentHeight = numberValue(layoutMeasurement.contentHeight, 'uikit resolved contentHeight');
  return { ...expected, height: Math.ceil(Math.fround(contentHeight) * 100) / 100 };
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new TypeError(`${label} is not a record`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} is not finite`);
  return value;
}

function firstDifference(actual: unknown, expected: unknown, path = '$'): string {
  if (exactValue(actual, expected)) return `${path} (no difference)`;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return `${path}.length: ${actual.length} !== ${expected.length}`;
    for (let index = 0; index < actual.length; index += 1) {
      if (!exactValue(actual[index], expected[index]))
        return firstDifference(actual[index], expected[index], `${path}[${index}]`);
    }
  }
  if (isRecord(actual) && isRecord(expected)) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (!exactValue(actualKeys, expectedKeys)) {
      return `${path} keys: ${JSON.stringify(actualKeys)} !== ${JSON.stringify(expectedKeys)}`;
    }
    for (const key of actualKeys) {
      if (!exactValue(actual[key], expected[key])) return firstDifference(actual[key], expected[key], `${path}.${key}`);
    }
  }
  return `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertArray(label: string, actual: ArrayLike<number>, expected: readonly number[]): void {
  if (actual.length !== expected.length)
    throw new Error(`${label} length differs from its retained paragraph contract`);
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `${label}[${index}] differs from its retained paragraph contract: ${String(actual[index])} !== ${String(expected[index])}`,
      );
    }
  }
}
