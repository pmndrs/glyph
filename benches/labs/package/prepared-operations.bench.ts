import { deepStrictEqual } from 'node:assert';

import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, disposeLabels } from './fixture.ts';

type Label = ReturnType<typeof createLabels>['labels'][number];
type Measurement = ReturnType<Label['measure']>;
export const preparedOperationCounts = [1, 100, 1000] as const;
export const preparedOperations = [
  'set',
  'set+measure',
  'set+measure+scene-publication',
  'same-value-set',
  'overwrite-before-scene-publication',
] as const;
export type PreparedOperation = (typeof preparedOperations)[number];

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
  const initialText =
    operation === 'same-value-set' || operation === 'overwrite-before-scene-publication' ? texts[0] : texts[1];
  const warmRequestedRead = operation === 'set+measure' || operation === 'set+measure+scene-publication';
  const expected = texts.map((text) => coldMeasurements(text, initialText, warmRequestedRead));
  assert(
    JSON.stringify(expected[0]!.beforePublication) !== JSON.stringify(expected[1]!.beforePublication),
    'the fixed texts must measure differently',
  );

  const created = createLabels(count);
  try {
    const target = created.labels[0]!;
    target.text = initialText;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;

    // Warm the target cache only for requested reads; setter-only cases start with an unqueried target.
    if (warmRequestedRead) target.measure();
    // Preserve every sibling's baseline outside timing.
    const siblings = created.labels.slice(1).map((label) => ({ text: label.text, measurement: label.measure() }));
    let alternate = false;
    let finalText: (typeof texts)[number] = initialText;
    let operationBody: () => ReturnType<Label['measure']> | undefined;

    if (operation === 'same-value-set') {
      operationBody = () => {
        target.set({ text: texts[0] });
        return undefined;
      };
    } else if (operation === 'overwrite-before-scene-publication') {
      operationBody = () => {
        target.text = texts[1];
        target.text = texts[0];
        created.scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return undefined;
      };
    } else {
      operationBody = () => {
        alternate = !alternate;
        finalText = texts[alternate ? 0 : 1];
        target.text = finalText;
        if (operation === 'set') return undefined;
        const measured = target.measure();
        if (operation === 'set+measure+scene-publication') {
          created.scene.updateMatrixWorld(true);
          if (created.textGroup.error !== undefined) throw created.textGroup.error;
        }
        return measured;
      };
    }

    const measured = yield operationBody;
    assert.equal(target.text, finalText, 'the target must retain the final authored text');
    if (operation === 'set+measure' || operation === 'set+measure+scene-publication') {
      // Labs passes the first untimed invocation result into the generator, not the last measured result.
      assertMeasurement(measured, expected[0]!.beforePublication, expected[0]!.afterPublication);
    }
    const finalWasPublished =
      operation === 'same-value-set' ||
      operation === 'overwrite-before-scene-publication' ||
      operation === 'set+measure+scene-publication';
    const finalExpected = expected[finalText === texts[0] ? 0 : 1]!;
    if (finalWasPublished)
      assertMeasurement(target.measure(), finalExpected.afterPublication, finalExpected.afterPublication);
    else assertMeasurement(target.measure(), finalExpected.beforePublication, finalExpected.afterPublication);
    if (operation === 'set+measure+scene-publication' || operation === 'overwrite-before-scene-publication') {
      assert.equal(target.commitState().status, 'committed');
    }
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
      bench(`${String(count)} labels first ${operation} @prepared @operation`, function* () {
        return yield* preparedOperation(count, operation);
      });
    }
  }
});
