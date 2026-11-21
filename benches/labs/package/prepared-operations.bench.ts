// Labs selects bench files by the tag text they contain; the three-span rows here carry @prepare-spans.
import { deepStrictEqual } from 'node:assert';

import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, disposeLabels } from './fixture.ts';
import { assertSpanLayout, coldLabelLayouts, prepareSpanTag } from './prepare-spans.ts';

type Label = ReturnType<typeof createLabels>['labels'][number];
type Measurement = ReturnType<Label['measure']>;
export const preparedOperationCounts = [1, 100, 1000] as const;

/**
 * What one timed call does to the target label: its setters, then optionally a measurement, then optionally the scene
 * traversal that publishes. Each setter pattern has a row ending at the setter, one ending at the read and one ending
 * at the frame; `set+measure+scene-publication` predates that split and stays as the combined row.
 */
interface OperationShape {
  readonly setters: 'alternate' | 'same-value' | 'overwrite';
  readonly read: boolean;
  readonly frame: boolean;
  /** Part of a setter / setter + read / setter + frame trio. */
  readonly span: boolean;
}

const operationShapes = {
  set: { setters: 'alternate', read: false, frame: false, span: true },
  'set+measure': { setters: 'alternate', read: true, frame: false, span: true },
  'set+scene-publication': { setters: 'alternate', read: false, frame: true, span: true },
  'set+measure+scene-publication': { setters: 'alternate', read: true, frame: true, span: false },
  'same-value-set': { setters: 'same-value', read: false, frame: false, span: true },
  'same-value-set+measure': { setters: 'same-value', read: true, frame: false, span: true },
  'same-value-set+scene-publication': { setters: 'same-value', read: false, frame: true, span: true },
  'overwrite-before-scene-publication [setter only]': { setters: 'overwrite', read: false, frame: false, span: true },
  'overwrite-before-scene-publication [setter + read]': { setters: 'overwrite', read: true, frame: false, span: true },
  'overwrite-before-scene-publication': { setters: 'overwrite', read: false, frame: true, span: true },
} as const satisfies Record<string, OperationShape>;

export type PreparedOperation = keyof typeof operationShapes;
export const preparedOperations = Object.keys(operationShapes) as readonly PreparedOperation[];

const texts = ['ticker 000', 'quote! 000'] as const;

function assertMeasurement(actual: Measurement | undefined, before: Measurement, published: Measurement): void {
  if (actual === undefined) throw new Error('the requested measurement is missing');
  // Plain measure may omit ink; any reported ink must match the fully published cold oracle.
  deepStrictEqual(actual, {
    ...before,
    inkBounds: actual.inkBounds === undefined ? undefined : published.inkBounds,
    lines: before.lines.map((line, index) => ({
      ...line,
      inkBounds: actual.lines[index]?.inkBounds === undefined ? undefined : published.lines[index]?.inkBounds,
    })),
  });
}

function coldMeasurements(
  text: string,
  initialText: string,
  warmRequestedRead: boolean,
): {
  beforePublication: ReturnType<Label['measure']>;
  afterPublication: ReturnType<Label['measure']>;
} {
  const created = createLabels(1);
  try {
    const target = created.labels[0]!;
    target.text = initialText;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    if (warmRequestedRead) target.measure();
    target.text = text;
    // Retain the pre-publication answer before a later scene update can replace cached state.
    const beforePublication = structuredClone(target.measure());
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    const afterPublication = structuredClone(target.measure());
    return { beforePublication, afterPublication };
  } finally {
    disposeLabels(created);
  }
}

export function* preparedOperation(
  count: number,
  operation: PreparedOperation,
): Generator<() => ReturnType<Label['measure']> | undefined, void, ReturnType<Label['measure']> | undefined> {
  const shape: OperationShape = operationShapes[operation];
  const initialText = shape.setters === 'alternate' ? texts[1] : texts[0];
  const expected = texts.map((text) => coldMeasurements(text, initialText, shape.read));
  assert(
    JSON.stringify(expected[0]!.beforePublication) !== JSON.stringify(expected[1]!.beforePublication),
    'the fixed texts must measure differently',
  );
  // Independent of the setter path: each cold label is created already holding its text.
  const cold = coldLabelLayouts(texts);
  assert(cold[0]!.layout !== cold[1]!.layout, 'the fixed texts must lay out differently');

  const created = createLabels(count);
  try {
    const target = created.labels[0]!;
    target.text = initialText;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;

    // Warm the target cache only for requested reads; setter-only cases start with an unqueried target.
    if (shape.read) target.measure();
    // Preserve every sibling's baseline outside timing.
    const siblings = created.labels.slice(1).map((label) => ({ text: label.text, measurement: label.measure() }));
    let alternate = false;
    let finalText: (typeof texts)[number] = initialText;
    const applySetters = {
      alternate: () => {
        alternate = !alternate;
        finalText = texts[alternate ? 0 : 1];
        target.text = finalText;
      },
      'same-value': () => {
        target.set({ text: texts[0] });
      },
      overwrite: () => {
        target.text = texts[1];
        target.text = texts[0];
      },
    }[shape.setters];

    const measured = yield () => {
      applySetters();
      const measurement = shape.read ? target.measure() : undefined;
      if (shape.frame) {
        created.scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
      }
      return measurement;
    };
    assert.equal(target.text, finalText, 'the target must retain the final authored text');
    const finalIndex = finalText === texts[0] ? 0 : 1;
    if (shape.read) {
      // Labs passes the first untimed invocation result into the generator, not the last measured result.
      assertMeasurement(measured, expected[0]!.beforePublication, expected[0]!.afterPublication);
    }
    const finalWasPublished = shape.frame || shape.setters === 'same-value';
    const finalExpected = expected[finalIndex]!;
    if (finalWasPublished)
      assertMeasurement(target.measure(), finalExpected.afterPublication, finalExpected.afterPublication);
    else assertMeasurement(target.measure(), finalExpected.beforePublication, finalExpected.afterPublication);
    if (shape.frame) assert.equal(target.commitState().status, 'committed');
    // Last: on some builds reading glyphs changes the per-line counts a later plain measurement reports.
    assertSpanLayout(shape.frame ? 'frame' : shape.read ? 'read' : 'setter', [target], [cold[finalIndex]!]);
    for (const [index, sibling] of siblings.entries()) {
      const label = created.labels[index + 1]!;
      assert.equal(label.text, sibling.text, 'an unchanged sibling must retain its authored text');
      deepStrictEqual(label.measure(), sibling.measurement);
    }
  } finally {
    disposeLabels(created);
  }
}

group('prepared label operations @prepared @operation', () => {
  for (const count of preparedOperationCounts) {
    for (const operation of preparedOperations) {
      const frontier = count === 1 && operation === 'set' ? ' @frontier' : '';
      const span = operationShapes[operation].span ? ` ${prepareSpanTag}` : '';
      bench(`${String(count)} labels first ${operation} @prepared @operation${frontier}${span}`, function* () {
        return yield* preparedOperation(count, operation);
      });
    }
  }
});
